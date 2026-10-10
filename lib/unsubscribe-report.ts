import { queryCustomers, runDb, type DbConnection } from "./db";
import { toIsraelDateStr } from "./dates";

/**
 * Where an unsubscribe came from. "link" and "reply" are the customer acting
 * on a message; "legacy" rows were backfilled from customers.unsubscribed_at
 * when the events table was introduced, so they can't tell a customer's own
 * opt-out apart from an admin block.
 */
export type UnsubscribeSource = "link" | "reply" | "legacy";

export type BroadcastAudience = "all" | "new_only";

/** One day on the chart: Israel-local date, opt-outs that day, and any broadcasts sent that day. */
export type UnsubscribeDay = {
  date: string;
  unsubscribes: number;
  broadcasts: number;
  recipients: number;
  messages: string[];
};

export const CHART_DAYS = 30;

export async function recordUnsubscribe(
  db: DbConnection,
  phone: string,
  at: string,
  source: UnsubscribeSource
): Promise<void> {
  await runDb(
    db,
    "INSERT INTO unsubscribe_events (phone, unsubscribed_at, source) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [phone, at, source]
  );
}

export async function recordBroadcast(
  db: DbConnection,
  sentAt: string,
  audience: BroadcastAudience,
  recipients: number,
  message: string
): Promise<void> {
  await runDb(db, "INSERT INTO broadcasts (sent_at, audience, recipients, message) VALUES ($1, $2, $3, $4)", [
    sentAt,
    audience,
    recipients,
    message,
  ]);
}

/** YYYY-MM-DD string arithmetic in UTC (inputs are already calendar dates). */
function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Bucket opt-outs and broadcasts into the `days` Israel-local days ending
 * `todayIsrael`, oldest first. Every day is present, including empty ones, so
 * a quiet day after a send reads as a zero rather than a gap. Pure — the
 * caller supplies today — so it is testable.
 */
export function buildUnsubscribeDays(
  unsubscribedAt: string[],
  broadcasts: { sent_at: string; recipients: number; message: string }[],
  todayIsrael: string,
  days: number = CHART_DAYS
): UnsubscribeDay[] {
  const out: UnsubscribeDay[] = [];
  const byDate = new Map<string, UnsubscribeDay>();
  for (let i = days - 1; i >= 0; i--) {
    const day: UnsubscribeDay = { date: shiftDateStr(todayIsrael, -i), unsubscribes: 0, broadcasts: 0, recipients: 0, messages: [] };
    out.push(day);
    byDate.set(day.date, day);
  }
  for (const at of unsubscribedAt) {
    const day = byDate.get(toIsraelDateStr(at) ?? "");
    if (day) day.unsubscribes++;
  }
  for (const b of broadcasts) {
    const day = byDate.get(toIsraelDateStr(b.sent_at) ?? "");
    if (!day) continue;
    day.broadcasts++;
    day.recipients += b.recipients;
    day.messages.push(b.message);
  }
  return out;
}

/**
 * Load the chart's window. The SQL lower bound is a day early on purpose:
 * timestamps are UTC and Israel runs ahead of it, so the first Israeli day
 * starts the evening before in UTC. buildUnsubscribeDays trims the excess.
 */
export async function loadUnsubscribeDays(
  db: DbConnection,
  todayIsrael: string,
  days: number = CHART_DAYS
): Promise<UnsubscribeDay[]> {
  const from = shiftDateStr(todayIsrael, -days);
  const unsubRows = await queryCustomers(
    db,
    "SELECT unsubscribed_at FROM unsubscribe_events WHERE unsubscribed_at >= $1",
    [from]
  );
  const broadcastRows = await queryCustomers(
    db,
    "SELECT sent_at, recipients, message FROM broadcasts WHERE sent_at >= $1",
    [from]
  );
  return buildUnsubscribeDays(
    unsubRows.map((r) => String(r.unsubscribed_at)),
    broadcastRows.map((r) => ({
      sent_at: String(r.sent_at),
      recipients: Number(r.recipients) || 0,
      message: String(r.message ?? ""),
    })),
    todayIsrael,
    days
  );
}
