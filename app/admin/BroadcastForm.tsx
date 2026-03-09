"use client";

type Props = { importToken: string };

export default function BroadcastForm({ importToken }: Props) {
  const action = `/api/admin/broadcast?import_token=${encodeURIComponent(importToken)}`;
  return (
    <form
      action={action}
      method="POST"
      onSubmit={(e) => {
        if (!confirm("לשלוח לכולם?")) e.preventDefault();
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
      <button type="submit" style={{ marginTop: "10px" }}>
        🚀 שלח הודעה
      </button>
    </form>
  );
}
