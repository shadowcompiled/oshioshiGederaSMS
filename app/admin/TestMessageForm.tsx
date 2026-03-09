"use client";

export default function TestMessageForm() {
  return (
    <form
      action="/api/admin/send-test"
      method="POST"
      style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "400px", marginTop: "12px" }}
    >
      <h4 style={{ margin: "0 0 4px 0" }}>📱 שליחת הודעת בדיקה</h4>
      <label style={{ fontSize: "13px" }}>
        מספר טלפון
        <input
          type="text"
          name="phone"
          placeholder="0501234567"
          required
          style={{ display: "block", marginTop: "4px", padding: "6px 8px", width: "100%", direction: "ltr" }}
        />
      </label>
      <label style={{ fontSize: "13px" }}>
        הודעה
        <textarea
          name="message"
          placeholder="הודעת בדיקה"
          required
          rows={3}
          style={{ display: "block", marginTop: "4px", padding: "6px 8px", width: "100%", resize: "vertical" }}
        />
      </label>
      <button type="submit" style={{ alignSelf: "flex-start", padding: "8px 14px", cursor: "pointer" }}>
        שלח הודעת בדיקה
      </button>
    </form>
  );
}
