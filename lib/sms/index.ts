import type { OutboundSms, SendSmsResult, SmsProvider } from "./types";
import { androidGatewayProvider } from "./providers/android-gateway";
import { sms019Provider } from "./providers/sms019";
import { mockSmsProvider } from "./providers/mock";
import { formatPhone } from "@/lib/validation";

export type { OutboundSms, SendSmsResult, SmsProvider } from "./types";
export { mockSmsOutbox } from "./providers/mock";

/**
 * The single door every outbound SMS goes through, and the safety mechanism
 * that keeps development and tests from ever texting a real customer.
 *
 * Provider selection is configuration: SMS_PROVIDER names the adapter
 * ("android_gateway" — the production default — "019", or "mock"), and
 * SMS_FALLBACK_PROVIDER optionally names a second adapter tried when the
 * first fails, so a new vendor can be cut over with the old one still armed.
 *
 * The guard, in order of precedence:
 *   1. A test run (NODE_ENV=test / Vitest) ALWAYS gets the mock provider.
 *      Nothing can override this — a test suite must be incapable of sending.
 *   2. Anywhere that is not true production — local dev, `next build` off
 *      Vercel, and Vercel *preview* deployments (which share production env
 *      vars!) — gets the mock provider unless SMS_ALLOW_REAL_SMS=true was set
 *      deliberately.
 *   3. Even with SMS_ALLOW_REAL_SMS=true, a non-production environment may
 *      only send to numbers listed in SMS_TEST_ALLOWLIST. An empty allowlist
 *      refuses every send, so a stray broadcast job is inert.
 * Production (NODE_ENV=production and VERCEL_ENV absent or "production") is
 * the only place a real provider runs unrestricted.
 */

export type SmsEnvironment = "test" | "development" | "preview" | "production";

export function smsEnvironment(): SmsEnvironment {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return "test";
  if (process.env.NODE_ENV !== "production") return "development";
  const vercelEnv = (process.env.VERCEL_ENV || "").trim();
  if (vercelEnv && vercelEnv !== "production") return "preview";
  return "production";
}

const REAL_PROVIDERS: Record<string, SmsProvider> = {
  [androidGatewayProvider.name]: androidGatewayProvider,
  [sms019Provider.name]: sms019Provider,
};

/** Fail-safe stand-in for a typo'd SMS_PROVIDER: surfaces an error on every
 *  send instead of silently succeeding (mock) or guessing a vendor. */
function unknownProvider(name: string): SmsProvider {
  return {
    name: `unknown(${name})`,
    isConfigured: () => false,
    send: async () => ({ ok: false, error: `Unknown SMS_PROVIDER "${name}"` }),
  };
}

function providerByName(name: string): SmsProvider {
  if (name === "" || name === androidGatewayProvider.name) return androidGatewayProvider;
  if (name === mockSmsProvider.name) return mockSmsProvider;
  const real = REAL_PROVIDERS[name];
  if (real) return real;
  console.error(`SMS: unknown provider "${name}" — refusing to send`);
  return unknownProvider(name);
}

function allowRealSms(): boolean {
  return (process.env.SMS_ALLOW_REAL_SMS || "").trim().toLowerCase() === "true";
}

/** The provider the current environment is allowed to use. */
export function getSmsProvider(): SmsProvider {
  const env = smsEnvironment();
  if (env === "test") return mockSmsProvider;

  const requested = (process.env.SMS_PROVIDER || "").trim().toLowerCase();
  if (env !== "production" && !allowRealSms()) {
    if (requested && requested !== mockSmsProvider.name) {
      console.warn(
        `SMS: ${env} environment — using the mock provider instead of "${requested}". ` +
          `Set SMS_ALLOW_REAL_SMS=true (and SMS_TEST_ALLOWLIST) to really send here.`
      );
    }
    return mockSmsProvider;
  }
  return providerByName(requested);
}

/** True when the active provider would actually deliver a message — i.e. it
 *  is a configured real vendor, not the mock. Drives the signup flow's
 *  "return the code on screen instead" development fallback. */
export function isRealSmsConfigured(): boolean {
  const provider = getSmsProvider();
  return provider.name !== mockSmsProvider.name && provider.isConfigured();
}

/**
 * Whether a customer can text back to whatever these messages arrive from.
 * The Android gateway sends from a SIM, so replies work. 019 sends from the
 * configured `source`: a numeric source can receive replies, an alphanumeric
 * sender name cannot — an SMS "from OshiOshi" is one-way, so telling the
 * customer to reply with the unsubscribe keyword would be a dead end (and a
 * spam-law liability). The footer in /api/send_sms_task keys off this.
 */
export function canReceiveSmsReplies(): boolean {
  const provider = getSmsProvider();
  if (provider.name === sms019Provider.name) {
    const source = (process.env.SMS_019_SOURCE || process.env.SMS_SENDER_ID || "").trim();
    return /^\d+$/.test(source);
  }
  // android_gateway sends from its SIM; the mock mirrors that default.
  return true;
}

