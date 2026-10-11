/**
 * The opt-out link and footer, in one place. The SMS worker, the admin test
 * send and the composer's cost estimate all build them from here, so the
 * estimate can't drift from what customers actually receive.
 *
 * Pure (no env, no crypto) so the client-side composer can import it.
 */

/** Prefix of the footer the SMS worker appends, before the link. */
export const UNSUB_FOOTER_PREFIX = "\n\nלהסרה ממועדון הלקוחות לחץ כאן: ";

/**
 * A recipient's opt-out link, kept short because it is printed (and billed) in
 * every promotional SMS: "/u/" rather than "/unsubscribe/", the token as a path
 * segment rather than "?token=", and the number in local 05X form rather than
 * with the 972 country code. The long /unsubscribe/:phone?token= form still
 * resolves, because links already sitting on customers' phones must keep
 * working.
 */
export function unsubscribeUrl(baseUrl: string, phone: string, token: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  // 972XXXXXXXXX -> 0XXXXXXXXX. Anything else passes through as digits, so a
  // non-Israeli number still gets a link that resolves.
  const local = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
  return `${String(baseUrl ?? "").replace(/\/+$/, "")}/u/${local}/${token}`;
}

/**
 * The phone from a short link back in 972 digits form — the inverse of
 * unsubscribeUrl, so the token (an HMAC over the stored +972 number) verifies.
 */
export function phoneFromShortLink(param: string): string {
  const digits = String(param ?? "").replace(/\D/g, "").slice(0, 20);
  return digits.startsWith("0") ? "972" + digits.slice(1) : digits;
}

/** The footer exactly as it is appended, leading blank lines included. */
export function unsubFooter(link: string): string {
  return `${UNSUB_FOOTER_PREFIX}${link}`;
}
