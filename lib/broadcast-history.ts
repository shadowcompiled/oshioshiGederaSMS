import { queryCustomers, runDb, type DbConnection } from "./db";

/**
 * The history of what the club has sent, and how much of it arrived.
 *
 * Delivery is read from message_sends, which the SMS worker writes one row per
 * attempt. Broadcasts sent before that table existed have no rows at all, so
 * they report as unaudited rather than as total failures — the dashboard says
 * so instead of printing a zero that looks like a catastrophe.
 */

export type SendStatus = "sent" | "failed";
export type SendKind = "broadcast" | "welcome" | "birthday" | "other";

export type SendAttempt = {
  phone: string;
  broadcastAt: string | null;
  status: SendStatus;
};

export type BroadcastRow = {
  sentAt: string;
  audience: string;
  recipients: number;
  message: string;
};

export type BroadcastSummary = {
  sentAt: string;
  audience: string;
  /** Recipients the broadcast queued to QStash — the denominator. */
  queued: number;
  message: string;
  /** Distinct phones with at least one successful attempt. */
  delivered: number;
  /** Distinct phones whose every attempt failed. These are the ones to chase. */
  failed: number;
  /**
   * Queued but never heard from again: no attempt row at all. Either still in
   * QStash's retry queue, or the worker never ran.
   */
  missing: number;
  /** False for broadcasts predating message_sends, where delivery is unknowable. */
  audited: boolean;
};

export const HISTORY_LIMIT = 50;

/** Record one attempt by the SMS worker. Never throws into the send path. */
export async function recordSendAttempt(
  db: DbConnection,
  attempt: {
    phone: string;
    broadcastAt: string | null;
    kind: SendKind;
    status: SendStatus;
    error: string | null;
    attemptedAt: string;
  }
): Promise<void> {
  await runDb(
    db,
    `INSERT INTO message_sends (phone, broadcast_at, kind, status, error, attempted_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      attempt.phone,
      attempt.broadcastAt,
      attempt.kind,
      attempt.status,
      attempt.error ? attempt.error.slice(0, 300) : null,
      attempt.attemptedAt,
    ]
  );
}

/**
 * Fold attempts into one outcome per broadcast. Pure, so the arithmetic that
 * decides whether a send "worked" is testable without a database.
 *
 * A phone counts as delivered if ANY of its attempts succeeded, because QStash
 * retries: a failure followed by a success is a success. It counts as failed
 * only when every attempt for it failed.
 */
export function buildBroadcastHistory(
  broadcasts: BroadcastRow[],
  attempts: SendAttempt[]
): BroadcastSummary[] {
  const byBroadcast = new Map<string, Map<string, boolean>>();
  for (const a of attempts) {
    if (!a.broadcastAt) continue;
    let phones = byBroadcast.get(a.broadcastAt);
    if (!phones) {
      phones = new Map<string, boolean>();
      byBroadcast.set(a.broadcastAt, phones);
    }
    // once true, stays true — any success wins over later retries
    phones.set(a.phone, (phones.get(a.phone) ?? false) || a.status === "sent");
  }

  return broadcasts
    .slice()
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0))
    .map((b) => {
      const phones = byBroadcast.get(b.sentAt);
      if (!phones || phones.size === 0) {
        return {
          sentAt: b.sentAt,
          audience: b.audience,
          queued: b.recipients,
          message: b.message,
          delivered: 0,
          failed: 0,
          missing: 0,
          audited: false,
        };
      }
      let delivered = 0;
      let failed = 0;
      phones.forEach((ok) => {
        if (ok) delivered++;
        else failed++;
      });
      return {
        sentAt: b.sentAt,
        audience: b.audience,
        queued: b.recipients,
        message: b.message,
        delivered,
        failed,
        // Negative would mean more attempts than the broadcast queued, which
        // only happens if a row is double-logged; clamp rather than show it.
        missing: Math.max(0, b.recipients - phones.size),
        audited: true,
      };
    });
}

/** Load the most recent broadcasts and the attempts belonging to them. */
export async function loadBroadcastHistory(
  db: DbConnection,
  limit: number = HISTORY_LIMIT
): Promise<BroadcastSummary[]> {
  const broadcastRows = await queryCustomers(
    db,
    "SELECT sent_at, audience, recipients, message FROM broadcasts ORDER BY sent_at DESC LIMIT $1",
    [limit]
  );
  const broadcasts: BroadcastRow[] = broadcastRows.map((r) => ({
    sentAt: String(r.sent_at),
    audience: String(r.audience ?? ""),
    recipients: Number(r.recipients) || 0,
    message: String(r.message ?? ""),
  }));
  if (broadcasts.length === 0) return [];

  // Bounded by the oldest broadcast on screen rather than fetching the table.
  const oldest = broadcasts.reduce((min, b) => (b.sentAt < min ? b.sentAt : min), broadcasts[0].sentAt);
  const attemptRows = await queryCustomers(
    db,
    `SELECT phone, broadcast_at, status FROM message_sends
     WHERE broadcast_at IS NOT NULL AND broadcast_at >= $1`,
    [oldest]
  );
  const attempts: SendAttempt[] = attemptRows.map((r) => ({
    phone: String(r.phone ?? ""),
    broadcastAt: r.broadcast_at == null ? null : String(r.broadcast_at),
    status: String(r.status) === "sent" ? "sent" : "failed",
  }));

  return buildBroadcastHistory(broadcasts, attempts);
}

/**
 * The phones a given broadcast could not reach: every attempt failed, or no
 * attempt was ever recorded. This is the list to re-send to, so it returns
 * numbers rather than a count.
 */
export async function loadFailedRecipients(
  db: DbConnection,
  broadcastAt: string
): Promise<{ phone: string; error: string | null }[]> {
  const rows = await queryCustomers(
    db,
    `SELECT phone, status, error FROM message_sends WHERE broadcast_at = $1`,
    [broadcastAt]
  );
  const best = new Map<string, { ok: boolean; error: string | null }>();
  for (const r of rows) {
    const phone = String(r.phone ?? "");
    const ok = String(r.status) === "sent";
    const prev = best.get(phone);
    best.set(phone, {
      ok: (prev?.ok ?? false) || ok,
      error: ok ? null : (r.error == null ? null : String(r.error)),
    });
  }
  return Array.from(best.entries())
    .filter(([, v]) => !v.ok)
    .map(([phone, v]) => ({ phone, error: v.error }));
}
