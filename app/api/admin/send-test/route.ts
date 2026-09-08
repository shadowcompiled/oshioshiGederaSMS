import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { formatPhone, isValidPhone } from "@/lib/validation";
import { initDb, getDb, runDb } from "@/lib/db";
import { sendSms, smsSendability } from "@/lib/sms";
import { renderBroadcastSms } from "@/lib/sms-render";

/**
 * Send one real message to a number the operator names — the "does this
 * actually arrive, and does it look right on a phone?" check.
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

type Payload = { import_token?: string; phone?: string; message?: string };

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
  if (!message || message.length > 1000) {
    return respond(req, false, "הודעת הבדיקה חייבת להכיל עד 1000 תווים.", sessionOk);
  }

  const phone = formatPhone((payload.phone ?? "").trim());
  if (!isValidPhone(phone)) {
    return respond(
      req,
      false,
      "מספר טלפון לא תקין. נא להזין מספר מלא (למשל 0501234567 או +972501234567).",
      sessionOk
    );
  }

  // Ask the registry what it would do before asking it to do it, so a blocked
  // send explains itself instead of returning a generic failure.
  const sender = smsSendability(phone);
  if (sender.refusal) {
    return respond(req, false, "השליחה נחסמה: " + sender.refusal, sessionOk);
  }
  if (sender.provider !== "mock" && !sender.configured) {
    return respond(
      req,
      false,
      `שגיאה: שער ה-SMS "${sender.provider}" אינו מוגדר — חסרים פרטי התחברות.`,
      sessionOk
    );
  }

  const { text } = renderBroadcastSms(message, phone, req.nextUrl.origin);

  try {
    const result = await sendSms(phone, text);
    if (!result.ok) {
      console.error("SMS send error (test)", result.status ?? "", result.error);
      return respond(
        req,
        false,
        "שליחת הודעת הבדיקה נכשלה: " + (result.error || result.status),
        sessionOk
      );
    }

    // Only a message that really left the building counts as "this customer has
    // been contacted"; a mock send must not remove them from the new-customer
    // audience.
    if (sender.delivers) {
      try {
        await initDb();
        const db = getDb();
        const now = new Date().toISOString();
        await runDb(db, "UPDATE customers SET received_message_at = $2 WHERE phone = $1", [phone, now]);
        if (db.type === "sqlite") db.conn.close();
      } catch (e) {
        console.error("Failed to set received_message_at (test)", phone, e);
      }
    }

    const msg = sender.delivers
      ? `הודעת בדיקה נשלחה ל־${phone}.`
      : `מצב הדגמה (${sender.provider}): ההודעה נרשמה ביומן השרת ולא נשלחה באמת ל־${phone}.`;
    return respond(req, true, msg, sessionOk);
  } catch (e) {
    console.error("Send test SMS error:", e);
    return respond(req, false, "שגיאה בשליחת הודעת הבדיקה.", sessionOk);
  }
}
