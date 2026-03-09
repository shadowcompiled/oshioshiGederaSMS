import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken, generateSecureToken } from "@/lib/security";
import { formatPhone, isValidPhone } from "@/lib/validation";
import { initDb, getDb, runDb } from "@/lib/db";

const SMS_LOGIN = process.env.ANDROID_SMS_GATEWAY_LOGIN;
const SMS_PASS = process.env.ANDROID_SMS_GATEWAY_PASSWORD;
const SMS_URL = (process.env.ANDROID_SMS_GATEWAY_API_URL || "https://api.sms-gate.app/3rdparty/v1").replace(/\/$/, "");

async function redirectAdmin(req: NextRequest, msg: string, sessionOk: boolean) {
  const url = new URL("/admin", req.url);
  url.searchParams.set("msg", msg);
  const res = NextResponse.redirect(url, 303);
  if (sessionOk) await attachSessionCookie(res);
  return res;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const sessionOk = await getAdminSession();
  const tokenOk = verifyImportToken((form.get("import_token") as string) ?? null);
  if (!sessionOk && !tokenOk) return redirectAdmin(req, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.", false);

  const rawPhone = ((form.get("phone") as string) ?? "").trim();
  const message = ((form.get("message") as string) ?? "").trim();

  if (!message || message.length > 1000) {
    return redirectAdmin(req, "הודעת הבדיקה חייבת להכיל עד 1000 תווים.", sessionOk);
  }

  const phone = formatPhone(rawPhone);
  if (!isValidPhone(phone)) {
    return redirectAdmin(req, "מספר טלפון לא תקין. נא להזין מספר מלא (למשל 0501234567 או +972501234567).", sessionOk);
  }

  if (!SMS_LOGIN || !SMS_PASS) {
    return redirectAdmin(req, "שגיאה: חסר הגדרת שער SMS.", sessionOk);
  }

  const token = generateSecureToken(phone);
  const clean = phone.replace("+", "");
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin;
  const unsubLink = `${baseUrl}/unsubscribe/${clean}?token=${token}`;
  const finalMsg = `${message}\n\nלהסרה: ${unsubLink}`;

  const payload = {
    textMessage: { text: finalMsg },
    phoneNumbers: [phone],
    withDeliveryReport: true,
  };

  try {
    const auth = Buffer.from(`${SMS_LOGIN}:${SMS_PASS}`).toString("base64");
    const res = await fetch(`${SMS_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("SMS Gateway Error (test)", res.status, text);
      return redirectAdmin(req, "שליחת הודעת הבדיקה נכשלה: " + (text || res.status), sessionOk);
    }
    try {
      await initDb();
      const db = getDb();
      const now = new Date().toISOString();
      await runDb(db, "UPDATE customers SET received_message_at = $2 WHERE phone = $1", [phone, now]);
      if (db.type === "sqlite") db.conn.close();
    } catch (e) {
      console.error("Failed to set received_message_at (test)", phone, e);
    }
    return redirectAdmin(req, `הודעת בדיקה נשלחה ל־${phone}.`, sessionOk);
  } catch (e) {
    console.error("Send test SMS error:", e);
    return redirectAdmin(req, "שגיאה בשליחת הודעת הבדיקה.", sessionOk);
  }
}
