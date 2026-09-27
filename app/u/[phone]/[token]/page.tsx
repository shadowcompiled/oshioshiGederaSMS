import { redirect } from "next/navigation";
import { applyUnsubscribeLink } from "@/lib/unsubscribe";
import UnsubscribedNotice from "@/app/unsubscribe/UnsubscribedNotice";

/**
 * The short opt-out link that goes in every SMS: /u/0501234567/<token>.
 *
 * Deliberately terse — this path is printed in every promotional message and
 * SMS is billed by the character. The long /unsubscribe/:phone?token= route is
 * still live for links already sent; both share applyUnsubscribeLink.
 */
export const dynamic = "force-dynamic";

export default async function ShortUnsubscribePage({
  params,
}: {
  params: Promise<{ phone: string; token: string }>;
}) {
  const { phone, token } = await params;
  // A bad or missing token is sent to the home page rather than told it was
  // rejected: the link is guessable in shape, and confirming which numbers are
  // members would leak the membership list one probe at a time.
  if (!(await applyUnsubscribeLink(phone, token))) redirect("/");
  return <UnsubscribedNotice />;
}
