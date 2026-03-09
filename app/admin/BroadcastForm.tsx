"use client";

import { useState, useRef } from "react";

type Props = { importToken: string; activeCount: number; newCount: number };

export default function BroadcastForm({ importToken, activeCount, newCount }: Props) {
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = formRef.current;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (!form || !submitter) return;

    const onlyNew = submitter.getAttribute("value") === "new_only";
    const msg = onlyNew
      ? `לשלוח רק ל-${newCount} לקוחות חדשים (שטרם קיבלו הודעה)?`
      : `לשלוח לכולם (${activeCount} פעילים)?`;
    if (!confirm(msg)) return;

    setFeedback(null);
    setSending(true);
    const formData = new FormData(form);
    formData.set("send_to", onlyNew ? "new_only" : "all");
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
      } else {
        setFeedback({ ok: false, msg: res.ok ? "תגובה לא צפויה מהשרת." : `שגיאה ${res.status}` });
      }
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : "שגיאת רשת." });
    } finally {
      setSending(false);
    }
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
            color: feedback.ok ? "#2e7d32" : "#c62828",
          }}
        >
          {feedback.msg}
        </p>
      )}
      <form ref={formRef} onSubmit={handleSubmit}>
        <input type="hidden" name="import_token" value={importToken} />
        <textarea
          name="message"
          placeholder="הקלד הודעה כאן..."
          required
          disabled={sending}
          style={{ height: "100px", marginBottom: "10px" }}
        />
        <div style={{ marginTop: "5px", fontSize: "12px", color: "gray" }}>* קישור הסרה יתווסף אוטומטית</div>
        <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <button type="submit" name="send_to" value="all" style={{ margin: 0 }} disabled={sending}>
            {sending ? "שולח..." : `🚀 שלח לכולם (${activeCount})`}
          </button>
          {newCount > 0 && (
            <button
              type="submit"
              name="send_to"
              value="new_only"
              style={{ margin: 0, background: "#1976d2" }}
              disabled={sending}
            >
              📩 שלח רק לחדשים ({newCount})
            </button>
          )}
        </div>
      </form>
    </>
  );
}
