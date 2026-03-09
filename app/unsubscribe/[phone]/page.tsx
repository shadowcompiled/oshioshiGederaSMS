import { redirect } from "next/navigation";
import { getDb, runDb } from "@/lib/db";
import { verifyToken } from "@/lib/security";
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
  const candidatePhone = clean.startsWith("+") ? clean : "+" + clean;

  if (!verifyToken(candidatePhone, token) && !verifyToken(clean, token)) {
    redirect("/");
  }

  try {
    const db = getDb();
    if (db.type === "postgres") {
      await runDb(db, "UPDATE customers SET active = FALSE WHERE phone = $1", [candidatePhone]);
    } else {
      await runDb(db, "UPDATE customers SET active = 0 WHERE phone = $1", [candidatePhone]);
    }
    if (db.type === "sqlite") db.conn.close();
  } catch (e) {
    console.error("Unsubscribe error:", e);
  }

  return (
    <div className="container">
      <div className="logo-area">
        <Logo />
      </div>
      <h2 className="success">הוסרת בהצלחה</h2>
      <p>לא תקבל יותר הודעות מאיתנו.</p>
    </div>
  );
}
