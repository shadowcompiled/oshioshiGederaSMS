import { toIsraelDateStr } from "./dates";

export type KpiCustomer = {
  active: boolean;
  created_at: string | null;
  unsubscribed_at: string | null;
};

export type Kpis = {
  total: number;
  active: number;
  newLast7: number;
  removedLast30: number;
};

/** YYYY-MM-DD string arithmetic in UTC (inputs are already calendar dates). */
function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Dashboard KPIs over the full customer list. `todayIsrael` is injected
 * (israelToday() at the call site) so the math is pure and testable.
 */
export function computeKpis(customers: KpiCustomer[], todayIsrael: string): Kpis {
  const weekCutoff = shiftDateStr(todayIsrael, -6); // 7-day inclusive window
  const monthCutoff = shiftDateStr(todayIsrael, -29); // 30-day inclusive window

  let active = 0;
  let newLast7 = 0;
  let removedLast30 = 0;

  for (const c of customers) {
    if (c.active) active++;
    const created = toIsraelDateStr(c.created_at);
    if (created && created >= weekCutoff && created <= todayIsrael) newLast7++;
    const removed = toIsraelDateStr(c.unsubscribed_at);
    if (!c.active && removed && removed >= monthCutoff && removed <= todayIsrael) removedLast30++;
  }

  return { total: customers.length, active, newLast7, removedLast30 };
}
