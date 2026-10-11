import UnsubscribePrompt from "@/app/unsubscribe/UnsubscribePrompt";
import { phoneFromShortLink } from "@/lib/unsubscribe-link";

export const dynamic = "force-dynamic";

/**
 * The short opt-out link that goes in every SMS: /u/0501234567/<token>.
 * Built by unsubscribeUrl in lib/unsubscribe-link.ts.
 */
export default async function ShortUnsubscribePage({
  params,
}: {
  params: Promise<{ phone: string; token: string }>;
}) {
  const { phone, token } = await params;
  return <UnsubscribePrompt phone={phoneFromShortLink(phone)} token={token} />;
}
