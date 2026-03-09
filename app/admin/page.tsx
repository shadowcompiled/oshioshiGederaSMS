import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth";
import { getDb, queryCustomers, mapRow, initDb } from "@/lib/db";
import BroadcastForm from "./BroadcastForm";
import UploadForm from "./UploadForm";
import { importCustomersAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const ok = await getAdminSession();
  if (!ok) redirect("/login");

  await initDb();
  const db = getDb();
  const rows = await queryCustomers(
    db,
    "SELECT phone, name, email, date_of_birth, wedding_day, city, active, created_at FROM customers ORDER BY active DESC, name ASC",
    []
  );
  if (db.type === "sqlite") db.conn.close();

  const customers = rows.map(mapRow);
  const activeCount = customers.filter((c) => c.active).length;
  const params = await searchParams;
  const msg = params.msg ?? "";

  function formatRegDate(created: string | null): string {
    if (!created) return "-";
    const d = new Date(created);
    if (Number.isNaN(d.getTime())) return created.trim().split(" ")[0] || "-";
    return d.toISOString().slice(0, 10);
  }

  return (
    <div className="container" style={{ maxWidth: "900px" }}>
      <div style={{ direction: "rtl", textAlign: "right" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px", flexWrap: "wrap", gap: "10px" }}>
          <h2 style={{ margin: 0, flex: 1 }}>ניהול לקוחות 🍣</h2>
          <Link
            href="/api/admin/export-csv"
            style={{ background: "#4CAF50", color: "white", padding: "8px 12px", borderRadius: "4px", textDecoration: "none", fontSize: "14px", fontWeight: 600 }}
          >
            📊 ייצוא CSV
          </Link>
          <Link
            href="/api/logout"
            style={{ background: "#333", color: "white", padding: "8px 12px", borderRadius: "4px", textDecoration: "none", fontSize: "14px" }}
          >
            יציאה
          </Link>
        </div>

        <div style={{ background: "#fff", padding: "20px", border: "1px solid #eee", borderRadius: "8px", marginBottom: "20px" }}>
          <h3 style={{ marginTop: 0 }}>📢 שליחת הודעה ({activeCount} פעילים)</h3>
          <BroadcastForm />
          {msg && <p style={{ color: "blue", fontWeight: "bold", marginTop: "10px" }}>{msg}</p>}
          <UploadForm importAction={importCustomersAction} />
        </div>

        <h3 style={{ borderBottom: "2px solid #d32f2f", paddingBottom: "5px", display: "inline-block", marginBottom: "15px" }}>
          רשימת לקוחות ({customers.length})
        </h3>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead style={{ background: "#f5f5f5", position: "sticky", top: 0 }}>
              <tr style={{ borderBottom: "2px solid #d32f2f" }}>
                <th style={{ padding: "10px", textAlign: "right" }}>שם</th>
                <th style={{ padding: "10px", textAlign: "right" }}>דוא&quot;ל</th>
                <th style={{ padding: "10px", textAlign: "right" }}>טלפון</th>
                <th style={{ padding: "10px", textAlign: "center" }}>תאריך לידה</th>
                <th style={{ padding: "10px", textAlign: "center" }}>יום חתונה</th>
                <th style={{ padding: "10px", textAlign: "right" }}>עיר</th>
                <th style={{ padding: "10px", textAlign: "center" }}>תאריך רישום</th>
                <th style={{ padding: "10px", textAlign: "center" }}>סטטוס</th>
                <th style={{ padding: "10px", textAlign: "center" }}></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.phone} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "10px", textAlign: "right" }}>{c.name}</td>
                  <td style={{ padding: "10px", textAlign: "right", fontSize: "12px" }}>{c.email || "-"}</td>
                  <td style={{ padding: "10px", textAlign: "right", fontSize: "12px", direction: "ltr" }}>{c.phone}</td>
                  <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{c.date_of_birth || "-"}</td>
                  <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{c.wedding_day || "-"}</td>
                  <td style={{ padding: "10px", textAlign: "right", fontSize: "12px" }}>{c.city || "-"}</td>
                  <td style={{ padding: "10px", textAlign: "center", fontSize: "12px" }}>{formatRegDate(c.created_at)}</td>
                  <td style={{ padding: "10px", textAlign: "center" }}>
                    {c.active ? <span className="success">פעיל</span> : <span className="error">הוסר</span>}
                  </td>
                  <td style={{ padding: "10px", textAlign: "center" }}>
                    {c.active ? (
                      <form action="/api/admin/toggle" method="GET" style={{ display: "inline" }}>
                        <input type="hidden" name="phone" value={c.phone} />
                        <input type="hidden" name="action" value="block" />
                        <button type="submit" style={{ background: "none", border: "none", padding: 0, fontSize: "12px", color: "#1976d2", cursor: "pointer", textDecoration: "underline" }}>⛔ חסימה</button>
                      </form>
                    ) : (
                      <form action="/api/admin/toggle" method="GET" style={{ display: "inline" }}>
                        <input type="hidden" name="phone" value={c.phone} />
                        <input type="hidden" name="action" value="unblock" />
                        <button type="submit" style={{ background: "none", border: "none", padding: 0, fontSize: "12px", color: "#1976d2", cursor: "pointer", textDecoration: "underline" }}>✅ שחזור</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
