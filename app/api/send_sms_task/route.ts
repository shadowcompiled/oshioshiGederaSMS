import { NextRequest, NextResponse } from "next/server";
import { getAppSecret, generateSecureToken } from "@/lib/security";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";
import { initDb, getDb, runDb } from "@/lib/db";

const SMS_LOGIN = process.env.ANDROID_SMS_GATEWAY_LOGIN;
const SMS_PASS = process.env.ANDROID_SMS_GATEWAY_PASSWORD;
const SMS_URL = (process.env.ANDROID_SMS_GATEWAY_API_URL || "https://api.sms-gate.app/3rdparty/v1").replace(/\/$/, "");

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = checkRateLimit(ip, "send_sms_task", LIMITS.sendSmsTask.max);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let data: { secret?: string; phone?: string; message?: string };
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ status: "error", error: "Invalid JSON" }, { status: 400 });
  }

  if (!data || data.secret !== getAppSecret()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phone = (data.phone ?? "").trim();
  const message = (data.message ?? "").trim();
  if (!phone || !message) {
    return NextResponse.json({ status: "error", error: "Missing parameters" }, { status: 400 });
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
      console.error("SMS Gateway Error", res.status, text);
      return NextResponse.json({ status: "error", error: text }, { status: 500 });
    }
    try {
      await initDb();
      const db = getDb();
      const now = new Date().toISOString();
      await runDb(db, "UPDATE customers SET received_message_at = $2 WHERE phone = $1", [phone, now]);
      if (db.type === "sqlite") db.conn.close();
    } catch (e) {
      console.error("Failed to set received_message_at", phone, e);
    }
    const json = await res.json();
    return NextResponse.json({ status: "sent", phone, gateway_response: json });
  } catch (e) {
    console.error("Worker SMS Fail", phone, e);
    return NextResponse.json({ status: "error", error: String(e) }, { status: 500 });
  }
}
