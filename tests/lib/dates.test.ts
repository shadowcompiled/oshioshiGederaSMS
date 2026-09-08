import { describe, it, expect } from "vitest";
import { getBirthMonth, toIsraelDateStr, israelToday, isAtLeastAge, toIsraelDateTimeStr } from "@/lib/dates";

describe("getBirthMonth", () => {
  it("parses ISO YYYY-MM-DD", () => {
    expect(getBirthMonth("1990-03-15")).toBe(3);
  });
  it("parses Israeli day-first DD/MM/YYYY", () => {
    expect(getBirthMonth("15/03/1990")).toBe(3);
  });
  it("parses dotted DD.MM.YYYY", () => {
    expect(getBirthMonth("15.03.1990")).toBe(3);
  });
  it("parses single-digit day/month with 2-digit year", () => {
    expect(getBirthMonth("5/7/90")).toBe(7);
  });
  it("returns null for empty/nullish", () => {
    expect(getBirthMonth("")).toBeNull();
    expect(getBirthMonth(null)).toBeNull();
    expect(getBirthMonth(undefined)).toBeNull();
  });
  it("returns null for unparseable text", () => {
    expect(getBirthMonth("not a date")).toBeNull();
  });
  it("returns null for an out-of-range month", () => {
    expect(getBirthMonth("1990-13-01")).toBeNull();
  });
});

describe("toIsraelDateStr", () => {
  // June is IDT (UTC+3) in Israel.
  it("rolls a late-UTC instant into the next Israel day", () => {
    // 22:30 UTC on Jun 7 = 01:30 Jun 8 in Israel.
    expect(toIsraelDateStr("2026-06-07T22:30:00Z")).toBe("2026-06-08");
  });
  it("keeps a daytime UTC instant on the same Israel day", () => {
    // 10:00 UTC = 13:00 Israel, still Jun 7.
    expect(toIsraelDateStr("2026-06-07T10:00:00Z")).toBe("2026-06-07");
  });
  it("treats a zone-less SQLite/Postgres timestamp as UTC", () => {
    // "2026-06-07 22:30:00" stored UTC -> Israel Jun 8.
    expect(toIsraelDateStr("2026-06-07 22:30:00")).toBe("2026-06-08");
  });
  it("accepts a Date object", () => {
    expect(toIsraelDateStr(new Date("2026-06-07T10:00:00Z"))).toBe("2026-06-07");
  });
  it("returns null for empty/nullish/unparseable", () => {
    expect(toIsraelDateStr("")).toBeNull();
    expect(toIsraelDateStr(null)).toBeNull();
    expect(toIsraelDateStr(undefined)).toBeNull();
    expect(toIsraelDateStr("not a date")).toBeNull();
  });
});

describe("israelToday", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(israelToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isAtLeastAge", () => {
  it("counts the birthday itself as reaching the age", () => {
    expect(isAtLeastAge("2008-08-20", 18, "2026-08-20")).toBe(true);
  });
  it("rejects the day before the 18th birthday", () => {
    expect(isAtLeastAge("2008-08-21", 18, "2026-08-20")).toBe(false);
  });
  it("handles month and day boundaries", () => {
    expect(isAtLeastAge("2008-12-31", 18, "2026-08-20")).toBe(false);
    expect(isAtLeastAge("2008-01-01", 18, "2026-08-20")).toBe(true);
    expect(isAtLeastAge("2008-08-19", 18, "2026-08-20")).toBe(true);
  });
  it("accepts clearly adult and rejects clearly minor dates", () => {
    expect(isAtLeastAge("1970-05-05", 18, "2026-08-20")).toBe(true);
    expect(isAtLeastAge("2015-05-05", 18, "2026-08-20")).toBe(false);
  });
  it("supports Israeli day-first formats", () => {
    expect(isAtLeastAge("20/08/2008", 18, "2026-08-20")).toBe(true);
    expect(isAtLeastAge("21.08.2008", 18, "2026-08-20")).toBe(false);
  });
  it("fails closed on missing or unparseable dates", () => {
    expect(isAtLeastAge("", 18, "2026-08-20")).toBe(false);
    expect(isAtLeastAge(null, 18, "2026-08-20")).toBe(false);
    expect(isAtLeastAge("not-a-date", 18, "2026-08-20")).toBe(false);
    expect(isAtLeastAge("2008-02-31", 18, "2026-08-20")).toBe(false); // impossible day
  });
});

describe("toIsraelDateTimeStr", () => {
  it("converts a stored UTC instant to the exact Israel-local time", () => {
    // 2026-09-08 07:05 UTC is 10:05 in Israel (IDT, UTC+3).
    expect(toIsraelDateTimeStr("2026-09-08T07:05:00.000Z")).toBe("08/09/2026, 10:05");
  });

  it("treats a zone-less stored timestamp as UTC, like the date helper does", () => {
    // Postgres CURRENT_TIMESTAMP / SQLite datetime('now') write no zone.
    expect(toIsraelDateTimeStr("2026-09-08 07:05:00")).toBe("08/09/2026, 10:05");
  });

  it("uses winter time when the date falls outside DST", () => {
    // 2026-01-15 07:05 UTC is 09:05 in Israel (IST, UTC+2).
    expect(toIsraelDateTimeStr("2026-01-15T07:05:00.000Z")).toBe("15/01/2026, 09:05");
  });

  it("returns null for empty or unparseable values", () => {
    expect(toIsraelDateTimeStr(null)).toBeNull();
    expect(toIsraelDateTimeStr("")).toBeNull();
    expect(toIsraelDateTimeStr("not a date")).toBeNull();
  });
});
