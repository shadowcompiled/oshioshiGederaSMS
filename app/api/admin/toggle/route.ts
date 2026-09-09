import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { getDb, runDb } from "@/lib/db";
import { normalizeAdminPhone } from "@/lib/validation";

async function redirectAdmin(req: NextRequest, msg: string | undefined, sessionOk: boolean) {
  const url = new URL("/admin", req.url);
  if (msg) url.searchParams.set("msg", msg);
  const res = NextResponse.redirect(url, 303);
  // Only refresh the admin cookie for callers that already hold a valid admin
  // session — never on rejected or token-authenticated requests.
  if (sessionOk) await attachSessionCookie(res, "admin");
  return res;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const sessionOk = await getAdminSession();
  const tokenOk = verifyImportToken((formData.get("import_token") as string) ?? null);
  if (!sessionOk && !tokenOk) {
    return redirectAdmin(req, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.", false);
  }

  const phone = ((formData.get("phone") as string) ?? "").trim();
  const action = ((formData.get("action") as string) ?? "").trim();
  if (!phone || !["block", "unblock"].includes(action)) {
    return redirectAdmin(req, undefined, sessionOk);
  }

  const { formatted, clean } = normalizeAdminPhone(phone);

  const db = getDb();
  const activeVal = action === "unblock";
  const setVal = db.type === "postgres" ? activeVal : activeVal ? 1 : 0;
  const now = new Date().toISOString();

  // Block: stamp unsubscribed_at (powers the "removed today" filter).
  // Unblock: reactivate and clear the removal + received markers.
  // Placeholders are numbered in textual order ($1, $2, …) with params in the
  // same order, so this is correct under Postgres ($n) and the SQLite shim
  // (which rewrites $n -> ? positionally).
  // 'admin' on a block is the whole point of the column: the admin list can
  // then say the owner removed this member, not that they opted out.
  const setClause = activeVal
    ? "active = $1, unsubscribed_at = NULL, received_message_at = NULL, unsubscribe_source = NULL"
    : "active = $1, unsubscribed_at = $2, unsubscribe_source = 'admin'";

  const exactWhereParam = activeVal ? [setVal, formatted] : [setVal, now, formatted];
  const { rowCount } = await runDb(
    db,
    `UPDATE customers SET ${setClause} WHERE phone = $${activeVal ? 2 : 3}`,
    exactWhereParam
  );
  if (rowCount === 0 && clean) {
    const likeParam = activeVal ? [setVal, `%${clean}`] : [setVal, now, `%${clean}`];
    await runDb(
      db,
      `UPDATE customers SET ${setClause} WHERE phone LIKE $${activeVal ? 2 : 3}`,
      likeParam
    );
  }
  if (db.type === "sqlite") db.conn.close();

  return redirectAdmin(req, undefined, sessionOk);
}