function digitsOf(phone: string): string {
  return formatPhone(phone).replace(/\D/g, "");
}

/** Numbers a non-production environment may really text. */
function testAllowlist(): Set<string> {
  return new Set(
    (process.env.SMS_TEST_ALLOWLIST || "")
      .split(",")
      .map((p) => digitsOf(p))
      .filter(Boolean)
  );
}

function refusedOutsideAllowlist(
  provider: SmsProvider,
  to: string
): Extract<SendSmsResult, { ok: false }> | null {
  if (provider.name === mockSmsProvider.name) return null;
  if (smsEnvironment() === "production") return null;
  const allowed = testAllowlist();
  if (allowed.size === 0) {
    return {
      ok: false,
      error:
        "SMS refused: real sending is enabled outside production but SMS_TEST_ALLOWLIST is empty. " +
        "List the test numbers you own before sending.",
    };
  }
  if (!allowed.has(digitsOf(to))) {
    return {
      ok: false,
      error: `SMS refused: ${to} is not in SMS_TEST_ALLOWLIST (non-production sends are restricted to owned test numbers)`,
    };
  }
  return null;
}

export type SendSmsOptions = { timeoutMs?: number };

/**
 * Send one SMS through the active provider (falling back to
 * SMS_FALLBACK_PROVIDER in production when the primary fails). The caller
 * owns the message text verbatim — no footer is appended here, because
 * transactional messages (verification codes) must not carry a marketing
 * opt-out line.
 */
export async function sendSms(
  phone: string,
  text: string,
  opts: SendSmsOptions = {}
): Promise<SendSmsResult> {
  const provider = getSmsProvider();
  // No senderId here on purpose. SMS_SENDER_ID is *environment*, not a
  // per-message choice, so resolving it belongs to the adapter that knows its
  // vendor's precedence — and only the adapter's own view can agree with
  // canReceiveSmsReplies() below. Injecting it here used to make
  // message.senderId (SMS_SENDER_ID) beat SMS_019_SOURCE at send time while
  // canReceiveSmsReplies() still read SMS_019_SOURCE first: set both, with a
  // numeric source and an alphanumeric name, and the footer promised a reply
  // keyword on a message sent from a name that can never receive one. The
  // field stays on OutboundSms for a caller that genuinely wants to vary the
  // name for one message.
  const message: OutboundSms = { to: phone, text };

  const refused = refusedOutsideAllowlist(provider, phone);
  if (refused) {
    console.error(refused.error);
    return refused;
  }

  const result = await provider.send(message, opts.timeoutMs);
  if (result.ok) return result;

  // Fallback chain: production only (non-production is already allowlisted to
  // owned numbers; keep failure loud and simple there), real providers only,
  // and never the one that just failed.
  if (smsEnvironment() === "production") {
    const fallbackName = (process.env.SMS_FALLBACK_PROVIDER || "").trim().toLowerCase();
    const fallback = fallbackName ? REAL_PROVIDERS[fallbackName] : undefined;
    if (fallback && fallback.name !== provider.name && fallback.isConfigured()) {
      console.error(
        `SMS: provider "${provider.name}" failed (${result.error}); retrying via "${fallback.name}"`
      );
      return fallback.send(message, opts.timeoutMs);
    }
  }
  return result;
}

export type SmsSendability = {
  /** Adapter that would handle the send ("019", "android_gateway", "mock"). */
  provider: string;
  environment: SmsEnvironment;
  /** Whether that adapter has the credentials it needs. */
  configured: boolean;
  /** True only when a send would reach a real handset. False for the mock. */
  delivers: boolean;
  /** Alphanumeric sender name the recipient will see, when there is one. */
  senderName: string;
  canReceiveReplies: boolean;
  /**
   * Why a send would be refused before it ever reaches the vendor — the
   * non-production allowlist guard. Null when nothing stands in the way.
   * Pass a phone to have it checked against SMS_TEST_ALLOWLIST.
   */
  refusal: string | null;
};

/**
 * What would happen if we sent right now — the same decisions sendSms() makes,
 * reported instead of executed. This exists so the admin preview can state the
 * truth ("the mock provider is active: nothing will actually be delivered",
 * "this number is not in SMS_TEST_ALLOWLIST") *before* the operator commits,
 * rather than after a send silently goes nowhere.
 */
export function smsSendability(phone?: string): SmsSendability {
  const provider = getSmsProvider();
  const configured = provider.isConfigured();
  const isMock = provider.name === mockSmsProvider.name;
  return {
    provider: provider.name,
    environment: smsEnvironment(),
    configured,
    delivers: !isMock && configured,
    senderName:
      provider.name === sms019Provider.name
        ? (process.env.SMS_019_SOURCE || process.env.SMS_SENDER_ID || "").trim()
        : "",
    canReceiveReplies: canReceiveSmsReplies(),
    refusal: phone ? (refusedOutsideAllowlist(provider, phone)?.error ?? null) : null,
  };
}
