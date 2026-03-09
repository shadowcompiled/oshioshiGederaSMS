import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { getDb, runDb } from "@/lib/db";

async function redirectAdmin(req: NextRequest, msg?: string) {
  const url = new URL("/admin", req.url);
  if (msg) url.searchParams.set("msg", msg);
  const res = NextResponse.redirect(url, 303);
  await attachSessionCookie(res);
  return res;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const sessionOk = await getAdminSession();
  const tokenOk = verifyImportToken((formData.get("import_token") as string) ?? null);
  if (!sessionOk && !tokenOk) {
    return redirectAdmin(req, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.");
  }

  const phone = ((formData.get("phone") as string) ?? "").trim();
  const action = ((formData.get("action") as string) ?? "").trim();
  if (!phone || !["block", "unblock"].includes(action)) {
    return redirectAdmin(req);
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
  if (activeVal) {
    const clearReceived = db.type === "postgres"
      ? "UPDATE customers SET received_message_at = NULL WHERE phone = $1"
      : "UPDATE customers SET received_message_at = NULL WHERE phone = $1";
    await runDb(db, clearReceived, [formatted]);
    if (rowCount === 0 && clean) {
      await runDb(db, "UPDATE customers SET received_message_at = NULL WHERE phone LIKE $1", [`%${clean}`]);
    }
  }
  if (db.type === "sqlite") db.conn.close();

  return redirectAdmin(req);
}
