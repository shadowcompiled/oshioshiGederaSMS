import { generateSecureToken } from "@/lib/security";
import { getPublicAppUrl } from "@/lib/app-url";
import { getUnsubscribeKeyword } from "@/lib/unsubscribe";
import { canReceiveSmsReplies } from "@/lib/sms";
import { unsubscribeUrl, withUnsubFooter, type FooterOptions } from "@/lib/sms-footer";

/**
 * Renders the exact text a promotional SMS will carry, for both the sender and
 * the preview. /api/send_sms_task (the QStash worker), /api/admin/send-test
 * and /api/admin/sms-preview all call renderBroadcastSms, which is what makes
 * "preview, then send" a real guarantee rather than an approximation.
 *
 * Transactional messages (the signup verification code) deliberately do NOT
 * come through here: they carry no marketing content and therefore no opt-out
 * footer. See lib/sms-messages.ts.
 */

/**
 * A stand-in recipient for the audience preview, where there is no single
 * number to render. Same digit count as a real Israeli mobile, so the link —
 * and therefore the segment count — measures true. Never sent to: the preview
 * endpoint does not send.
 */
export const PREVIEW_SAMPLE_PHONE = "+972500000000";

/** The footer variant the live configuration will actually produce. */
export function currentFooterOptions(): FooterOptions {
  return { canReply: canReceiveSmsReplies(), keyword: getUnsubscribeKeyword() };
}

export type RenderedSms = {
  /** The full message body, footer included, as handed to the provider. */
  text: string;
  /** The recipient's opt-out link, exposed so the preview can show it. */
  unsubLink: string;
  footer: FooterOptions;
};

/**
 * @param fallbackOrigin the request's own origin, used only when neither
 *   APP_URL nor a Vercel URL is set (matches the worker's previous behaviour).
 */
export function renderBroadcastSms(
  message: string,
  phone: string,
  fallbackOrigin = ""
): RenderedSms {
  const baseUrl = getPublicAppUrl() || fallbackOrigin;
  const unsubLink = unsubscribeUrl(baseUrl, phone, generateSecureToken(phone));
  const footer = currentFooterOptions();
  return { text: withUnsubFooter(message, unsubLink, footer), unsubLink, footer };
}
