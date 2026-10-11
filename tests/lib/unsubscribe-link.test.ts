import { describe, it, expect } from "vitest";
import { unsubscribeUrl, phoneFromShortLink, unsubFooter } from "@/lib/unsubscribe-link";
import { generateSecureToken, verifyToken } from "@/lib/security";

describe("unsubscribeUrl", () => {
  it("prints the number in local 05X form, with the token as a path segment", () => {
    expect(unsubscribeUrl("https://oshioshi-gedera.vercel.app/", "+972501234567", "Ab3xK9mQ")).toBe(
      "https://oshioshi-gedera.vercel.app/u/0501234567/Ab3xK9mQ"
    );
  });

  it("is 18 characters shorter than the long form it replaces", () => {
    const base = "https://oshioshi-gedera.vercel.app";
    const long = `${base}/unsubscribe/972501234567?token=Ab3xK9mQ`;
    expect(long.length).toBe(74);
    expect(unsubscribeUrl(base, "+972501234567", "Ab3xK9mQ").length).toBe(56);
  });

  it("passes a non-Israeli number through as digits", () => {
    expect(unsubscribeUrl("https://a.b", "+447700900123", "t")).toBe("https://a.b/u/447700900123/t");
  });
});

describe("phoneFromShortLink", () => {
  it("turns the 05X form back into 972 digits", () => {
    expect(phoneFromShortLink("0501234567")).toBe("972501234567");
  });

  it("leaves a 972 or foreign number alone", () => {
    expect(phoneFromShortLink("972501234567")).toBe("972501234567");
    expect(phoneFromShortLink("447700900123")).toBe("447700900123");
  });
});

describe("short link round trip", () => {
  it("a link built for a stored +972 number verifies for that number only", () => {
    const phone = "+972501234567";
    const token = generateSecureToken(phone);
    const [, , , , localPhone, linkToken] = unsubscribeUrl("https://a.b", phone, token).split("/");
    const recovered = phoneFromShortLink(localPhone);
    // The page checks both spellings, exactly as UnsubscribePrompt does.
    const ok = (p: string) => verifyToken("+" + p, linkToken) || verifyToken(p, linkToken);
    expect(ok(recovered)).toBe(true);
    expect(ok(phoneFromShortLink("0509999999"))).toBe(false);
  });
});

describe("unsubFooter", () => {
  it("keeps the customer-facing wording unchanged", () => {
    expect(unsubFooter("L")).toBe("\n\nלהסרה ממועדון הלקוחות לחץ כאן: L");
  });
});
