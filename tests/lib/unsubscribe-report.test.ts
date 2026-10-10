import { describe, it, expect, vi, beforeEach } from "vitest";
import { applySchema, queryCustomers, type DbConnection } from "@/lib/db";
import { buildUnsubscribeDays, loadUnsubscribeDays, recordBroadcast } from "@/lib/unsubscribe-report";

// deactivateByPhone opens its own connection via getDb() and closes it after,
// so hand it a shared in-memory database whose close() is a no-op.
let shared: DbConnection;
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: () => shared, initDb: async () => {} };
});
const { deactivateByPhone } = await import("@/lib/unsubscribe");

function memoryDb(): DbConnection {
  const BetterSqlite3 = require("better-sqlite3");
  const raw = BetterSqlite3(":memory:");
  return {
    type: "sqlite",
    conn: { prepare: raw.prepare.bind(raw), exec: raw.exec.bind(raw), close() {} },
  } as DbConnection;
}

function seed(db: DbConnection, phone: string, active: number, unsubscribedAt: string | null = null) {
  if (db.type !== "sqlite") throw new Error("expected sqlite");
  db.conn
    .prepare(
      "INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active, unsubscribed_at) VALUES (?, 'דנה', 'a@b.co', '', '', 'גדרה', ?, ?)"
    )
    .run(phone, active, unsubscribedAt);
}

describe("buildUnsubscribeDays", () => {
  it("returns every day in the window, oldest first, including empty ones", () => {
    const days = buildUnsubscribeDays([], [], "2026-10-10", 3);
    expect(days.map((d) => d.date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(days.every((d) => d.unsubscribes === 0 && d.broadcasts === 0)).toBe(true);
  });

  it("buckets by the Israeli day, not the UTC one", () => {
    // 22:30 UTC on the 8th is 01:30 on the 9th in Israel (UTC+3 in October).
    const days = buildUnsubscribeDays(["2026-10-08T22:30:00.000Z", "2026-10-08 10:00:00"], [], "2026-10-10", 3);
    expect(days.map((d) => d.unsubscribes)).toEqual([1, 1, 0]);
  });

  it("marks send days with their recipients and text, and drops anything outside the window", () => {
    const days = buildUnsubscribeDays(
      ["2026-10-01T10:00:00.000Z"],
      [
        { sent_at: "2026-10-09T08:00:00.000Z", recipients: 120, message: "1+1 על כל הרולים" },
        { sent_at: "2026-10-09T15:00:00.000Z", recipients: 5, message: "תזכורת" },
        { sent_at: "2026-09-01T08:00:00.000Z", recipients: 99, message: "ישן" },
      ],
      "2026-10-10",
      3
    );
    expect(days[1]).toMatchObject({ date: "2026-10-09", broadcasts: 2, recipients: 125 });
    expect(days[1].messages).toEqual(["1+1 על כל הרולים", "תזכורת"]);
    expect(days.reduce((s, d) => s + d.unsubscribes + d.broadcasts, 0)).toBe(2);
  });
});

describe("unsubscribe events", () => {
  beforeEach(async () => {
    shared = memoryDb();
    await applySchema(shared);
  });

  it("backfills earlier opt-outs once, and only for members who are still out", async () => {
    const db = memoryDb();
    await applySchema(db);
    seed(db, "+972500000001", 0, "2026-10-01T09:00:00.000Z");
    seed(db, "+972500000002", 1, null);
    seed(db, "+972500000003", 0, null);
    // The tables already exist and are empty, so re-running the schema seeds them.
    await applySchema(db);
    await applySchema(db);
    const rows = await queryCustomers(db, "SELECT phone, source FROM unsubscribe_events");
    expect(rows).toEqual([{ phone: "+972500000001", source: "legacy" }]);
  });

  it("logs a member leaving by link, but not a repeat click from someone already out", async () => {
    seed(shared, "+972501234567", 1);
    await deactivateByPhone("972501234567", "link");
    await deactivateByPhone("972501234567", "link");
    const rows = await queryCustomers(shared, "SELECT phone, source FROM unsubscribe_events");
    expect(rows).toEqual([{ phone: "+972501234567", source: "link" }]);
  });

  it("feeds the chart from logged opt-outs and broadcasts", async () => {
    seed(shared, "+972501234567", 1);
    await deactivateByPhone("+972501234567", "reply");
    await recordBroadcast(shared, new Date().toISOString(), "all", 40, "מבצע");
    const { israelToday } = await import("@/lib/dates");
    const days = await loadUnsubscribeDays(shared, israelToday());
    const today = days[days.length - 1];
    expect(today).toMatchObject({ unsubscribes: 1, broadcasts: 1, recipients: 40 });
  });
});
