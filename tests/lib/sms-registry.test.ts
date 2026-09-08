import { describe, it, expect, afterEach, vi } from "vitest";
import {
  getSmsProvider,
  sendSms,
  isRealSmsConfigured,
  smsEnvironment,
  mockSmsOutbox,
  canReceiveSmsReplies,
  smsSendability,
} from "@/lib/sms";

/**
 * The safety guard is the point of lib/sms: a test run must be incapable of
 * sending, non-production environments must default to the mock, and even a
 * deliberately enabled non-production environment may only text allowlisted
 * numbers. These tests simulate each environment by stubbing NODE_ENV /
 * VITEST / VERCEL_ENV — the registry reads env per call, so no module
 * reloading is needed.
 */

/** Make the process look like it is NOT a test run (both markers must go —
 *  that is itself part of the guard's design). */
function stubEnvironment(env: "development" | "preview" | "production") {
  vi.stubEnv("VITEST", "");
  vi.stubEnv("NODE_ENV", env === "development" ? "development" : "production");
  vi.stubEnv("VERCEL_ENV", env === "preview" ? "preview" : "");
}

function stubAndroidCreds() {
  vi.stubEnv("ANDROID_SMS_GATEWAY_LOGIN", "login");
  vi.stubEnv("ANDROID_SMS_GATEWAY_PASSWORD", "pass");
}

function stub019Creds() {
  vi.stubEnv("SMS_019_TOKEN", "token-abc");
  vi.stubEnv("SMS_019_USERNAME", "oshioshi");
  vi.stubEnv("SMS_SENDER_ID", "OshiOshi");
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mockSmsOutbox.length = 0;
});

describe("guard: test environment", () => {
  it("is detected as test", () => {
    expect(smsEnvironment()).toBe("test");
  });

  it("returns the mock provider no matter what is configured", () => {
    vi.stubEnv("SMS_PROVIDER", "019");
    vi.stubEnv("SMS_ALLOW_REAL_SMS", "true");
    stub019Creds();
    expect(getSmsProvider().name).toBe("mock");
    expect(isRealSmsConfigured()).toBe(false);
  });

  it("sendSms records to the outbox and never touches the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sendSms("+972501234567", "hello");
    expect(res.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockSmsOutbox).toHaveLength(1);
    expect(mockSmsOutbox[0].to).toBe("+972501234567");
  });
});

describe("guard: development and preview", () => {
  it("development defaults to mock even with a real provider configured", () => {
    stubEnvironment("development");
    vi.stubEnv("SMS_PROVIDER", "android_gateway");
    stubAndroidCreds();
    expect(smsEnvironment()).toBe("development");
    expect(getSmsProvider().name).toBe("mock");
  });

  it("a Vercel preview deployment defaults to mock despite production env vars", () => {
    stubEnvironment("preview");
    vi.stubEnv("SMS_PROVIDER", "019");
    stub019Creds();
    expect(smsEnvironment()).toBe("preview");
    expect(getSmsProvider().name).toBe("mock");
  });

  it("SMS_ALLOW_REAL_SMS=true hands back the real provider", () => {
    stubEnvironment("development");
    vi.stubEnv("SMS_PROVIDER", "android_gateway");
    vi.stubEnv("SMS_ALLOW_REAL_SMS", "true");
    stubAndroidCreds();
    expect(getSmsProvider().name).toBe("android_gateway");
    expect(isRealSmsConfigured()).toBe(true);
  });
});

