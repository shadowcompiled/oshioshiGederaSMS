import { createHmac, timingSafeEqual } from "crypto";
import { getDb, runDb, initDb, queryCustomers } from "@/lib/db";
import { recordUnsubscribe } from "@/lib/unsubscribe-report";

/**
 * Keyword a customer texts back to unsubscribe (for feature phones that can't
 * tap the link). Read from env so the matcher and the SMS footer stay in sync;
 * defaults to "1111".
 */
export function getUnsubscribeKeyword(): string {
  return (process.env.UNSUBSCRIBE_KEYWORD || "1111").trim();
}

/** True if an inbound SMS body is an unsubscribe request (exact keyword, trimmed, case-insensitive). */
export function isUnsubscribeKeyword(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.trim().toLowerCase() === getUnsubscribeKeyword().toLowerCase();
}

/**
 * Verify an SMS-Gate inbound webhook signature.
 * SMS-Gate signs with HMAC-SHA256 over (rawBody + timestamp), hex-encoded,
 * delivered in the `X-Signature` header (`X-Timestamp` holds the timestamp).
 */
export function verifySmsWebhookSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string
): boolean {
  if (!timestamp || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody + timestamp).digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Mark a customer inactive and stamp unsubscribed_at = now. Matches the phone
 * both in +E.164 form and digits-only (to tolerate stored-format differences).
 * Returns the number of rows updated. Shared by the unsubscribe link page and
 * the inbound-SMS webhook.
 *
 * Members who were still active get a row in unsubscribe_events for the
 * admin opt-out chart; a repeat click from someone already out does not.
 */
export async function deactivateByPhone(rawPhone: string, source: "link" | "reply"): Promise<number> {
  const clean = String(rawPhone ?? "").replace(/[^\d+]/g, "").slice(0, 20);
  if (!clean.replace("+", "")) return 0;
  const withPlus = clean.startsWith("+") ? clean : "+" + clean;
  const digitsOnly = clean.replace("+", "");

  await initDb();
  const db = getDb();
  try {
    const now = new Date().toISOString();
    const activeFalse = db.type === "postgres" ? "FALSE" : "0";
    const activeTrue = db.type === "postgres" ? "TRUE" : "1";
    const leaving = await queryCustomers(
      db,
      `SELECT phone FROM customers WHERE (phone = $1 OR REPLACE(phone, '+', '') = $2) AND active = ${activeTrue}`,
      [withPlus, digitsOnly]
    );
    // Placeholders numbered in textual order ($1, $2, $3) with params in the
    // same order, correct under Postgres ($n) and the SQLite shim ($n -> ?).
    const { rowCount } = await runDb(
      db,
      `UPDATE customers SET active = ${activeFalse}, unsubscribed_at = $1 WHERE phone = $2 OR REPLACE(phone, '+', '') = $3`,
      [now, withPlus, digitsOnly]
    );
    for (const row of leaving) {
      try {
        await recordUnsubscribe(db, String(row.phone), now, source);
      } catch (e) {
        // The opt-out itself has landed; a missing chart row must not undo it.
        console.error("Failed to log unsubscribe event", row.phone, e);
      }
    }
    return rowCount;
  } finally {
    if (db.type === "sqlite") db.conn.close();
  }
}
