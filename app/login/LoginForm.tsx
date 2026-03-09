"use client";

export default function LoginForm() {
  return (
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
  );
}
