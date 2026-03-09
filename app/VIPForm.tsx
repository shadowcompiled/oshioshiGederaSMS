"use client";

import { useState, useRef } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "אנא מלא את כל שדות החובה",
  invalid_phone: "מספר טלפון לא תקין",
  invalid_email: 'כתובת דוא"ל לא תקינה',
  already_registered: "⚠️ אתה כבר רשום למועדון! המספר שלך כבר קיים במערכת.",
  system: "תקלה במערכת",
  rate: "יותר מדי בקשות. נסה שוב מאוחר יותר.",
};

export default function VIPForm() {
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const form = formRef.current;
    if (!form) return;

    setLoading(true);
    const formData = new FormData(form);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json" },
      });
      const data = await res.json();

      if (data.success) {
        setFeedback({ type: "success", message: "✅ נרשמת בהצלחה!" });
        form.reset();
      } else if (data.error && ERROR_MESSAGES[data.error]) {
        setFeedback({ type: "error", message: ERROR_MESSAGES[data.error] });
      } else {
        setFeedback({ type: "error", message: "שגיאה. נסה שוב." });
      }
    } catch {
      setFeedback({ type: "error", message: "תקלה במערכת. נסה שוב." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">שם מלא *</label>
          <input type="text" id="name" name="name" placeholder="שמך" required maxLength={100} />
        </div>
        <div className="form-group">
          <label htmlFor="phone">טלפון *</label>
          <input type="tel" id="phone" name="phone" placeholder="050-1234567" required maxLength={20} />
        </div>
        <div className="form-group">
          <label htmlFor="email">דוא&quot;ל *</label>
          <input type="email" id="email" name="email" placeholder="example@email.com" required />
        </div>
        <div className="form-group">
          <label htmlFor="dob">תאריך לידה *</label>
          <input type="date" id="dob" name="date_of_birth" required />
        </div>
        <div className="form-group">
          <label htmlFor="wedding">יום חתונה *</label>
          <input type="date" id="wedding" name="wedding_day" required />
        </div>
        <div className="form-group">
          <label htmlFor="city">עיר *</label>
          <input type="text" id="city" name="city" placeholder="גדרה" maxLength={50} required />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "שולח..." : "הצטרף למועדון"}
        </button>
      </form>
      {feedback && (
        <p
          className={feedback.type === "success" ? "success" : "error"}
          style={{ marginTop: "14px", marginBottom: 0 }}
          role="alert"
        >
          {feedback.message}
        </p>
      )}
    </>
  );
}