describe("guard: non-production allowlist", () => {
  function enableRealInDev() {
    stubEnvironment("development");
    vi.stubEnv("SMS_PROVIDER", "android_gateway");
    vi.stubEnv("SMS_ALLOW_REAL_SMS", "true");
    stubAndroidCreds();
  }

  it("refuses every send when the allowlist is empty", async () => {
    enableRealInDev();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sendSms("+972501234567", "hello");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("SMS_TEST_ALLOWLIST is empty");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a number that is not on the allowlist", async () => {
    enableRealInDev();
    vi.stubEnv("SMS_TEST_ALLOWLIST", "+972541111111");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sendSms("+972501234567", "hello");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not in SMS_TEST_ALLOWLIST");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends to an allowlisted number, tolerating format differences", async () => {
    enableRealInDev();
    // Local 05X format in the allowlist must match the +972 canonical form.
    vi.stubEnv("SMS_TEST_ALLOWLIST", "0501234567");
    const fetchSpy = vi.fn().mockResolvedValue(okJson({ id: "m1" }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sendSms("+972501234567", "hello");
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // The Android adapter still sends the exact legacy payload.
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({
      textMessage: { text: "hello" },
      phoneNumbers: ["+972501234567"],
      withDeliveryReport: true,
    });
  });
});

describe("production selection", () => {
  it("defaults to the Android gateway when SMS_PROVIDER is unset", () => {
    stubEnvironment("production");
    expect(smsEnvironment()).toBe("production");
    expect(getSmsProvider().name).toBe("android_gateway");
  });

  it("selects 019 when configured", () => {
    stubEnvironment("production");
    vi.stubEnv("SMS_PROVIDER", "019");
    stub019Creds();
    expect(getSmsProvider().name).toBe("019");
    expect(isRealSmsConfigured()).toBe(true);
  });

  it("an unknown SMS_PROVIDER fails loudly instead of guessing or faking success", async () => {
    stubEnvironment("production");
    vi.stubEnv("SMS_PROVIDER", "twilio");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sendSms("+972501234567", "hello");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Unknown SMS_PROVIDER "twilio"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("replies are possible with the Android gateway (SIM number sender)", () => {
    stubEnvironment("production");
    stubAndroidCreds();
    expect(canReceiveSmsReplies()).toBe(true);
  });

  it("replies are impossible under 019 with an alphanumeric sender name", () => {
    stubEnvironment("production");
    vi.stubEnv("SMS_PROVIDER", "019");
    stub019Creds(); // SMS_SENDER_ID=OshiOshi
    expect(canReceiveSmsReplies()).toBe(false);
  });

  it("replies are possible under 019 with a numeric source", () => {
    stubEnvironment("production");
    vi.stubEnv("SMS_PROVIDER", "019");
    stub019Creds();
    vi.stubEnv("SMS_019_SOURCE", "0559999900");
    expect(canReceiveSmsReplies()).toBe(true);
  });

  it("falls back to SMS_FALLBACK_PROVIDER when the primary fails", async () => {
    stubEnvironment("production");
    vi.stubEnv("SMS_PROVIDER", "019");
    vi.stubEnv("SMS_FALLBACK_PROVIDER", "android_gateway");
    stub019Creds();
    stubAndroidCreds();
    const fetchSpy = vi
      .fn()
      // 019 accepts the HTTP call but reports a non-zero (failed) status…
      .mockResolvedValueOnce(okJson({ status: 4, message: "insufficient credit" }))
      // …then the Android gateway succeeds.
      .mockResolvedValueOnce(okJson({ id: "m2" }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await sendSms("+972501234567", "hello");
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("019sms.co.il");
    expect(String(fetchSpy.mock.calls[1][0])).toContain("sms-gate.app");
  });
});

/**
 * smsSendability reports the guard's verdict instead of executing it, so the
 * admin preview can warn the operator BEFORE they press send rather than
 * after a message quietly goes nowhere. It must agree with sendSms in every
 * case — that is the whole contract.
 */
describe("smsSendability", () => {
  it("reports the mock provider as non-delivering during a test run", () => {
    const s = smsSendability("+972501234567");
    expect(s.provider).toBe("mock");
    expect(s.environment).toBe("test");
    expect(s.delivers).toBe(false);
    expect(s.refusal).toBeNull();
  });

  it("reports a configured 019 sender as delivering, with its sender name", () => {
    stubEnvironment("production");
    vi.stubEnv("SMS_PROVIDER", "019");
    stub019Creds();
    const s = smsSendability("+972501234567");
    expect(s.provider).toBe("019");
    expect(s.delivers).toBe(true);
    expect(s.senderName).toBe("OshiOshi");
    // An alphanumeric sender is one-way, which is what drops the reply
    // keyword from the footer.
    expect(s.canReceiveReplies).toBe(false);
  });

  it("reports a real provider with no credentials as not configured", () => {
    stubEnvironment("production");
    vi.stubEnv("SMS_PROVIDER", "019");
    const s = smsSendability("+972501234567");
    expect(s.configured).toBe(false);
    expect(s.delivers).toBe(false);
  });

  it("surfaces the allowlist refusal for the exact number asked about", () => {
    stubEnvironment("development");
    vi.stubEnv("SMS_PROVIDER", "android_gateway");
    vi.stubEnv("SMS_ALLOW_REAL_SMS", "true");
    stubAndroidCreds();
    vi.stubEnv("SMS_TEST_ALLOWLIST", "0541111111");
    expect(smsSendability("+972501234567").refusal).toContain("not in SMS_TEST_ALLOWLIST");
    expect(smsSendability("+972541111111").refusal).toBeNull();
  });

  it("agrees with sendSms: a reported refusal means the send is really refused", async () => {
    stubEnvironment("development");
    vi.stubEnv("SMS_PROVIDER", "android_gateway");
    vi.stubEnv("SMS_ALLOW_REAL_SMS", "true");
    stubAndroidCreds();
    vi.stubEnv("SMS_TEST_ALLOWLIST", "0541111111");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const reported = smsSendability("+972501234567").refusal;
    const actual = await sendSms("+972501234567", "hello");
    expect(reported).not.toBeNull();
    expect(actual.ok).toBe(false);
    if (!actual.ok) expect(actual.error).toBe(reported);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports no refusal without a phone, since there is nothing to check yet", () => {
    stubEnvironment("production");
    stubAndroidCreds();
    expect(smsSendability().refusal).toBeNull();
  });
});

describe("a multi-word 019 sender name", () => {
  it("is still one-way, so the footer must stay link-only", () => {
    // "OSHI GEDERA" is a name rather than a number: nothing can text it back,
    // which is what drops the reply keyword from the opt-out footer.
    stubEnvironment("production");
    vi.stubEnv("SMS_PROVIDER", "019");
    vi.stubEnv("SMS_019_TOKEN", "t");
    vi.stubEnv("SMS_019_USERNAME", "u");
    vi.stubEnv("SMS_019_SOURCE", "OSHI GEDERA");
    expect(canReceiveSmsReplies()).toBe(false);
    const s = smsSendability("+972501234567");
    expect(s.provider).toBe("019");
    expect(s.delivers).toBe(true);
    expect(s.senderName).toBe("OSHI GEDERA");
  });
});
