import { describe, it, expect } from "vitest";
import {
  buildBroadcastHistory,
  type BroadcastRow,
  type SendAttempt,
} from "@/lib/broadcast-history";

const B1 = "2026-10-12T09:00:00Z";
const B2 = "2026-10-11T09:00:00Z";

function broadcast(sentAt: string, recipients: number): BroadcastRow {
  return { sentAt, audience: "all", recipients, message: "שלום" };
}

function attempt(phone: string, broadcastAt: string, status: "sent" | "failed"): SendAttempt {
  return { phone, broadcastAt, status };
}

describe("buildBroadcastHistory", () => {
  it("counts a clean send as everyone delivered", () => {
    const [row] = buildBroadcastHistory(
      [broadcast(B1, 2)],
      [attempt("+972500000001", B1, "sent"), attempt("+972500000002", B1, "sent")]
    );
    expect(row.delivered).toBe(2);
    expect(row.failed).toBe(0);
    expect(row.missing).toBe(0);
    expect(row.audited).toBe(true);
  });

  it("treats a retry that eventually succeeded as delivered, not failed", () => {
    const [row] = buildBroadcastHistory(
      [broadcast(B1, 1)],
      [attempt("+972500000001", B1, "failed"), attempt("+972500000001", B1, "sent")]
    );
    expect(row.delivered).toBe(1);
    expect(row.failed).toBe(0);
  });

  it("counts a phone as failed only when every attempt failed", () => {
    const [row] = buildBroadcastHistory(
      [broadcast(B1, 2)],
      [
        attempt("+972500000001", B1, "failed"),
        attempt("+972500000001", B1, "failed"),
        attempt("+972500000002", B1, "sent"),
      ]
    );
    expect(row.delivered).toBe(1);
    expect(row.failed).toBe(1);
  });

  it("reports queued recipients that produced no attempt as missing", () => {
    const [row] = buildBroadcastHistory(
      [broadcast(B1, 5)],
      [attempt("+972500000001", B1, "sent"), attempt("+972500000002", B1, "sent")]
    );
    expect(row.delivered).toBe(2);
    expect(row.missing).toBe(3);
  });

  it("marks a broadcast with no attempts at all as unaudited, not as a total failure", () => {
    const [row] = buildBroadcastHistory([broadcast(B1, 40)], []);
    expect(row.audited).toBe(false);
    expect(row.delivered).toBe(0);
    expect(row.missing).toBe(0);
  });

  it("never reports negative missing when more attempts exist than were queued", () => {
    const [row] = buildBroadcastHistory(
      [broadcast(B1, 1)],
      [attempt("+972500000001", B1, "sent"), attempt("+972500000002", B1, "sent")]
    );
    expect(row.missing).toBe(0);
    expect(row.delivered).toBe(2);
  });

  it("keeps each broadcast's attempts separate", () => {
    const rows = buildBroadcastHistory(
      [broadcast(B1, 1), broadcast(B2, 1)],
      [attempt("+972500000001", B1, "sent"), attempt("+972500000001", B2, "failed")]
    );
    const first = rows.find((r) => r.sentAt === B1)!;
    const second = rows.find((r) => r.sentAt === B2)!;
    expect(first.delivered).toBe(1);
    expect(second.failed).toBe(1);
  });

  it("ignores attempts with no broadcast (welcome and birthday sends)", () => {
    const [row] = buildBroadcastHistory(
      [broadcast(B1, 1)],
      [
        attempt("+972500000001", B1, "sent"),
        { phone: "+972500000009", broadcastAt: null, status: "sent" },
      ]
    );
    expect(row.delivered).toBe(1);
    expect(row.missing).toBe(0);
  });

  it("returns newest first", () => {
    const rows = buildBroadcastHistory([broadcast(B2, 1), broadcast(B1, 1)], []);
    expect(rows.map((r) => r.sentAt)).toEqual([B1, B2]);
  });
});
