import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth";
import { createImportToken } from "@/lib/security";
import { getDb, queryCustomers, mapRow, initDb } from "@/lib/db";
import BroadcastForm from "./BroadcastForm";
import UploadForm from "./UploadForm";
import ResetDbForm from "./ResetDbForm";
import TestMessageForm from "./TestMessageForm";
import AdminStats from "./AdminStats";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const ok = await getAdminSession();
  if (!ok) redirect("/login");

  const importToken = createImportToken();

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

  const byDate: Record<string, number> = {};
  for (const c of customers) {
    const d = c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : "";
    if (d) byDate[d] = (byDate[d] ?? 0) + 1;
  }
  const signupsByDate = Object.entries(byDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byCity: Record<string, number> = {};
  for (const c of customers) {
    const city = (c.city ?? "").trim() || "ללא עיר";
    byCity[city] = (byCity[city] ?? 0) + 1;
  }
  const cityCounts = Object.entries(byCity)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  function formatRegDate(created: string | null): string {
    if (!created) return "-";
    const d = new Date(created);
    if (Number.isNaN(d.getTime())) return created.trim().split(" ")[0] || "-";
    return d.toISOString().slice(0, 10);
  }

  return (
    <div className="container admin-container" style={{ maxWidth: "900px" }}>
      <div style={{ direction: "rtl", textAlign: "right" }}>
        <div className="admin-header">
          <h2 className="admin-title">ניהול לקוחות 🍣</h2>
          <div className="admin-actions">
            <Link
              href="/api/admin/export-csv"
              className="admin-btn admin-btn-green"
            >
              📊 ייצוא CSV
            </Link>
            <ResetDbForm importToken={importToken} />
            <Link href="/api/logout" className="admin-btn admin-btn-logout">
              יציאה
            </Link>
          </div>
        </div>

        <div className="admin-card">
          <h3 style={{ marginTop: 0 }}>📢 שליחת הודעה ({activeCount} פעילים)</h3>
          <BroadcastForm importToken={importToken} />
          {msg && <p style={{ color: "blue", fontWeight: "bold", marginTop: "10px" }}>{msg}</p>}
          <UploadForm importToken={importToken} />
          <TestMessageForm importToken={importToken} />
        </div>

        <AdminStats signupsByDate={signupsByDate} cityCounts={cityCounts} />

        <h3 style={{ borderBottom: "2px solid #d32f2f", paddingBottom: "5px", display: "inline-block", marginBottom: "15px" }}>
          רשימת לקוחות ({customers.length})
        </h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
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
                      <form action="/api/admin/toggle" method="POST" style={{ display: "inline" }}>
                        <input type="hidden" name="import_token" value={importToken} />
                        <input type="hidden" name="phone" value={c.phone} />
                        <input type="hidden" name="action" value="block" />
                        <button type="submit" className="admin-table-btn">⛔ חסימה</button>
                      </form>
                    ) : (
                      <form action="/api/admin/toggle" method="POST" style={{ display: "inline" }}>
                        <input type="hidden" name="import_token" value={importToken} />
                        <input type="hidden" name="phone" value={c.phone} />
                        <input type="hidden" name="action" value="unblock" />
                        <button type="submit" className="admin-table-btn">✅ שחזור</button>
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
