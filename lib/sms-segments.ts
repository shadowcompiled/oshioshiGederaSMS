import { unsubFooter, unsubscribeUrl } from "@/lib/unsubscribe-link";

/**
 * How many messages a broadcast is billed for.
 *
 * Hebrew SMS is always UCS-2 (any char outside GSM 03.38 forces the whole
 * message to UCS-2, and every Hebrew letter is outside it). Billing counts
 * UTF-16 code units — which is exactly JS string.length. Astral-plane emoji
 * are surrogate pairs and correctly cost 2.
 *
 * What those characters cost is the provider's decision, not GSM's. The
 * technical split is 70 characters for a single part and 67 per part of a
 * longer one, but 019 bills a long message as one item per
 * BILLED_MESSAGE_UNITS characters. Quoting the 67-character split made a
 * 334-character broadcast look like 7 messages per recipient when the invoice
 * says 3; the composer quotes the invoice, because that is the number the
 * operator decides with.
 */

/** Characters in one billed message on the current 019 plan. If the plan changes, change only this. */
export const BILLED_MESSAGE_UNITS = 202;

export function smsUnits(text: string): number {
  return text.length;
}

export function billedMessagesForUnits(units: number): number {
  if (units <= 0) return 0;
  return Math.ceil(units / BILLED_MESSAGE_UNITS);
}

export function smsBilledMessages(text: string): number {
  return billedMessagesForUnits(smsUnits(text));
}

const SAMPLE_PHONE = "+972501234567";
const SAMPLE_TOKEN = "x".repeat(8); // generateSecureToken (lib/security.ts) emits 8 base62 chars

/**
 * UTF-16 length of the footer the SMS worker appends, built by the same
 * functions the worker uses so the estimate cannot drift from the real link.
 * Pass the live public URL — the domain is the longest part of the link. The
 * recipient number varies by a digit or so; treat the result as ≈.
 */
export function estimateUnsubFooterUnits(baseUrl = "https://example.vercel.app"): number {
  return unsubFooter(unsubscribeUrl(baseUrl, SAMPLE_PHONE, SAMPLE_TOKEN)).length;
}
