import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * An opt-out link has to work for as long as the SMS holding it sits on
 * someone's phone. Shortening the link changed both the URL shape and the
 * token format, so every form we have ever printed is exercised here — a
 * customer tapping "remove me" on a year-old message must not be bounced to
 * the signup page.
 */

let deactivated: { phone: string; source: string }[] = [];
vi.mock("@/lib/db", () => ({
  initDb: async () => {},
  getDb: () => ({ type: "sqlite", conn: { close: () => {} } }),
  // deactivateByPhone binds [now, source, withPlus, digitsOnly].
  runDb: async (_db: unknown, _sql: string, params: unknown[]) => {
    deactivated.push({ phone: String(params[2]), source: String(params[1]) });
    return { rowCount: 1 };
  },
  queryCustomers: async () => [],
}));

import { applyUnsubscribeLink } from "@/lib/unsubscribe";
import { unsubscribeUrl } from "@/lib/sms-footer";
import { generateSecureToken } from "@/lib/security";
import { createHmac } from "crypto";

const SECRET = "unsub-link-test-secret";
const PHONE = "+972501234567";

beforeEach(() => {
  deactivated = [];
  process.env.NODE_ENV = "test";
  process.env.SECRET_KEY = SECRET;
});

const hexToken = (p: string) =>
  createHmac("sha256", SECRET).update(p).digest("hex").slice(0, 32);

describe("the short link", () => {
  it("is 68 characters against the production domain, down from 102", () => {
    const url = unsubscribeUrl("https://oshioshi-gedera-sms.vercel.app", PHONE, generateSecureToken(PHONE));
    expect(url).toBe(
      `https://oshioshi-gedera-sms.vercel.app/u/0501234567/${generateSecureToken(PHONE)}`
    );
    expect(url).toHaveLength(68);
  });

  it("removes the customer when tapped", async () => {
    expect(await applyUnsubscribeLink("0501234567", generateSecureToken(PHONE))).toBe(true);
    expect(deactivated).toHaveLength(1);
    expect(deactivated[0].phone).toBe(PHONE);
    expect(deactivated[0].source).toBe("customer_link");
  });
});

describe("links already sent keep working", () => {
  it("accepts the old 972-prefixed number with the old 32-char hex token", async () => {
    expect(await applyUnsubscribeLink("972501234567", hexToken(PHONE))).toBe(true);
    expect(deactivated[0].phone).toBe(PHONE);
  });

  it("accepts the old number form with the new short token", async () => {
    expect(await applyUnsubscribeLink("972501234567", generateSecureToken(PHONE))).toBe(true);
  });

  it("accepts the new number form with the old hex token", async () => {
    expect(await applyUnsubscribeLink("0501234567", hexToken(PHONE))).toBe(true);
  });
});

describe("it still refuses what it should", () => {
  it("rejects a token minted for a different number, and removes nobody", async () => {
    expect(await applyUnsubscribeLink("0501234567", generateSecureToken("+972509999999"))).toBe(false);
    expect(deactivated).toHaveLength(0);
  });

  it("rejects a missing or junk token", async () => {
    expect(await applyUnsubscribeLink("0501234567", undefined)).toBe(false);
    expect(await applyUnsubscribeLink("0501234567", "")).toBe(false);
    expect(await applyUnsubscribeLink("0501234567", "deadbeef")).toBe(false);
    expect(deactivated).toHaveLength(0);
  });

  it("rejects an empty phone", async () => {
    expect(await applyUnsubscribeLink("", generateSecureToken(PHONE))).toBe(false);
  });
});
