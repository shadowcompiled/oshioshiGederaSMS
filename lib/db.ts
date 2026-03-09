import { Pool } from "pg";

const DB_NAME = "customers.db";

export type DbConnection = 
  | { type: "postgres"; conn: Pool; client?: never }
  | { type: "sqlite"; conn: SqliteDb };

// SQLite types - we use dynamic require to avoid loading in serverless if only Postgres is used
type SqliteDb = {
  prepare(sql: string): { run(...args: unknown[]): { changes: number }; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
  exec(sql: string): void;
  close(): void;
};

function getPostgresPool(): Pool | null {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) return null;
  const connectionString = url.includes("sslmode=") ? url : `${url}?sslmode=require`;
  return new Pool({ connectionString });
}

function getSqliteDb(): SqliteDb | null {
  try {
    const BetterSqlite3 = require("better-sqlite3") as (path: string) => SqliteDb;
    return BetterSqlite3(DB_NAME);
  } catch {
    return null;
  }
}

export function getDb(): DbConnection {
  const pool = getPostgresPool();
  if (pool) {
    return { type: "postgres", conn: pool };
  }
  const sqlite = getSqliteDb();
  if (sqlite) {
    return { type: "sqlite", conn: sqlite };
  }
  throw new Error("No database configured (set POSTGRES_URL or DATABASE_URL, or have customers.db for SQLite)");
}

export async function withDb<T>(fn: (db: DbConnection) => Promise<T>): Promise<T> {
  const db = getDb();
  try {
    return await fn(db);
  } finally {
    if (db.type === "sqlite") {
      try {
        db.conn.close();
      } catch {}
    }
  }
}

// Run a query that returns rows - works for both Postgres (async) and SQLite (sync)
export async function queryCustomers(
  db: DbConnection,
  sql: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> {
  if (db.type === "postgres") {
    const res = await db.conn.query(sql, params);
    return (res.rows as Record<string, unknown>[]) || [];
  } else {
    const sqliteSql = sql.replace(/\$\d+/g, "?"); // $1 $2 -> ? ?
    const stmt = db.conn.prepare(sqliteSql);
    const rows = (stmt.all as (...a: unknown[]) => unknown[])(...params) as Record<string, unknown>[];
    return rows || [];
  }
}

// Run a statement that doesn't return rows (INSERT/UPDATE/DELETE)
export async function runDb(
  db: DbConnection,
  sql: string,
  params: unknown[] = []
): Promise<{ rowCount: number }> {
  if (db.type === "postgres") {
    const res = await db.conn.query(sql, params);
    return { rowCount: res.rowCount ?? 0 };
  } else {
    const sqliteSql = sql.replace(/\$\d+/g, "?");
    const stmt = db.conn.prepare(sqliteSql);
    const result = (stmt.run as (...a: unknown[]) => { changes: number })(...params);
    return { rowCount: result.changes ?? 0 };
  }
}

// Initialize schema
export async function initDb(): Promise<void> {
  const db = getDb();
  const schema = `
    CREATE TABLE IF NOT EXISTS customers (
      phone TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      wedding_day TEXT NOT NULL,
      city TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `;
  if (db.type === "postgres") {
    const pgSchema = schema
      .replace("INTEGER DEFAULT 1", "BOOLEAN DEFAULT TRUE")
      .replace("TEXT DEFAULT (datetime('now'))", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    await db.conn.query(pgSchema);
    await db.conn.query(
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
    ).catch(() => {});
  } else {
    db.conn.exec(schema);
    try {
      db.conn.prepare("ALTER TABLE customers ADD COLUMN created_at TEXT DEFAULT (datetime('now'))").run();
    } catch {}
  }
  if (db.type === "sqlite") db.conn.close();
}

export type CustomerRow = {
  phone: string;
  name: string;
  email: string;
  date_of_birth: string;
  wedding_day: string;
  city: string;
  active: boolean;
  created_at: string | null;
};

export function mapRow(r: Record<string, unknown>): CustomerRow {
  const active = r.active === true || r.active === 1;
  const created = r.created_at != null ? String(r.created_at) : null;
  return {
    phone: String(r.phone ?? ""),
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    date_of_birth: String(r.date_of_birth ?? ""),
    wedding_day: String(r.wedding_day ?? ""),
    city: String(r.city ?? ""),
    active,
    created_at: created,
  };
}
