"use client";

export default function UploadForm() {
  return (
    <div style={{ marginTop: "16px" }}>
      <h4 style={{ marginBottom: "8px" }}>📁 ייבוא מלקובץ CSV / Excel</h4>
      <form
        action="/api/admin/upload-customers"
        method="POST"
        encType="multipart/form-data"
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}
      >
        <input
          type="file"
          name="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          required
          style={{ maxWidth: "260px" }}
        />
        <button type="submit">ייבא לקוחות</button>
      </form>
    </div>
  );
}
