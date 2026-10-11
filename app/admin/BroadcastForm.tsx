"use client";

import { useId, useState } from "react";
import { smsUnits, billedMessagesForUnits } from "@/lib/sms-segments";

/**
 * footerUnits is measured on the server against the live public URL (see
 * app/admin/page.tsx): the domain is the longest part of the opt-out link, and
 * the client can't know which one the SMS worker will print.
 */
type Props = { importToken: string; activeCount: number; newCount: number; footerUnits: number };

export default function BroadcastForm({ importToken, activeCount, newCount, footerUnits }: Props) {
  const ids = useId();
  const messageId = `${ids}-message`;
  const counterId = `${ids}-counter`;
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"all" | "new_only">("all");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);

  const units = smsUnits(message);
  const totalUnits = units === 0 ? 0 : units + footerUnits;
  const billedPerRecipient = billedMessagesForUnits(totalUnits);
  const recipients = audience === "all" ? activeCount : newCount;
  const level = billedPerRecipient >= 3 ? "high" : billedPerRecipient >= 2 ? "warn" : "ok";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const confirmMsg =
      audience === "new_only"
        ? `לשלוח רק ל-${newCount} לקוחות חדשים (שטרם קיבלו הודעה)?\n${billedPerRecipient} הודעות לחיוב לנמען, ~${newCount * billedPerRecipient} הודעות בסך הכל.`
        : `לשלוח לכולם (${activeCount} פעילים)?\n${billedPerRecipient} הודעות לחיוב לנמען, ~${activeCount * billedPerRecipient} הודעות בסך הכל.`;
    if (!confirm(confirmMsg)) return;

    setFeedback(null);
    setSending(true);
    const formData = new FormData();
    formData.set("message", message);
    formData.set("send_to", audience);
    formData.set("import_token", importToken);

    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (data.msg != null) {
        setFeedback({ ok: data.ok === true, msg: data.msg });
        if (data.ok === true) setMessage("");
      } else {
        setFeedback({ ok: false, msg: res.ok ? "תגובה לא צפויה מהשרת." : `שגיאה ${res.status}` });
      }
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : "שגיאת רשת." });
    } finally {
      setSending(false);
    }
  }

  function handleTestSend() {
    const phone = window.prompt("מספר טלפון לבדיקה (למשל 0501234567):");
    if (!phone) return;
    // Plain form POST so the existing 303-redirect-with-?msg= flow shows the result.
    const f = document.createElement("form");
    f.method = "POST";
    f.action = "/api/admin/send-test";
    const add = (name: string, value: string) => {
      const i = document.createElement("input");
      i.type = "hidden";
      i.name = name;
      i.value = value;
      f.appendChild(i);
    };
    add("import_token", importToken);
    add("phone", phone);
    add("message", message);
    document.body.appendChild(f);
    f.submit();
  }

  return (
    <>
      {feedback && (
        <p
          style={{
            marginBottom: "10px",
            padding: "8px 12px",
            borderRadius: "6px",
            fontWeight: "bold",
            backgroundColor: feedback.ok ? "#e8f5e9" : "#ffebee",
            color: feedback.ok ? "#1b5e20" : "#b71c1c",
          }}
          role={feedback.ok ? "status" : "alert"}
        >
          {feedback.msg}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor={messageId}>תוכן ההודעה</label>
          <textarea
            id={messageId}
            name="message"
            placeholder="הקלידו הודעה כאן..."
            required
            disabled={sending}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{ height: "100px" }}
            aria-describedby={counterId}
          />
        </div>
        {/* aria-live: the billed count is the number that decides what a
            broadcast costs, and it changes as the message is typed. */}
        <div id={counterId} className="sms-counter" data-level={level} aria-live="polite">
          <span>{units} תווים</span>
          <span>
            כולל קישור הסרה: ~{totalUnits} תווים · {billedPerRecipient} הודעות לחיוב לנמען
          </span>
        </div>
        {/* A radio group needs a group label, not just two field labels. The
            options sit in their own flex row: a <legend> inside a flex
            container lays out inconsistently across browsers. */}
        <fieldset className="audience-group">
          <legend>קהל היעד</legend>
          <div className="audience-options">
          <label>
            <input
              type="radio"
              name="audience"
              value="all"
              checked={audience === "all"}
              onChange={() => setAudience("all")}
              disabled={sending}
            />
            כל הפעילים ({activeCount})
          </label>
          <label>
            <input
              type="radio"
              name="audience"
              value="new_only"
              checked={audience === "new_only"}
              onChange={() => setAudience("new_only")}
              disabled={sending || newCount === 0}
            />
            רק חדשים שטרם קיבלו הודעה ({newCount})
          </label>
          </div>
        </fieldset>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <button
            type="submit"
            disabled={sending || message.trim() === "" || recipients === 0}
            style={{ width: "auto", flex: "1 1 12rem" }}
          >
            {sending ? "שולח..." : `🚀 שלח ל-${recipients} לקוחות`}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleTestSend}
            disabled={sending || message.trim() === ""}
            style={{ width: "auto", flex: "1 1 10rem" }}
          >
            <span aria-hidden="true">📱 </span>שלח בדיקה אליי
          </button>
        </div>
      </form>
    </>
  );
}
