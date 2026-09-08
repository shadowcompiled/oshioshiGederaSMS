import { describe, expect, it } from "vitest";
import { computeKpis, type KpiCustomer } from "@/lib/kpis";

// computeKpis takes "today" (Israel local, YYYY-MM-DD) injected for determinism.
const TODAY = "2026-06-11";

function cust(over: Partial<KpiCustomer>): KpiCustomer {
  return {
    active: true,
    created_at: "2026-06-10 08:00:00",
    unsubscribed_at: null,
    received_message_at: "2026-06-10 09:00:00",
    ...over,
  };
}

describe("computeKpis", () => {
  it("returns zeros for an empty list", () => {
    expect(computeKpis([], TODAY)).toEqual({
      total: 0,
      active: 0,
      newLast7: 0,
      removedLast30: 0,
    });
  });

  it("counts active vs total and never-messaged actives", () => {
    const k = computeKpis(
      [
        cust({}),
        cust({}),
        cust({ active: false, unsubscribed_at: "2026-06-01 10:00:00" }),
      ],
      TODAY
    );
    expect(k.total).toBe(3);
    expect(k.active).toBe(2);
  });

  it("counts signups within the last 7 Israel-local days (inclusive window)", () => {
    const k = computeKpis(
      [
        cust({ created_at: "2026-06-11 05:00:00" }), // today
        cust({ created_at: "2026-06-05 05:00:00" }), // 6 days ago — inside
        cust({ created_at: "2026-06-04 05:00:00" }), // 7 days ago — outside
        cust({ created_at: null }),
      ],
      TODAY
    );
    expect(k.newLast7).toBe(2);
  });

  it("counts removals within the last 30 days only for inactive customers", () => {
    const k = computeKpis(
      [
        cust({ active: false, unsubscribed_at: "2026-06-01 10:00:00" }), // inside
        cust({ active: false, unsubscribed_at: "2026-05-13 10:00:00" }), // 29 days ago — inside
        cust({ active: false, unsubscribed_at: "2026-05-12 10:00:00" }), // 30 days ago — outside
        cust({ active: true, unsubscribed_at: "2026-06-01 10:00:00" }), // re-joined — not counted
      ],
      TODAY
    );
    expect(k.removedLast30).toBe(2);
  });
});
