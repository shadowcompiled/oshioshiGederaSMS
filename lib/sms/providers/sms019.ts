import type { OutboundSms, SendSmsResult, SmsProvider } from "../types";

/**
 * Adapter for 019 (Telzar 019) — an Israeli SMS provider that supports an
 * alphanumeric Sender ID, so messages arrive from the restaurant's name
 * instead of a phone number.
 *
 * API (verified against https://docs.019sms.co.il, Aug 2025–2026 docs):
 *   POST https://019sms.co.il/api      with  Authorization: Bearer <token>
 *   { "sms": { "user": { "username": … }, "source": …,
 *              "destinations": { "phone": [{ "_": "05XXXXXXXX" }] },
 *              "message": … } }
 *   → { "status": 0, "message": "SMS will be sent", "shipment_id": … }
 * Any non-zero status is a documented API error (3 = bad credentials,
 * 4 = insufficient credit, …). Destinations use LOCAL format (05X…, no +972);
 * non-Israeli numbers need includes_international=1 and stay in E.164 digits.
 *
 * 019 also exposes https://019sms.co.il/api/test, which validates a request
 * without sending anything — point SMS_019_API_URL at it to smoke-test
 * credentials and payload shape with zero delivery risk.
 */

const DEFAULT_019_API_URL = "https://019sms.co.il/api";

/**
 * 019's source constraint: at most 11 characters, English letters and digits,
 * and a space is allowed inside the name — "OSHI GEDERA" is a real registered
 * sender on this account and 019 delivers from it. What stays rejected is
 * Hebrew, "+", other punctuation, anything past 11 characters, and a name made
 * only of whitespace. The value is trimmed before it gets here, so the space
 * this permits is always an internal one.
 */
const SOURCE_RE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9 ]{1,11}$/;

function sms019Config(): { token: string; username: string; source: string; url: string } {
  return {
    token: (process.env.SMS_019_TOKEN || "").trim(),
    username: (process.env.SMS_019_USERNAME || "").trim(),
    // Provider-specific override first, then the shared sender-name variable.
    source: (process.env.SMS_019_SOURCE || process.env.SMS_SENDER_ID || "").trim(),
    url: (process.env.SMS_019_API_URL || DEFAULT_019_API_URL).trim().replace(/\/+$/, ""),
  };
}

/** Convert the app's canonical +972… form to what 019 expects. */
export function to019Destination(phone: string): { phone: string; international: boolean } {
  const digits = String(phone ?? "").replace(/\D/g, "");
  // Israeli mobile in international form: 972 + 9 digits (5XXXXXXXX).
  if (digits.startsWith("972") && digits.length === 12) {
    return { phone: "0" + digits.slice(3), international: false };
  }
  // Already local (05XXXXXXXX) — pass through.
  if (digits.startsWith("05") && digits.length === 10) {
    return { phone: digits, international: false };
  }
  return { phone: digits, international: true };
}

export const sms019Provider: SmsProvider = {
  name: "019",

  isConfigured(): boolean {
    const { token, username, source } = sms019Config();
    return token !== "" && username !== "" && SOURCE_RE.test(source);
  },

  async send(message: OutboundSms, timeoutMs: number = 15000): Promise<SendSmsResult> {
    const { token, username, source: configuredSource, url } = sms019Config();
    // A per-message senderId wins over env so a future caller could vary the
    // name, but both must satisfy 019's constraint.
    const source = (message.senderId || configuredSource).trim();
    if (!token || !username) return { ok: false, error: "019 SMS is not configured" };
    if (!SOURCE_RE.test(source)) {
      return {
        ok: false,
        error: `019 sender id "${source}" is invalid (1-11 English letters, digits or spaces)`,
      };
    }

    const dest = to019Destination(message.to);
    if (!dest.phone) return { ok: false, error: "019: empty destination number" };

    const payload = {
      sms: {
        user: { username },
        source,
        destinations: { phone: [{ _: dest.phone }] },
        message: message.text,
        ...(dest.international ? { includes_international: "1" } : {}),
      },
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, status: res.status, error: `019 HTTP ${res.status}: ${body.slice(0, 500)}` };
      }

      const body: unknown = await res.json().catch(() => null);
      const status = (body as { status?: unknown } | null)?.status;
      if (Number(status) === 0) return { ok: true, body };
      const detail = (body as { message?: unknown } | null)?.message;
      return { ok: false, error: `019 status ${String(status)}: ${String(detail ?? "unknown error")}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
