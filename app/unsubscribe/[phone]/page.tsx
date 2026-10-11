import UnsubscribePrompt from "@/app/unsubscribe/UnsubscribePrompt";

export const dynamic = "force-dynamic";

/**
 * The long opt-out link, /unsubscribe/:phone?token=. New messages carry the
 * short /u/ form; this one stays live for links already sent, and as the page
 * the confirm route returns to after a removal.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ phone: string }>;
  searchParams: Promise<{ token?: string; done?: string }>;
}) {
  const { phone } = await params;
  const { token, done } = await searchParams;
  return <UnsubscribePrompt phone={phone} token={token} done={done === "1"} />;
}
