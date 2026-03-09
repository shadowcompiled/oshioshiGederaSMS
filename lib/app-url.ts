/**
 * Base URL for public links (e.g. unsubscribe in SMS).
 * Prefer APP_URL / production URL so links don't point at preview deployments
 * that may show Vercel "Request Access" / deployment protection.
 */
export function getPublicAppUrl(): string {
  const fromEnv = (raw: string | undefined): string => {
    if (!raw || typeof raw !== "string") return "";
    const t = raw.trim().replace(/\/+$/, "");
    if (!t || /undefined/i.test(t)) return "";
    if (t.startsWith("https://") || t.startsWith("http://")) return t;
    return `https://${t}`;
  };
  return (
    fromEnv(process.env.APP_URL) ||
    fromEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    fromEnv(process.env.VERCEL_URL)
  );
}
