import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { parseTestRecipients } from "@/lib/test-recipients";
import { initDb, getDb, runDb } from "@/lib/db";
import { sendSms, smsSendability } from "@/lib/sms";
import { renderBroadcastSms } from "@/lib/sms-render";

/**
 * Send the drafted message to a handful of real numbers — the "does this
 * actually arrive, and does it look right on a phone?" check.
 *
 * Up to the cap in lib/test-recipients.ts per run, so a draft can be checked on more
 * than one handset at once (an iPhone and an Android render Hebrew and long
 * links differently, and the owner usually wants a second pair of eyes on the
 * wording). The cap exists because this endpoint bypasses the QStash queue and
 * sends inline: it is a rehearsal tool, not a second broadcast path.
 *
 * The text is produced by lib/sms-render.ts, the same renderer the QStash
 * worker uses, so a test is a genuine rehearsal of a broadcast. (It previously
 * built its own, shorter footer, which meant the test message was not the
 * message customers got.)
 *
 * Responds with JSON when the caller asks for it — the admin composer does, so
 * a failed test reports inline instead of throwing away the drafted message on
 * a full-page redirect. The 303 path is kept for a plain form POST.
 */

const MAX_MESSAGE_LENGTH = 1000;

type Payload = {
  import_token?: string;
  /** Preferred: up to four numbers. */
  phones?: unknown;
  /** Single-number form, kept for the plain form POST. */
  phone?: string;
  message?: string;
};

function wantsJson(req: NextRequest): boolean {
  return req.headers.get("accept")?.includes("application/json") ?? false;
}

async function respond(req: NextRequest, ok: boolean, msg: string, sessionOk: boolean) {
  if (wantsJson(req)) return NextResponse.json({ ok, msg }, { status: ok ? 200 : 400 });
  const url = new URL("/admin", req.url);
  url.searchParams.set("msg", msg);
  const res = NextResponse.redirect(url, 303);
  if (sessionOk) await attachSessionCookie(res, "admin");
  return res;
}

async function readPayload(req: NextRequest): Promise<Payload> {
  if (req.headers.get("content-type")?.includes("application/json")) {
    return (await req.json().catch(() => ({}))) as Payload;
  }
  const form = await req.formData();
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return { import_token: str("import_token"), phone: str("phone"), message: str("message") };
}

export async function POST(req: NextRequest) {
  const payload = await readPayload(req);
  const sessionOk = await getAdminSession();
  const tokenOk = verifyImportToken(payload.import_token ?? null);
  if (!sessionOk && !tokenOk) {
    return respond(req, false, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.", false);
  }

  const message = (payload.message ?? "").trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return respond(req, false, `הודעת הבדיקה חייבת להכיל עד ${MAX_MESSAGE_LENGTH} תווים.`, sessionOk);
  }

  const parsed = parseTestRecipients(payload);
  if (!parsed.ok) return respond(req, false, parsed.error, sessionOk);
  const { phones } = parsed;

  // Ask the registry what it would do before asking it to do it, so a blocked
  // send explains itself instead of returning a generic failure. Checked per
  // number, because the non-production allowlist is per number.
  const sender = smsSendability(phones[0]);
  if (sender.provider !== "mock" && !sender.configured) {
    return respond(
      req,
      false,
      `שגיאה: שער ה-SMS "${sender.provider}" אינו מוגדר — חסרים פרטי התחברות.`,
      sessionOk
    );
  }

  const sent: string[] = [];
  const failed: { phone: string; error: string }[] = [];

  for (const phone of phones) {
    const refusal = smsSendability(phone).refusal;
    if (refusal) {
      failed.push({ phone, error: refusal });
      continue;
    }
    try {
      // Rendered per recipient: each one carries their own opt-out link.
      const { text } = renderBroadcastSms(message, phone, req.nextUrl.origin);
      const result = await sendSms(phone, text);
      if (result.ok) sent.push(phone);
      else {
        console.error("SMS send error (test)", phone, result.status ?? "", result.error);
        failed.push({ phone, error: String(result.error || result.status || "שליחה נכשלה") });
      }
    } catch (e) {
      console.error("Send test SMS error:", phone, e);
      failed.push({ phone, error: e instanceof Error ? e.message : "שגיאה בשליחה" });
    }
  }

  // Only messages that really left the building count as "this customer has
  // been contacted"; a mock send must not change the customer record.
  if (sender.delivers && sent.length > 0) {
    try {
      await initDb();
      const db = getDb();
      const now = new Date().toISOString();
      for (const phone of sent) {
        await runDb(db, "UPDATE customers SET received_message_at = $2 WHERE phone = $1", [phone, now]);
      }
      if (db.type === "sqlite") db.conn.close();
    } catch (e) {
      console.error("Failed to set received_message_at (test)", e);
    }
  }

  if (sent.length === 0) {
    const detail = failed.map((f) => `${f.phone} — ${f.error}`).join("; ");
    return respond(req, false, "שליחת הודעת הבדיקה נכשלה: " + detail, sessionOk);
  }

  const list = sent.join(", ");
  const okMsg = sender.delivers
    ? `הודעת בדיקה נשלחה ל־${list}.`
    : `מצב הדגמה (${sender.provider}): ההודעה נרשמה ביומן השרת ולא נשלחה באמת ל־${list}.`;
  const partial = failed.length
    ? ` נכשלו: ${failed.map((f) => `${f.phone} — ${f.error}`).join("; ")}`
    : "";
  // A partial failure is not a success: the operator must see which handset
  // never got the rehearsal.
  return respond(req, failed.length === 0, okMsg + partial, sessionOk);
}
