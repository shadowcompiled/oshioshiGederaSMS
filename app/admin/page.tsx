import { redirect } from "next/navigation";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { getAdminSession } from "@/lib/auth";
import { createImportToken } from "@/lib/security";
import { getDb, queryCustomers, mapRow, initDb, type CustomerRow } from "@/lib/db";
import { israelToday, toIsraelDateStr, toIsraelDateTimeStr } from "@/lib/dates";
import { computeKpis } from "@/lib/kpis";
import { canReceiveSmsReplies } from "@/lib/sms";
import { getUnsubscribeKeyword } from "@/lib/unsubscribe";
import { getPublicAppUrl } from "@/lib/app-url";
import BroadcastForm from "./BroadcastForm";
import UploadForm from "./UploadForm";
import ResetDbForm from "./ResetDbForm";
import CustomerTable, { type CustomerView } from "./CustomerTable";

const AdminStats = nextDynamic(() => import("./AdminStats"), {
  ssr: true,
  loading: () => (
    <div style={{ minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
      טוען סטטיסטיקות...
    </div>
  ),
});

export const dynamic = "force-dynamic";

/**
 * How this membership ended, in the operator's words. Rows deactivated before
 * unsubscribe_source existed have no record of who acted, and saying so is
 * better than guessing — "removed by the owner" about a customer who opted out
 * themselves would be exactly the wrong answer to give.
 */
function removalActor(c: CustomerRow): CustomerView["removedBy"] {
  if (c.active) return null;
  switch (c.unsubscribe_source) {
    case "admin":
      return "admin";
    case "customer_link":
      return "customer_link";
    case "customer_sms":
      return "customer_sms";
    default:
      return "unknown";
  }
}

function formatRegDate(created: string | null): string {
  if (!created) return "-";
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) return created.trim().split(" ")[0] || "-";
  return d.toISOString().slice(0, 10);
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; filter?: string }>;
}) {
  const ok = await getAdminSession();
  if (!ok) redirect("/login");

  let importToken = "";
  try {
    importToken = createImportToken();
  } catch {
    importToken = "";
  }

  let customers: CustomerRow[] = [];
  try {
    await initDb();
    const db = getDb();
    const rows = await queryCustomers(
      db,
      "SELECT phone, name, email, date_of_birth, wedding_day, city, active, created_at, received_message_at, unsubscribed_at, unsubscribe_source FROM customers ORDER BY active DESC, name ASC",
      []
    );
    if (db.type === "sqlite") db.conn.close();
    customers = rows.map(mapRow);
  } catch (e) {
    console.error("Admin page DB error:", e);
    redirect("/login?error=system");
  }

  const today = israelToday();
  const kpis = computeKpis(customers, today);

  const byDate: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  for (const c of customers) {
    const d = c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : "";
    if (d) byDate[d] = (byDate[d] ?? 0) + 1;
    const city = (c.city ?? "").trim() || "ללא עיר";
    byCity[city] = (byCity[city] ?? 0) + 1;
  }
  const signupsByDate = Object.entries(byDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const cityCounts = Object.entries(byCity)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const params = await searchParams;
  const msg = params.msg ?? "";

  const isSignupToday = (c: CustomerRow) => toIsraelDateStr(c.created_at) === today;
  const isRemovedToday = (c: CustomerRow) => !c.active && toIsraelDateStr(c.unsubscribed_at) === today;
  const signupTodayCount = customers.filter(isSignupToday).length;
  const removedTodayCount = customers.filter(isRemovedToday).length;

  const filter = params.filter === "signup_today" || params.filter === "unsub_today" ? params.filter : "";
  const displayed =
    filter === "signup_today"
      ? customers.filter(isSignupToday)
      : filter === "unsub_today"
        ? customers.filter(isRemovedToday)
        : customers;

  const customerViews: CustomerView[] = displayed.map((c) => ({
    phone: c.phone,
    name: c.name,
    email: c.email,
    date_of_birth: c.date_of_birth,
    wedding_day: c.wedding_day,
    city: c.city,
    active: c.active,
    regDate: formatRegDate(c.created_at),
    // Exact Israel-local instants, formatted on the server so every operator
    // sees the restaurant's clock rather than their own device's.
    joinedAt: toIsraelDateTimeStr(c.created_at),
    removedAt: toIsraelDateTimeStr(c.unsubscribed_at),
    removedBy: removalActor(c),
    isNew: c.active && !c.received_message_at,
  }));

  return (
    <main className="container admin-container" id="main-content">
      <div style={{ direction: "rtl", textAlign: "right" }}>
        <div className="admin-header">
          <h1 className="admin-title">ניהול לקוחות 🍣</h1>
          <div className="admin-actions">
            <Link
              href="/api/admin/export-csv"
              className="admin-btn admin-btn-green"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden="true">📊 </span>ייצוא CSV
              <span className="sr-only"> (נפתח בחלון חדש)</span>
            </Link>
            <Link href="/api/logout" className="admin-btn admin-btn-logout">
              יציאה
            </Link>
          </div>
        </div>

        {/* A description list: each figure is the value of a named term, which
            is what a screen reader should hear ("active customers: 42") rather
            than a bare number. HTML requires dt before dd, so .kpi-card uses
            flex `order` to keep the figure on top visually. */}
        <dl className="kpi-grid" aria-label="נתונים כלליים">
          <div className="kpi-card">
            <dt className="kpi-label">לקוחות פעילים</dt>
            <dd className="kpi-value">{kpis.active}</dd>
            <dd className="kpi-sub">מתוך {kpis.total} רשומים</dd>
          </div>
          <div className="kpi-card">
            <dt className="kpi-label">חדשים ב-7 ימים</dt>
            <dd className="kpi-value">{kpis.newLast7}</dd>
          </div>
          <div className="kpi-card">
            <dt className="kpi-label">הוסרו ב-30 יום</dt>
            <dd className="kpi-value">{kpis.removedLast30}</dd>
          </div>
          <div className="kpi-card">
            <dt className="kpi-label">טרם קיבלו הודעה</dt>
            <dd className="kpi-value">{kpis.neverMessaged}</dd>
          </div>
        </dl>

        <section className="admin-card" aria-labelledby="broadcast-heading">
          <h2 id="broadcast-heading" style={{ marginTop: 0 }}>
            <span aria-hidden="true">📢 </span>שליחת הודעה
          </h2>
          {/* The composer estimates SMS segments as the message is typed, and
              the opt-out footer it has to account for depends on server-only
              configuration: which provider is active, whether that sender can
              receive replies, and the public base URL of the opt-out link.
              Passing them down keeps the estimate honest without shipping the
              env to the browser. */}
          <BroadcastForm
            importToken={importToken}
            activeCount={kpis.active}
            newCount={kpis.neverMessaged}
            footerKeyword={getUnsubscribeKeyword()}
            canReceiveReplies={canReceiveSmsReplies()}
            appBaseUrl={getPublicAppUrl()}
          />
          {msg && (
            <p style={{ color: "#0d47a1", fontWeight: "bold", marginTop: "10px" }} role="status">
              {msg}
            </p>
          )}
        </section>

        <section className="admin-card" aria-labelledby="import-heading">
          <UploadForm importToken={importToken} headingId="import-heading" />
        </section>

        <AdminStats signupsByDate={signupsByDate} cityCounts={cityCounts} />

        <section aria-labelledby="customers-heading">
          <h2
            id="customers-heading"
            style={{
              borderBottom: "2px solid #d32f2f",
              paddingBottom: "5px",
              display: "inline-block",
              marginBottom: "15px",
            }}
          >
            רשימת לקוחות ({displayed.length})
          </h2>

          {/* These links replace the list below them, so they are a navigation
              region and the current one is marked with aria-current. */}
          <nav className="filter-chips" aria-label="סינון רשימת הלקוחות">
            {[
              { key: "", label: `הכל (${customers.length})`, href: "/admin" },
              { key: "signup_today", label: `נרשמו היום (${signupTodayCount})`, href: "/admin?filter=signup_today" },
              { key: "unsub_today", label: `הוסרו היום (${removedTodayCount})`, href: "/admin?filter=unsub_today" },
            ].map((f) => (
              <Link
                key={f.key || "all"}
                href={f.href}
                className="filter-chip"
                data-active={filter === f.key}
                aria-current={filter === f.key ? "page" : undefined}
              >
                {f.label}
              </Link>
            ))}
          </nav>

          <CustomerTable customers={customerViews} importToken={importToken} />
        </section>

        <section className="danger-zone" aria-labelledby="danger-heading">
          <h2 id="danger-heading">אזור מסוכן</h2>
          <p style={{ fontSize: "0.8125rem" }}>פעולות בלתי הפיכות. להשתמש בזהירות.</p>
          <ResetDbForm importToken={importToken} />
        </section>
      </div>
    </main>
  );
}
