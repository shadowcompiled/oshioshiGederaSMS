import { NextRequest, NextResponse } from "next/server";
import {
  isUnsubscribeKeyword,
  verifySmsWebhookSignature,
  deactivateByPhone,
} from "@/lib/unsubscribe";

const WEBHOOK_SECRET = process.env.SMS_WEBHOOK_SECRET;

type IncomingWebhook = {
  event?: string;
  payload?: { sender?: string; phoneNumber?: string; message?: string };
};

/**
 * Inbound SMS webhook from the Android SMS Gateway (`sms:received`).
 * When a customer texts the unsubscribe keyword (e.g. "1111") back to the
 * gateway's number, we mark that sender inactive — supports feature phones
 * that can't open the unsubscribe link.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-signature");
  const timestamp = req.headers.get("x-timestamp");

  if (!WEBHOOK_SECRET) {
    console.error("SMS webhook: SMS_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (!verifySmsWebhookSignature(rawBody, timestamp, signature, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: IncomingWebhook;
  try {
    body = JSON.parse(rawBody) as IncomingWebhook;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // Only act on inbound SMS; acknowledge other events so the gateway won't retry.
  if (body.event && body.event !== "sms:received") {
    return NextResponse.json({ ok: true, ignored: "event" });
  }

  const payload = body.payload ?? {};
  const sender = payload.sender ?? payload.phoneNumber ?? "";
  const message = payload.message ?? "";

  if (!isUnsubscribeKeyword(message)) {
    return NextResponse.json({ ok: true, ignored: "not-keyword" });
  }

  try {
    const rowCount = await deactivateByPhone(sender, "customer_sms");
    return NextResponse.json({ ok: true, unsubscribed: rowCount > 0 });
  } catch (e) {
    console.error("SMS webhook unsubscribe failed for", sender, e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
