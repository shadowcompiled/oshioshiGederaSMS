import { describe, expect, it } from "vitest";
import {
  smsUnits,
  segmentsForUnits,
  smsSegments,
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

describe("segmentsForUnits", () => {
  it.each([
    [0, 0],
    [1, 1],
    [70, 1], // single-segment boundary
    [71, 2], // crossing 70 jumps straight to 67-per-segment math
    [134, 2],
    [135, 3],
    [201, 3],
    [202, 4],
  ])("%i units -> %i segments", (units, expected) => {
    expect(segmentsForUnits(units)).toBe(expected);
  });
});

describe("smsSegments", () => {
  it("is segmentsForUnits over the text length", () => {
    expect(smsSegments("א".repeat(70))).toBe(1);
    expect(smsSegments("א".repeat(71))).toBe(2);
    expect(smsSegments("")).toBe(0);
  });
});

describe("estimateUnsubFooterUnits", () => {
  it("matches the worker's footer template with a sample link", () => {
    const units = estimateUnsubFooterUnits("https://example.vercel.app");
    const expected =
      "\n\nלהסרה ממועדון הלקוחות לחץ כאן: https://example.vercel.app/unsubscribe/972501234567?token=" +
      "x".repeat(8);
    expect(units).toBe(expected.length);
  });

  it("strips a trailing slash from the base URL", () => {
    expect(estimateUnsubFooterUnits("https://a.b/")).toBe(
      estimateUnsubFooterUnits("https://a.b")
    );
  });
});
