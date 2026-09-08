import { unsubFooter } from "@/lib/sms-footer";

/**
 * How many messages a broadcast is billed for.
 *
 * The character count itself is simple: Hebrew SMS is always UCS-2 (any char
 * outside GSM 03.38 forces the whole message to UCS-2, and every Hebrew letter
 * is outside it), billing counts UTF-16 code units, and that is exactly JS
 * `string.length`. Astral-plane emoji are surrogate pairs and correctly cost 2.
 *
 * What those characters *cost* is a provider decision, not a GSM one. The
 * technical split for UCS-2 is 70 characters for a single part and 67 for each
 * part of a concatenated message, but 019 bills a long message as one item up
 * to BILLED_MESSAGE_UNITS characters — so a 127-character message that is
 * technically two GSM segments is one billed message. The UI quotes the number
 * the invoice will show, because that is the number the operator is deciding
 * with.
 */

/** Reference only: the GSM/UCS-2 split, which is not how 019 bills. */
export const UCS2_SINGLE = 70;
export const UCS2_MULTI = 67;

/**
 * Characters included in one billed message on the current 019 plan.
 * If the plan changes, this is the only number to change.
 */
export const BILLED_MESSAGE_UNITS = 202;

export function smsUnits(text: string): number {
  return text.length;
}

/** Billed messages for a given character count. */
export function billedMessagesForUnits(units: number): number {
  if (units <= 0) return 0;
  return Math.ceil(units / BILLED_MESSAGE_UNITS);
}

/** Billed messages for a finished message body. */
export function smsBilledMessages(text: string): number {
  return billedMessagesForUnits(smsUnits(text));
}

const SAMPLE_PHONE_DIGITS = "972501234567";
const SAMPLE_TOKEN = "x".repeat(32); // generateSecureToken (lib/security.ts) emits 32 hex chars (.slice(0,32))

/**
 * Estimated UTF-16 length of the footer the SMS worker appends — the same
 * template lib/sms-footer.ts renders for real, measured against a sample link.
 * Token length is fixed and the recipient number varies by a char or two, so
 * treat the result as ≈.
 *
 * `canReply` must match the live sender: an alphanumeric sender id drops the
 * reply-keyword clause, which is ~13 characters. The admin composer passes the
 * server's real value (see app/admin/page.tsx) rather than assuming.
 */
export function estimateUnsubFooterUnits(
  keyword = "1111",
  baseUrl = "https://example.vercel.app",
  canReply = true
): number {
  const link = `${baseUrl.replace(/\/+$/, "")}/unsubscribe/${SAMPLE_PHONE_DIGITS}?token=${SAMPLE_TOKEN}`;
  return unsubFooter(link, { canReply, keyword }).length;
}
