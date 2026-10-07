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

/** The 128-bit hex token the short one replaced — still live in sent messages. */
function hex128Token(phone: string): string {
  return createHmac("sha256", SECRET).update(phone).digest("hex").slice(0, 32);
}

describe("unsubscribe token", () => {
  const phone = "+972501234567";

  it("generates an 8-char base62 token", () => {
    const t = generateSecureToken(phone);
    expect(t).toMatch(/^[0-9A-Za-z]{8}$/);
  });
  it("is stable for the same phone", () => {
    expect(generateSecureToken(phone)).toBe(generateSecureToken(phone));
  });
  it("verifies a freshly generated token", () => {
    expect(verifyToken(phone, generateSecureToken(phone))).toBe(true);
  });
  it("still verifies the previous 32-char hex token (links already sent)", () => {
    expect(verifyToken(phone, hex128Token(phone))).toBe(true);
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
