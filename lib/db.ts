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

const globalForDb = globalThis as unknown as { _pgPool: Pool | null | undefined; _initDone?: boolean };

function getPostgresPool(): Pool | null {
  if (globalForDb._pgPool !== undefined) return globalForDb._pgPool ?? null;
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    globalForDb._pgPool = null;
    return null;
  }
  let connUrl = url;
  const sep = connUrl.includes("?") ? "&" : "?";
  if (connUrl.includes("sslmode=")) {
    connUrl = connUrl.replace(/sslmode=[^&]+/, "sslmode=verify-full");
  } else {
    connUrl = `${connUrl}${sep}sslmode=verify-full`;
  }
  globalForDb._pgPool = new Pool({ connectionString: connUrl });
  return globalForDb._pgPool;
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

/**
 * Apply the full schema to an open connection. Exported separately from
 * initDb so tests can run it against an in-memory SQLite database.
 */
export async function applySchema(db: DbConnection): Promise<void> {
  const customersSchema = `
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
  // valid_from/valid_until are Israel-local calendar dates (YYYY-MM-DD, TEXT
  // in both engines) so they compare correctly as strings. redeemed_at is a
  // UTC ISO instant stored as TEXT; created_at defaults are UTC, not
  // Israel-local.
  // The ONLY intended differences between the two gifts DDL literals below
  // are the id column and the created_at default — keep them in sync.
  const giftsSchemaSqlite = `
    CREATE TABLE IF NOT EXISTS gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      type TEXT NOT NULL,
      period TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_until TEXT,
      redeemed_at TEXT,
      redeemed_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(phone, type, period)
    )
  `;
  const giftsSchemaPg = `
    CREATE TABLE IF NOT EXISTS gifts (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      type TEXT NOT NULL,
      period TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_until TEXT,
      redeemed_at TEXT,
      redeemed_by TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(phone, type, period)
    )
  `;
  // One row per phone number, holding the in-flight SMS verification for that
  // number: the HMAC of the current code, its expiry, the guess counter, the
  // send-throttle counters, and (after a correct code) the hash of the
  // single-use token that authorises exactly one club signup.
  //
  // Every value is TEXT or INTEGER and every timestamp is a UTC ISO instant, so
  // one DDL string is valid on both engines and the string comparisons in
  // lib/phone-verification.ts order correctly on both.
  const phoneVerificationsSchema = `
    CREATE TABLE IF NOT EXISTS phone_verifications (
      phone TEXT PRIMARY KEY,
      code_hash TEXT,
      code_expires_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      send_count INTEGER NOT NULL DEFAULT 0,
      send_window_start TEXT,
      last_sent_at TEXT,
      token_hash TEXT,
      token_expires_at TEXT,
      updated_at TEXT
    )
  `;
  if (db.type === "postgres") {
    const pgSchema = customersSchema
      .replace("INTEGER DEFAULT 1", "BOOLEAN DEFAULT TRUE")
      .replace("TEXT DEFAULT (datetime('now'))", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    await db.conn.query(pgSchema);
    const alters = [
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS received_message_at TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_version TEXT",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_ip TEXT",
      // Who ended the membership: "customer_link", "customer_sms" or "admin".
      // NULL for an active member, and cleared again on reactivation.
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS unsubscribe_source TEXT",
    ];
    for (const sql of alters) await db.conn.query(sql).catch(() => {});
    await db.conn.query(giftsSchemaPg);
    await db.conn.query(phoneVerificationsSchema);
  } else {
    db.conn.exec(customersSchema);
    const alters = [
      "ALTER TABLE customers ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",
      "ALTER TABLE customers ADD COLUMN received_message_at TEXT",
      "ALTER TABLE customers ADD COLUMN unsubscribed_at TEXT",
      "ALTER TABLE customers ADD COLUMN consent_at TEXT",
      "ALTER TABLE customers ADD COLUMN consent_version TEXT",
      "ALTER TABLE customers ADD COLUMN consent_ip TEXT",
      "ALTER TABLE customers ADD COLUMN unsubscribe_source TEXT",
    ];
    for (const sql of alters) {
      try {
        db.conn.prepare(sql).run();
      } catch {}
    }
    db.conn.exec(giftsSchemaSqlite);
    db.conn.exec(phoneVerificationsSchema);
  }
}

// Run schema init once per process to avoid repeated ALTERs
export async function initDb(): Promise<void> {
  if (typeof globalForDb._initDone === "boolean" && globalForDb._initDone) return;
  const db = getDb();
  await applySchema(db);
  if (db.type === "sqlite") db.conn.close();
  globalForDb._initDone = true;
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
  received_message_at: string | null;
  unsubscribed_at: string | null;
  consent_at: string | null;
  consent_version: string | null;
  consent_ip: string | null;
  unsubscribe_source: string | null;
};

export function mapRow(r: Record<string, unknown>): CustomerRow {
  const active = r.active === true || r.active === 1;
  const created = r.created_at != null ? String(r.created_at) : null;
  const received_message_at = r.received_message_at != null ? String(r.received_message_at) : null;
  const unsubscribed_at = r.unsubscribed_at != null ? String(r.unsubscribed_at) : null;
  return {
    phone: String(r.phone ?? ""),
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    date_of_birth: String(r.date_of_birth ?? ""),
    wedding_day: String(r.wedding_day ?? ""),
    city: String(r.city ?? ""),
    active,
    created_at: created,
    received_message_at,
    unsubscribed_at,
    consent_at: r.consent_at != null ? String(r.consent_at) : null,
    consent_version: r.consent_version != null ? String(r.consent_version) : null,
    consent_ip: r.consent_ip != null ? String(r.consent_ip) : null,
    unsubscribe_source: r.unsubscribe_source != null ? String(r.unsubscribe_source) : null,
  };
}
