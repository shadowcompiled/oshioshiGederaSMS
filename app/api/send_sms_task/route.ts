import { NextRequest, NextResponse } from "next/server";
import { getAppSecret } from "@/lib/security";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";
import { sendSms } from "@/lib/sms";
import { renderBroadcastSms } from "@/lib/sms-render";
import { initDb, getDb, runDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "send_sms_task", LIMITS.sendSmsTask.max);
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

  // One renderer for the delivered text, shared with the admin test-send and
  // the preview endpoint, so what the operator approves is what ships. It also
  // decides the footer variant: an alphanumeric sender (e.g. "OshiOshi" via
  // 019) can't receive replies, so the reply-keyword instruction is only
  // offered when it would actually work.
  const { text: finalMsg } = renderBroadcastSms(message, phone, req.nextUrl.origin);

  const result = await sendSms(phone, finalMsg);
  if (!result.ok) {
    console.error("SMS send error", result.status ?? "", result.error);
    return NextResponse.json({ status: "error", error: result.error }, { status: 500 });
  }

  try {
    await initDb();
    const db = getDb();
    const now = new Date().toISOString();
    // $1 before $2: lib/db.ts rewrites placeholders positionally for SQLite,
    // so the numbers must appear in ascending order in the statement.
    await runDb(db, "UPDATE customers SET received_message_at = $1 WHERE phone = $2", [now, phone]);
    if (db.type === "sqlite") db.conn.close();
  } catch (e) {
    console.error("Failed to set received_message_at", phone, e);
  }

  return NextResponse.json({ status: "sent", phone, gateway_response: result.body });
}
