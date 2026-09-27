import { redirect } from "next/navigation";
import { applyUnsubscribeLink } from "@/lib/unsubscribe";
import UnsubscribedNotice from "@/app/unsubscribe/UnsubscribedNotice";

/**
 * The original, long opt-out link: /unsubscribe/972501234567?token=<32 hex>.
 *
 * New messages carry the short /u/:phone/:token form instead, but this route
 * must stay: every SMS already delivered contains a link in this shape, and an
 * opt-out that stopped working would be a broken promise to the customer and a
 * spam-law problem for the club. lib/security.ts likewise still honours the
 * older token formats.
 */
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ phone: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { phone } = await params;
  const { token } = await searchParams;
  if (!(await applyUnsubscribeLink(phone, token))) redirect("/");
  return <UnsubscribedNotice />;
}
