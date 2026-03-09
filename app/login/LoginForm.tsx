"use client";

import { useState } from "react";

export default function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok === true) {
        const token = (data as { token?: string }).token;
        window.location.href = token
          ? "/admin?session=" + encodeURIComponent(token)
          : "/admin";
        return;
      }
      if (res.status === 429 || data.error === "rate") {
        setError("rate");
        return;
      }
      setError("wrong");
    } catch {
      setError("wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <input
          type="password"
          name="password"
          placeholder="סיסמה"
          required
          autoComplete="current-password"
          disabled={loading}
        />
      </div>
      {error === "wrong" && <p className="error">סיסמה שגויה</p>}
      {error === "rate" && <p className="error">יותר מדי ניסיונות. נסה שוב מאוחר יותר.</p>}
      <button type="submit" disabled={loading}>
        {loading ? "נכנס..." : "כניסה"}
      </button>
    </form>
  );
}
