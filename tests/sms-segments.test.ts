import { describe, expect, it } from "vitest";
import {
  smsUnits,
  billedMessagesForUnits,
  smsBilledMessages,
  estimateUnsubFooterUnits,
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
  // 019 bills one message per 202 characters, not per 67-character GSM part.
  it.each([
    [0, 0],
    [1, 1],
    [70, 1],
    [71, 1], // two GSM parts, still one billed message
    [202, 1],
    [203, 2],
    [404, 2],
    [405, 3],
  ])("%i units -> %i billed", (units, expected) => {
    expect(billedMessagesForUnits(units)).toBe(expected);
  });
});

describe("smsBilledMessages", () => {
  it("is billedMessagesForUnits over the text length", () => {
    expect(smsBilledMessages("א".repeat(202))).toBe(1);
    expect(smsBilledMessages("א".repeat(203))).toBe(2);
    expect(smsBilledMessages("")).toBe(0);
  });

  it("quotes 3 billed messages for a 334-character broadcast on the live domain, not 7", () => {
    const footer = estimateUnsubFooterUnits("https://oshioshi-gedera.vercel.app");
    expect(billedMessagesForUnits(334 + footer)).toBe(3);
  });
});

describe("estimateUnsubFooterUnits", () => {
  it("matches the worker's footer with the short link", () => {
    const units = estimateUnsubFooterUnits("https://example.vercel.app");
    const expected =
      "\n\nלהסרה ממועדון הלקוחות לחץ כאן: https://example.vercel.app/u/0501234567/" + "x".repeat(8);
    expect(units).toBe(expected.length);
  });

  it("strips a trailing slash from the base URL", () => {
    expect(estimateUnsubFooterUnits("https://a.b/")).toBe(
      estimateUnsubFooterUnits("https://a.b")
    );
  });
});
