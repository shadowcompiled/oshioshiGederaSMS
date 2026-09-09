import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for the SMS verification gate. The point of these is the
 * single most important guarantee in the signup flow: no code path writes a
 * customer row for a phone number that has not answered a code.
 *
 * The database and the SMS gateway are mocked so the assertions are about what
 * the route decides, not about what a local SQLite file happens to contain.
 */

const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: async () => headersMock(),
}));

const sentSms: { phone: string; text: string }[] = [];
vi.mock("@/lib/sms", () => ({
  isRealSmsConfigured: () => true,
  sendSms: async (phone: string, text: string) => {
    sentSms.push({ phone, text });
    return { ok: true, body: null };
  },
}));

const consumeSignupToken = vi.fn();
const startPhoneVerification = vi.fn();
vi.mock("@/lib/phone-verification", () => ({
  consumeSignupToken: (...a: unknown[]) => consumeSignupToken(...a),
  startPhoneVerification: (...a: unknown[]) => startPhoneVerification(...a),
  confirmPhoneVerification: vi.fn(),
}));

let customerRows: Record<string, unknown>[] = [];
const statements: { sql: string; params: unknown[] }[] = [];
vi.mock("@/lib/db", () => ({
  initDb: async () => {},
  getDb: () => ({ type: "postgres", conn: {} }),
  queryCustomers: async () => customerRows,
  runDb: async (_db: unknown, sql: string, params: unknown[]) => {
    statements.push({ sql, params });
    return { rowCount: 1 };
  },
}));

const { POST: submit } = await import("@/app/api/submit/route");
const { POST: start } = await import("@/app/api/signup/start/route");

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.SECRET_KEY = "signup-gate-test-secret";
  // Every case below asserts behaviour with verification switched ON; the
  // "switched off" describe block overrides this.
  process.env.REQUIRE_PHONE_VERIFICATION = "true";
  delete process.env.QSTASH_TOKEN; // keeps the welcome SMS out of these tests
  headersMock.mockReturnValue(new Headers({ "x-forwarded-for": `10.0.0.${Math.ceil(Math.random() * 250)}` }));
  customerRows = [];
  statements.length = 0;
  sentSms.length = 0;
  consumeSignupToken.mockReset();
  startPhoneVerification.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const VALID_FIELDS = {
  name: "דנה",
  phone: "0501234567",
  email: "dana@example.com",
  date_of_birth: "1990-05-05",
  city: "גדרה",
  consent: "on",
};

function post(url: string, fields: Record<string, string>): NextRequest {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new NextRequest(url, {
    method: "POST",
    body: fd,
    headers: { Accept: "application/json" },
  });
}

const insertRan = () => statements.some((s) => /INSERT INTO customers/i.test(s.sql));

describe("POST /api/submit — verification gate", () => {
  it("refuses to create a membership with no verification token", async () => {
    consumeSignupToken.mockResolvedValue(false);
    const res = await submit(post("http://localhost/api/submit", VALID_FIELDS));
    await expect(res.json()).resolves.toEqual({ success: false, error: "verification_required" });
    expect(insertRan()).toBe(false);
  });

  it("refuses a token the server does not recognise", async () => {
    consumeSignupToken.mockResolvedValue(false);
    const res = await submit(
      post("http://localhost/api/submit", { ...VALID_FIELDS, verification_token: "f".repeat(64) })
    );
    await expect(res.json()).resolves.toEqual({ success: false, error: "verification_required" });
    expect(insertRan()).toBe(false);
  });

  it("creates the membership once the token is accepted", async () => {
    consumeSignupToken.mockResolvedValue(true);
    const res = await submit(
      post("http://localhost/api/submit", { ...VALID_FIELDS, verification_token: "a".repeat(64) })
    );
    await expect(res.json()).resolves.toEqual({ success: true, error: null });
    expect(insertRan()).toBe(true);
  });

  it("spends the token against the normalized E.164 number, not the typed one", async () => {
    consumeSignupToken.mockResolvedValue(true);
    await submit(
      post("http://localhost/api/submit", {
        ...VALID_FIELDS,
        phone: "050-123-4567",
        verification_token: "b".repeat(64),
      })
    );
    expect(consumeSignupToken).toHaveBeenCalledWith(expect.anything(), "+972501234567", "b".repeat(64));
  });

  it("rejects an invalid form before it ever looks at the token", async () => {
    const res = await submit(
      post("http://localhost/api/submit", {
        ...VALID_FIELDS,
        date_of_birth: "2015-05-05",
        verification_token: "a".repeat(64),
      })
    );
    await expect(res.json()).resolves.toEqual({ success: false, error: "underage" });
    expect(consumeSignupToken).not.toHaveBeenCalled();
    expect(insertRan()).toBe(false);
  });

  it("does not burn the token when the number is already an active member", async () => {
    customerRows = [{ phone: "+972501234567", active: true }];
    const res = await submit(
      post("http://localhost/api/submit", { ...VALID_FIELDS, verification_token: "a".repeat(64) })
    );
    await expect(res.json()).resolves.toEqual({ success: false, error: "already_registered" });
    expect(consumeSignupToken).not.toHaveBeenCalled();
  });
});

