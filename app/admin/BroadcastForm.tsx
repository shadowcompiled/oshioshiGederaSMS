"use client";

type Props = { importToken: string };

export default function BroadcastForm({ importToken }: Props) {
  return (
    <form
      action="/api/admin/broadcast"
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
