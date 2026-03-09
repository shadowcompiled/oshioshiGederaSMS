// In-memory rate limit (per serverless instance). For production at scale consider Upstash Redis.
const store = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 1000; // 1 minute

function getKey(ip: string, limitKey: string): string {
  return `${ip}:${limitKey}`;
}

function cleanup(): void {
  const now = Date.now();
  Array.from(store.entries()).forEach(([k, v]) => {
    if (v.resetAt < now) store.delete(k);
  });
}

export function checkRateLimit(
  ip: string,
  limitKey: string,
  maxRequests: number
): { ok: boolean; remaining: number } {
  if (store.size > 10000) cleanup();
  const key = getKey(ip, limitKey);
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, entry);
  }
  entry.count += 1;
  const remaining = Math.max(0, maxRequests - entry.count);
  return { ok: entry.count <= maxRequests, remaining };
}

// Predefined limits (same as Flask: 200/day, 50/hour for general; specific for submit, login, etc.)
export const LIMITS = {
  home: { max: 20, window: "minute" },
  submit: { max: 5, window: "minute" },
  login: { max: 5, window: "minute" },
  exportCsv: { max: 10, window: "hour" },
  broadcast: { max: 3, window: "hour" },
  forceInit: { max: 1, window: "hour" },
  sendSmsTask: { max: 100, window: "minute" },
  unsubscribe: { max: 10, window: "minute" },
} as const;