describe("POST /api/signup/start", () => {
  it("texts a code for a number that is not yet a member", async () => {
    // A code with no digits in common with the phone number, so the
    // "never echoed back" assertion below can't pass or fail by coincidence.
    startPhoneVerification.mockResolvedValue({
      ok: true,
      code: "908070",
      expiresInSec: 600,
      resendInSec: 60,
      sendsLeft: 4,
    });
    const res = await start(post("http://localhost/api/signup/start", VALID_FIELDS));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.phone).toBe("+972501234567");
    expect(sentSms).toHaveLength(1);
    expect(sentSms[0].phone).toBe("+972501234567");
    expect(sentSms[0].text).toContain("908070");
    // The plaintext code must never travel back to the browser.
    expect(body.devCode).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("908070");
  });

  it("never sends an SMS to a number that already has an active membership", async () => {
    customerRows = [{ active: true }];
    const res = await start(post("http://localhost/api/signup/start", VALID_FIELDS));
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "already_registered" });
    expect(startPhoneVerification).not.toHaveBeenCalled();
    expect(sentSms).toHaveLength(0);
  });

  it("validates the whole form before spending an SMS on it", async () => {
    for (const [field, value, error] of [
      ["email", "not-an-email", "invalid_email"],
      ["phone", "123", "invalid_phone"],
      ["date_of_birth", "2015-01-01", "underage"],
      ["name", "", "missing"],
    ] as const) {
      const res = await start(post("http://localhost/api/signup/start", { ...VALID_FIELDS, [field]: value }));
      await expect(res.json()).resolves.toMatchObject({ ok: false, error });
    }
    expect(sentSms).toHaveLength(0);
  });

  it("requires the SMS consent checkbox before texting anything", async () => {
    const { consent, ...withoutConsent } = VALID_FIELDS;
    const res = await start(post("http://localhost/api/signup/start", withoutConsent));
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "consent" });
    expect(sentSms).toHaveLength(0);
  });

  it("passes the per-number throttle refusal through to the caller", async () => {
    startPhoneVerification.mockResolvedValue({ ok: false, error: "cooldown", retryAfterSec: 42 });
    const res = await start(post("http://localhost/api/signup/start", VALID_FIELDS));
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "cooldown", retryAfterSec: 42 });
    expect(sentSms).toHaveLength(0);
  });
});

describe("REQUIRE_PHONE_VERIFICATION switched off", () => {
  beforeEach(() => {
    process.env.REQUIRE_PHONE_VERIFICATION = "false";
  });

  it("tells the browser no code is needed, and sends no SMS", async () => {
    const res = await start(post("http://localhost/api/signup/start", VALID_FIELDS));
    await expect(res.json()).resolves.toEqual({
      ok: true,
      phone: "+972501234567",
      verificationRequired: false,
    });
    expect(sentSms).toHaveLength(0);
    expect(startPhoneVerification).not.toHaveBeenCalled();
  });

  it("creates the membership with no token at all", async () => {
    const res = await submit(post("http://localhost/api/submit", VALID_FIELDS));
    await expect(res.json()).resolves.toEqual({ success: true, error: null });
    expect(insertRan()).toBe(true);
    expect(consumeSignupToken).not.toHaveBeenCalled();
  });

  it("still refuses a number that already belongs to an active member", async () => {
    // One membership per number is a database-level guarantee, not something
    // the verification switch controls.
    customerRows = [{ active: true }];
    const startRes = await start(post("http://localhost/api/signup/start", VALID_FIELDS));
    await expect(startRes.json()).resolves.toMatchObject({ ok: false, error: "already_registered" });

    const submitRes = await submit(post("http://localhost/api/submit", VALID_FIELDS));
    await expect(submitRes.json()).resolves.toEqual({ success: false, error: "already_registered" });
    expect(insertRan()).toBe(false);
  });

  it("still validates the form", async () => {
    const res = await submit(
      post("http://localhost/api/submit", { ...VALID_FIELDS, date_of_birth: "2015-05-05" })
    );
    await expect(res.json()).resolves.toEqual({ success: false, error: "underage" });
    expect(insertRan()).toBe(false);
  });

  it("reads the switch per request, so flipping it needs no redeploy", async () => {
    const off = await submit(post("http://localhost/api/submit", VALID_FIELDS));
    await expect(off.json()).resolves.toEqual({ success: true, error: null });

    process.env.REQUIRE_PHONE_VERIFICATION = "true";
    consumeSignupToken.mockResolvedValue(false);
    const on = await submit(post("http://localhost/api/submit", VALID_FIELDS));
    await expect(on.json()).resolves.toEqual({ success: false, error: "verification_required" });
  });

  it("defaults to off when the variable is not set at all", async () => {
    delete process.env.REQUIRE_PHONE_VERIFICATION;
    const res = await submit(post("http://localhost/api/submit", VALID_FIELDS));
    await expect(res.json()).resolves.toEqual({ success: true, error: null });
  });

  for (const value of ["0", "off", "no", "FALSE", " false ", ""]) {
    it(`treats ${JSON.stringify(value)} as off`, async () => {
      process.env.REQUIRE_PHONE_VERIFICATION = value;
      const res = await submit(post("http://localhost/api/submit", VALID_FIELDS));
      await expect(res.json()).resolves.toEqual({ success: true, error: null });
    });
  }

  for (const value of ["true", "1", "yes", "on", "TRUE"]) {
    it(`treats ${JSON.stringify(value)} as on`, async () => {
      process.env.REQUIRE_PHONE_VERIFICATION = value;
      consumeSignupToken.mockResolvedValue(false);
      const res = await submit(post("http://localhost/api/submit", VALID_FIELDS));
      await expect(res.json()).resolves.toEqual({ success: false, error: "verification_required" });
    });
  }
});
