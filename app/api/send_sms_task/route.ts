import { NextRequest, NextResponse } from "next/server";
import { getAppSecret, generateSecureToken } from "@/lib/security";
import { getPublicAppUrl } from "@/lib/app-url";
import { unsubscribeUrl, unsubFooter } from "@/lib/unsubscribe-link";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";
import { sendSmsViaGateway } from "@/lib/sms-gateway";
import { initDb, getDb, runDb } from "@/lib/db";
import { recordSendAttempt, type SendKind, type SendStatus } from "@/lib/broadcast-history";

/**
 * Log one attempt to message_sends. Swallows its own errors: an audit row that
 * cannot be written must never turn a delivered SMS into a reported failure,
 * nor stop a failed one from being retried.
 */
async function logAttempt(
  phone: string,
  kind: SendKind,
  broadcastAt: string | null,
  status: SendStatus,
  error: string | null
): Promise<void> {
  try {
    await initDb();
    const db = getDb();
    try {
      await recordSendAttempt(db, {
        phone,
        broadcastAt,
        kind,
        status,
        error,
        attemptedAt: new Date().toISOString(),
      });
    } finally {
      if (db.type === "sqlite") db.conn.close();
    }
  } catch (e) {
    console.error("Failed to log send attempt", phone, e);
  }
}

const KINDS: readonly SendKind[] = ["broadcast", "welcome", "birthday", "other"];

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "send_sms_task", LIMITS.sendSmsTask.max);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let data: {
    secret?: string;
    phone?: string;
    message?: string;
    kind?: string;
    broadcast_at?: string | null;
  };
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

  const rawKind = (data.kind ?? "").trim() as SendKind;
  const kind: SendKind = KINDS.includes(rawKind) ? rawKind : "other";
  const broadcastAt = data.broadcast_at ? String(data.broadcast_at) : null;

  const token = generateSecureToken(phone);
  const baseUrl = getPublicAppUrl() || req.nextUrl.origin;
  const finalMsg = message + unsubFooter(unsubscribeUrl(baseUrl, phone, token));

  const result = await sendSmsViaGateway(phone, finalMsg);
  if (!result.ok) {
    console.error("SMS Gateway Error", result.status ?? "", result.error);
    await logAttempt(phone, kind, broadcastAt, "failed", result.error ?? `gateway ${result.status ?? ""}`);
    // 500 on purpose: QStash retries, and a later attempt may succeed. The
    // failed row above stays, so the history shows the retry, not a rewrite.
    return NextResponse.json({ status: "error", error: result.error }, { status: 500 });
  }

  await logAttempt(phone, kind, broadcastAt, "sent", null);

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
