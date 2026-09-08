/**
 * The opt-out footer, in one place.
 *
 * Three call sites used to build this string independently — the broadcast
 * worker, the admin test-send, and the composer's segment estimate — and they
 * had drifted apart: the test message carried a different footer than the one
 * customers received, so "send a test to myself" was not actually testing the
 * production message. Everything that renders or measures the footer now goes
 * through these two pure functions, and the preview in the admin UI is the
 * same text the vendor receives.
 *
 * Pure on purpose: no env, no crypto, no database. That keeps this module
 * importable from the client bundle (the live character counter needs it)
 * while lib/sms-render.ts owns the server-only half — the per-recipient token
 * and the provider's reply capability.
 */

export type FooterOptions = {
  /**
   * Whether the recipient can text back to whatever the message arrives from.
   * An alphanumeric sender ("OshiOshi" via 019) is one-way, so instructing the
   * customer to reply with the keyword would be a dead end — and, under the
   * Israeli spam law, an opt-out route that does not work.
   */
  canReply: boolean;
  /** The keyword a reply-capable sender listens for (UNSUBSCRIBE_KEYWORD). */
  keyword: string;
};

/** A recipient's own one-click opt-out link. */
export function unsubscribeUrl(baseUrl: string, phone: string, token: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const base = String(baseUrl ?? "").replace(/\/+$/, "");
  return `${base}/unsubscribe/${digits}?token=${token}`;
}

/** The footer exactly as it is appended, leading blank line included. */
export function unsubFooter(link: string, opts: FooterOptions): string {
  return opts.canReply
    ? `\n\nלהסרה: השב/י ${opts.keyword} או לחצ/י כאן: ${link}`
    : `\n\nלהסרה: לחצ/י כאן: ${link}`;
}

/** The delivered message: the operator's text verbatim, plus the footer. */
export function withUnsubFooter(message: string, link: string, opts: FooterOptions): string {
  return `${message}${unsubFooter(link, opts)}`;
}
