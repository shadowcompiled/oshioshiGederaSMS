"use client";

type Props = { importToken: string; activeCount: number; newCount: number };

export default function BroadcastForm({ importToken, activeCount, newCount }: Props) {
  const action = `/api/admin/broadcast?import_token=${encodeURIComponent(importToken)}`;
  return (
    <form
      action={action}
      method="POST"
      onSubmit={(e) => {
        const onlyNew = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "new_only";
        const msg = onlyNew
          ? `לשלוח רק ל-${newCount} לקוחות חדשים (שטרם קיבלו הודעה)?`
          : `לשלוח לכולם (${activeCount} פעילים)?`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="import_token" value={importToken} />
      <textarea
        name="message"
        placeholder="הקלד הודעה כאן..."
        required
        style={{ height: "100px", marginBottom: "10px" }}
      />
      <div style={{ marginTop: "5px", fontSize: "12px", color: "gray" }}>* קישור הסרה יתווסף אוטומטית</div>
      <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        <button type="submit" name="send_to" value="all" style={{ margin: 0 }}>
          🚀 שלח לכולם ({activeCount})
        </button>
        {newCount > 0 && (
          <button type="submit" name="send_to" value="new_only" style={{ margin: 0, background: "#1976d2" }}>
            📩 שלח רק לחדשים ({newCount})
          </button>
        )}
      </div>
    </form>
  );
}
