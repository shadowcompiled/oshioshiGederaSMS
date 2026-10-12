/**
 * The single place that sends an SMS: 019 (Telzar 019), with the club's
 * alphanumeric Sender ID, so messages arrive from "OSHI GEDERA" rather than a
 * phone number. The club no longer uses the Android SMS Gateway; there is no
 * fallback, so a 019 failure is reported rather than silently rerouted
 * through a different sender.
 *
 * API (https://docs.019sms.co.il):
 *   POST https://019sms.co.il/api   Authorization: Bearer <token>
 *   { "sms": { "user": { "username" }, "source", "destinations": { "phone": [{ "_": "05XXXXXXXX" }] }, "message" } }
 *   -> { "status": 0, "message": "SMS will be sent", "shipment_id": … }
 * Any non-zero status is an API error (3 = bad credentials, 4 = insufficient
 * credit, …). Destinations are LOCAL format (05X…, no +972); non-Israeli
 * numbers need includes_international=1 and stay as digits.
 *
 * 019 also exposes https://019sms.co.il/api/test, which validates a request
 * without sending — point SMS_019_API_URL at it to check credentials and
 * payload with zero delivery risk.
 *
 * Env is read per call rather than at module load so a serverless instance
 * picks up a rotated credential without a redeploy, and so tests can flip the
 * configuration between cases.
 */

const DEFAULT_019_API_URL = "https://019sms.co.il/api";

/**
 * 019's sender constraint: 1-11 English letters, digits or internal spaces
 * ("OSHI GEDERA" is the registered sender). Hebrew, "+", punctuation and
 * anything longer are rejected by 019, so they are rejected here first.
 */
const SOURCE_RE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9 ]{1,11}$/;

function sms019Config(): { token: string; username: string; source: string; url: string } {
  return {
    token: (process.env.SMS_019_TOKEN || "").trim(),
    username: (process.env.SMS_019_USERNAME || "").trim(),
    source: (process.env.SMS_019_SOURCE || "").trim(),
    url: (process.env.SMS_019_API_URL || DEFAULT_019_API_URL).trim().replace(/\/+$/, ""),
  };
}

/** The app's +972… form to what 019 expects. */
export function to019Destination(phone: string): { phone: string; international: boolean } {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("972") && digits.length === 12) return { phone: "0" + digits.slice(3), international: false };
  if (digits.startsWith("05") && digits.length === 10) return { phone: digits, international: false };
  return { phone: digits, international: true };
}

export function isSmsGatewayConfigured(): boolean {
  const { token, username, source } = sms019Config();
  return token !== "" && username !== "" && SOURCE_RE.test(source);
}

export type SendSmsResult = { ok: true; body: unknown } | { ok: false; status?: number; error: string };

/** Send one SMS immediately. The caller owns the message text verbatim — no
 *  footer is appended here, because transactional messages (verification codes)
 *  must not carry a marketing opt-out line. */
export async function sendSmsViaGateway(
  phone: string,
  text: string,
  timeoutMs: number = 15000
): Promise<SendSmsResult> {
  const { token, username, source, url } = sms019Config();
  if (!token || !username) return { ok: false, error: "019 SMS is not configured" };
  if (!SOURCE_RE.test(source)) {
    return { ok: false, error: `019 sender id "${source}" is invalid (1-11 English letters, digits or spaces)` };
  }

  const dest = to019Destination(phone);
  if (!dest.phone) return { ok: false, error: "019: empty destination number" };

  const payload = {
    sms: {
      user: { username },
      source,
      destinations: { phone: [{ _: dest.phone }] },
      message: text,
      ...(dest.international ? { includes_international: "1" } : {}),
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
}
