import Link from "next/link";
import Logo from "../Logo";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error;
  const isWrong = error === "wrong";
  const isRate = error === "rate";
  const isSystem = error === "system";

  return (
    <div className="container">
      <div className="logo-area">
        <Logo />
      </div>
      <h2>כניסת מנהל</h2>
      {isWrong && <p className="error">סיסמה שגויה</p>}
      {isRate && <p className="error">יותר מדי ניסיונות. נסה שוב מאוחר יותר.</p>}
      {isSystem && <p className="error">שגיאת מערכת. בדוק את ההגדרות (מאגר נתונים, SECRET_KEY).</p>}
      <LoginForm />
      <Link href="/" className="small-text">
        חזור לדף הבית
      </Link>
    </div>
  );
}
