"use client";

export default function ResetDbForm() {
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
      <button
        type="submit"
        style={{
          background: "#d32f2f",
          color: "white",
          padding: "8px 12px",
          borderRadius: "4px",
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
