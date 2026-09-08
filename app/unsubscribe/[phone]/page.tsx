import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/security";
import { deactivateByPhone } from "@/lib/unsubscribe";
import Logo from "@/app/Logo";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ phone: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { phone: phoneParam } = await params;
  const { token } = await searchParams;

  if (!token) redirect("/");

  const clean = phoneParam.replace(/[^\d+]/g, "").slice(0, 20);
  const withPlus = clean.startsWith("+") ? clean : "+" + clean;
  const digitsOnly = clean.replace("+", "");

  if (!verifyToken(withPlus, token) && !verifyToken(digitsOnly, token)) {
    redirect("/");
  }

  try {
    await deactivateByPhone(withPlus, "customer_link");
  } catch (e) {
    console.error("Unsubscribe error:", e);
  }

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
