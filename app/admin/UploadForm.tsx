"use client";

import { useState, useRef } from "react";

export default function UploadForm() {
  const [result, setResult] = useState<{ ok: boolean; message: string; detail?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, message: "בחר קובץ CSV או Excel (.xlsx)" });
      return;
    }
    setResult(null);
    setLoading(true);
    const formData = new FormData();
    formData.set("file", file);
    try {
      const res = await fetch("/api/admin/upload-customers", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = res.status === 403 ? "ההתחברות פגה. נא להתחבר שוב מדף /login ולנסות." : (data.error || "שגיאה בייבוא");
        setResult({ ok: false, message: msg });
        return;
      }
      setResult({
        ok: true,
        message: data.message || `נוספו ${data.added}, עודכנו ${data.updated}, דולגו ${data.skipped}.`,
        detail: `סה"כ שורות בקובץ: ${data.total}`,
      });
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setResult({ ok: false, message: "תקלה ברשת. נסה שוב." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: "16px" }}>
      <h4 style={{ marginBottom: "8px" }}>📁 ייבוא מלקובץ CSV / Excel</h4>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          style={{ maxWidth: "260px" }}
        />
        <button type="submit" disabled={loading}>
          {loading ? "מייבא..." : "ייבא לקוחות"}
        </button>
      </form>
      {result && (
        <p
          style={{
            marginTop: "10px",
            fontWeight: 600,
            color: result.ok ? "#2e7d32" : "#d32f2f",
          }}
          role="alert"
        >
          {result.message}
          {result.detail && <span style={{ display: "block", fontSize: "12px", fontWeight: 400, color: "#666" }}>{result.detail}</span>}
        </p>
      )}
    </div>
  );
}
