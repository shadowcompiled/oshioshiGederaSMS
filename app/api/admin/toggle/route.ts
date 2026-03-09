import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getDb, runDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const ok = await getAdminSession();
  if (!ok) return NextResponse.redirect(new URL("/login", req.url), 303);

  const phone = (req.nextUrl.searchParams.get("phone") ?? "").trim();
  const action = (req.nextUrl.searchParams.get("action") ?? "").trim();
  if (!phone || !["block", "unblock"].includes(action)) {
    return NextResponse.redirect(new URL("/admin", req.url), 303);
  }

  let formatted = phone.startsWith(" ") ? "+" + phone.trimStart() : phone;
  const clean = formatted.replace(/\D/g, "");
  if (clean.startsWith("972")) formatted = "+" + clean;
  else if (!formatted.startsWith("+")) formatted = "+" + clean;
  formatted = formatted.slice(0, 20);

  const db = getDb();
  const activeVal = action === "unblock";
  const sql = db.type === "postgres"
    ? "UPDATE customers SET active = $2 WHERE phone = $1"
    : "UPDATE customers SET active = $2 WHERE phone = $1";
  const params = db.type === "postgres" ? [formatted, activeVal] : [formatted, activeVal ? 1 : 0];
  const { rowCount } = await runDb(db, sql, params);
  if (rowCount === 0 && clean) {
    const likeSql = "UPDATE customers SET active = $2 WHERE phone LIKE $1";
    await runDb(db, likeSql, db.type === "postgres" ? [`%${clean}`, activeVal] : [`%${clean}`, activeVal ? 1 : 0]);
  }
  if (db.type === "sqlite") db.conn.close();

  return NextResponse.redirect(new URL("/admin", req.url), 303);
}
