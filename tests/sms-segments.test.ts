import { describe, expect, it } from "vitest";
import {
  smsUnits,
  billedMessagesForUnits,
  smsBilledMessages,
  estimateUnsubFooterUnits,
  BILLED_MESSAGE_UNITS,
} from "@/lib/sms-segments";

describe("smsUnits", () => {
  it("counts Hebrew letters, spaces and punctuation as 1 unit each", () => {
    expect(smsUnits("שלום, עולם!")).toBe(11);
  });

  it("counts an astral-plane emoji as 2 units (surrogate pair)", () => {
    expect(smsUnits("🍣")).toBe(2);
  });

  it("counts a newline as 1 unit", () => {
    expect(smsUnits("א\nב")).toBe(3);
  });
});

describe("billedMessagesForUnits", () => {
  it("bills by the provider's 202-character unit, not the GSM segment split", () => {
    expect(BILLED_MESSAGE_UNITS).toBe(202);
  });

  it.each([
    [0, 0],
    [1, 1],
    [70, 1], // the old GSM single-part boundary is no longer a price boundary
    [71, 1],
    [127, 1], // a typical short message plus the opt-out footer
    [201, 1],
    [202, 1], // the whole first unit is one billed message
    [203, 2], // one character past it costs a second
    [404, 2],
    [405, 3],
  ])("%i characters -> %i billed messages", (units, expected) => {
    expect(billedMessagesForUnits(units)).toBe(expected);
  });

  it("never bills for an empty message", () => {
    expect(billedMessagesForUnits(0)).toBe(0);
    expect(billedMessagesForUnits(-5)).toBe(0);
  });
});

describe("smsBilledMessages", () => {
  it("is billedMessagesForUnits over the text length", () => {
    expect(smsBilledMessages("א".repeat(202))).toBe(1);
    expect(smsBilledMessages("א".repeat(203))).toBe(2);
    expect(smsBilledMessages("")).toBe(0);
  });
});

describe("estimateUnsubFooterUnits", () => {
  it("matches the worker's footer template with a sample link", () => {
    const units = estimateUnsubFooterUnits("1111", "https://example.vercel.app");
    const expected =
      "\n\nלהסרה: השב/י 1111 או לחצ/י כאן: https://example.vercel.app/unsubscribe/972501234567?token=" +
      "x".repeat(32);
    expect(units).toBe(expected.length);
  });

  it("strips a trailing slash from the base URL", () => {
    expect(estimateUnsubFooterUnits("1111", "https://a.b/")).toBe(
      estimateUnsubFooterUnits("1111", "https://a.b")
    );
  });

  it("leaves room for a real message inside one billed unit", () => {
    // The footer is the fixed cost of every promotional send; if it ever grew
    // past the billing unit on its own, every message would cost two.
    expect(estimateUnsubFooterUnits()).toBeLessThan(BILLED_MESSAGE_UNITS);
  });
});
