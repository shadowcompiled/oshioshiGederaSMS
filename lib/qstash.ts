const DEFAULT_QSTASH_HOST = "https://qstash.upstash.io";

/** QStash publish base: default global host, or the origin of QSTASH_URL (EU region). */
export function getQstashPublishBase(): string {
  const raw = process.env.QSTASH_URL;
  if (!raw || !String(raw).trim()) return DEFAULT_QSTASH_HOST;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.origin;
  } catch {
    return DEFAULT_QSTASH_HOST;
  }
}

/** Normalize a base URL to https://host with no trailing slash, or "" if unusable. */
export function normalizeBaseUrl(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/undefined/i.test(trimmed)) return "";
  if (trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("http://")) return trimmed;
  return `https://${trimmed}`;
}

/** Resolve this app's public base URL: request origin first, then env fallbacks. */
export function resolveAppBaseUrl(requestOrigin: string | undefined): string {
  return (
    normalizeBaseUrl(requestOrigin) ||
    normalizeBaseUrl(process.env.VERCEL_URL) ||
    normalizeBaseUrl(process.env.APP_URL) ||
    normalizeBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL)
  );
}

export type PublishResult = { ok: boolean; status?: number; error?: string };

/**
 * Publish a single SMS job to QStash, which will call our /api/send_sms_task
 * worker. Mirrors the original Python behavior: raw POST, target endpoint
 * appended directly to the publish path.
 */
export async function publishSmsTask(args: {
  targetEndpoint: string;
  phone: string;
  message: string;
  secret: string;
  token: string;
  timeoutMs?: number;
  /** What kind of message this is, carried through so the worker can log it. */
  kind?: string;
  /** sent_at of the broadcasts row this belongs to; omitted for welcome/birthday. */
  broadcastAt?: string | null;
}): Promise<PublishResult> {
  const {
    targetEndpoint,
    phone,
    message,
    secret,
    token,
    timeoutMs = 12000,
    kind,
    broadcastAt,
  } = args;
  const url = `${getQstashPublishBase()}/v2/publish/${targetEndpoint}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone, message, secret, kind, broadcast_at: broadcastAt ?? null }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text();
    return { ok: false, status: res.status, error: `QStash ${res.status}: ${text.slice(0, 120)}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
