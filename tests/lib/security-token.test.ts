import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { generateSecureToken, verifyToken } from "@/lib/security";

const SECRET = "unit-test-secret-key";
beforeEach(() => {
  process.env.SECRET_KEY = SECRET;
  process.env.NODE_ENV = "test";
});

function legacyToken(phone: string): string {
  const data = `${phone}:${SECRET}`;
  return createHmac("sha256", SECRET).update(data).digest("hex").slice(0, 16);
}

describe("unsubscribe token", () => {
  const phone = "+972501234567";

  it("generates a 16-char (96-bit) base64url token", () => {
    const t = generateSecureToken(phone);
    expect(t).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
  it("verifies a freshly generated token", () => {
    expect(verifyToken(phone, generateSecureToken(phone))).toBe(true);
  });
  it("still verifies a legacy 16-char token (backward compat)", () => {
    expect(verifyToken(phone, legacyToken(phone))).toBe(true);
  });
  it("rejects a token for a different phone", () => {
    expect(verifyToken("+972500000000", generateSecureToken(phone))).toBe(false);
  });
  it("rejects a garbage token", () => {
    expect(verifyToken(phone, "deadbeef")).toBe(false);
  });
});

describe("older token formats keep working", () => {
  // An opt-out link must work for as long as the SMS holding it exists on
  // someone's phone. Messages sent before the token was shortened carry the
  // 32-character hex form, and tapping them must still remove the customer.
  const phone = "+972501234567";

  it("still verifies the 32-char hex token", () => {
    const hex = createHmac("sha256", SECRET).update(phone).digest("hex").slice(0, 32);
    expect(hex).toHaveLength(32);
    expect(verifyToken(phone, hex)).toBe(true);
  });

  it("the short and hex tokens are different strings, both accepted", () => {
    const short = generateSecureToken(phone);
    const hex = createHmac("sha256", SECRET).update(phone).digest("hex").slice(0, 32);
    expect(short).not.toBe(hex);
    expect(verifyToken(phone, short)).toBe(true);
    expect(verifyToken(phone, hex)).toBe(true);
  });

  it("a short token for another number is still rejected", () => {
    expect(verifyToken("+972500000000", generateSecureToken(phone))).toBe(false);
  });
});
