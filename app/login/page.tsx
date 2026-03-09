import Link from "next/link";
import Logo from "../Logo";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error;
  const isWrong = error === "wrong";
  const isRate = error === "rate";

  return (
    <div className="container">
      <div className="logo-area">
        <Logo />
      </div>
      <h2>כניסת מנהל</h2>
      {isWrong && <p className="error">סיסמה שגויה</p>}
      {isRate && <p className="error">יותר מדי ניסיונות. נסה שוב מאוחר יותר.</p>}
      <form action="/api/login" method="POST">
        <div className="form-group">
          <input
            type="password"
            name="password"
            placeholder="סיסמה"
            required
            autoComplete="current-password"
          />
        </div>
        <button type="submit">כניסה</button>
      </form>
      <Link href="/" className="small-text">
        חזור לדף הבית
      </Link>
    </div>
  );
}
