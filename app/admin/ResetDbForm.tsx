"use client";

type Props = { importToken: string };

export default function ResetDbForm({ importToken }: Props) {
  return (
    <form
      action="/api/admin/reset-db"
      method="POST"
      style={{ display: "inline" }}
      onSubmit={(e) => {
        if (!confirm("לאפס את מאגר הלקוחות לגמרי? כל אנשי הקשר יימחקו.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="import_token" value={importToken} />
      <button
        type="submit"
        className="admin-btn-reset"
        style={{
          background: "#d32f2f",
          color: "white",
          padding: "8px 12px",
          borderRadius: "6px",
          border: "none",
          cursor: "pointer",
          fontSize: "14px",
        }}
      >
        איפוס מאגר (0 אנשי קשר)
      </button>
    </form>
  );
}
