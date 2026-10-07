import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/security";
import Logo from "@/app/Logo";

export const dynamic = "force-dynamic";

/**
 * Opening the unsubscribe link no longer removes anyone — it asks first, and
 * the removal happens on the POST to /api/unsubscribe/confirm.
 *
 * That split is not only courtesy. A GET that mutates is fair game for anything
 * that follows links without a human: SMS app link previews, antivirus and
 * corporate-gateway URL scanners, and browser prefetch all issue GETs, and any
 * one of them silently unsubscribed the member before they had read the page.
 * The token is still verified here so a bad or missing one never reaches the
 * prompt.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ phone: string }>;
  searchParams: Promise<{ token?: string; done?: string }>;
}) {
  const { phone: phoneParam } = await params;
  const { token, done } = await searchParams;

  if (!token) redirect("/");

  const clean = phoneParam.replace(/[^\d+]/g, "").slice(0, 20);
  const withPlus = clean.startsWith("+") ? clean : "+" + clean;
  const digitsOnly = clean.replace("+", "");

  if (!verifyToken(withPlus, token) && !verifyToken(digitsOnly, token)) {
    redirect("/");
  }

  // Reached only via the confirm route's redirect, after the row is updated.
  if (done === "1") {
    return (
      <main className="sheet sheet-narrow" id="main-content">
        <Logo />
        <p className="sheet-label">הסרה מהדיוור</p>
        <h1>הוסרתם מרשימת התפוצה</h1>
        <p className="sheet-lede">
          לא נשלח לכם עוד הודעות. אם זו הייתה טעות, אפשר להצטרף שוב בכל רגע.
        </p>
        <div className="success-actions">
          <a className="btn-ghost" href="/">
            הצטרפות מחדש למועדון
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="sheet sheet-narrow" id="main-content">
      <Logo />
      <p className="sheet-label">הסרה מהדיוור</p>
      <h1>האם ברצונך לצאת ממועדון הלקוחות אושי אושי גדרה?</h1>
      <p className="sheet-lede">
        אם תצאו, לא נשלח לכם עוד מבצעים, הטבות ומתנות יום הולדת.
      </p>
      <form
        method="post"
        action="/api/unsubscribe/confirm"
        className="success-actions confirm-actions"
      >
        <input type="hidden" name="phone" value={digitsOnly} />
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="btn-danger">
          כן, הסירו אותי
        </button>
        <a className="btn-ghost" href="/">
          לא, אני נשאר/ת
        </a>
      </form>
    </main>
  );
}
