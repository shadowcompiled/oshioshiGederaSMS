import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getDb, runDb } from "@/lib/db";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export async function GET() {
  const ok = await getAdminSession();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ip = await getClientIp();
  const { ok: rateOk } = checkRateLimit(ip, "force-init", LIMITS.forceInit.max);
  if (!rateOk) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const db = getDb();
    if (db.type === "postgres") {
      await runDb(db, "DROP TABLE IF EXISTS customers CASCADE", []);
      await runDb(
        db,
        `CREATE TABLE customers (
          phone TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          date_of_birth TEXT NOT NULL,
          wedding_day TEXT NOT NULL,
          city TEXT NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        []
      );
    } else {
      await runDb(db, "DROP TABLE IF EXISTS customers", []);
      await runDb(
        db,
        `CREATE TABLE customers (
          phone TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          date_of_birth TEXT NOT NULL,
          wedding_day TEXT NOT NULL,
          city TEXT NOT NULL,
          active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now'))
        )`,
        []
      );
      db.conn.close();
    }
    return new NextResponse("✅ Table 'customers' created successfully!");
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
