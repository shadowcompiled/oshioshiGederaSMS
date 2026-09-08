"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";

// Cap how many rows we put in the DOM at once. The list can be thousands of
// customers, and each row renders in both the desktop table and the mobile
// card list — rendering them all freezes the page. Searching narrows the set;
// for browsing, the filter chips above scope it.
const RENDER_LIMIT = 100;

export type CustomerView = {
  phone: string;
  name: string;
  email: string;
  date_of_birth: string;
  wedding_day: string;
  city: string;
  active: boolean;
  regDate: string; // pre-formatted YYYY-MM-DD or "-"
  /** Exact Israel-local join time, pre-formatted on the server. */
  joinedAt: string | null;
  /** Exact Israel-local removal time, or null while still a member. */
  removedAt: string | null;
  /** Who ended it. "unknown" covers rows removed before this was recorded. */
  removedBy: "admin" | "customer_link" | "customer_sms" | "unknown" | null;
  isNew: boolean; // active and never messaged
};

const REMOVED_BY_LABEL: Record<
  NonNullable<CustomerView["removedBy"]>,
  string
> = {
  admin: "הוסר/ה על ידי המסעדה",
  customer_link: "ביקש/ה להסיר עצמו/ה (קישור)",
  customer_sms: "ביקש/ה להסיר עצמו/ה (SMS)",
  unknown: "לא תועד מי ביצע את ההסרה",
};

/** The removal line: exact time plus who acted, for one customer. */
function RemovalCell({ c }: { c: CustomerView }) {
  if (c.active) return <span style={{ opacity: 0.5 }}>-</span>;
  const label = c.removedBy ? REMOVED_BY_LABEL[c.removedBy] : null;
  return (
    <span>
      <bdi>{c.removedAt ?? "מועד לא ידוע"}</bdi>
      {label && (
        <>
          <br />
          <span style={{ opacity: 0.75 }}>{label}</span>
        </>
      )}
    </span>
  );
}

type Props = { customers: CustomerView[]; importToken: string };

const TH: React.CSSProperties = { padding: "10px", textAlign: "right" };
const TH_CENTER: React.CSSProperties = { padding: "10px", textAlign: "center" };

function ToggleForm({ c, importToken }: { c: CustomerView; importToken: string }) {
  const label = c.name ? `${c.name} (${c.phone})` : c.phone;
  return (
    <form action="/api/admin/toggle" method="POST" style={{ display: "inline" }}>
      <input type="hidden" name="import_token" value={importToken} />
      <input type="hidden" name="phone" value={c.phone} />
      <input type="hidden" name="action" value={c.active ? "block" : "unblock"} />
      <button type="submit" className="admin-table-btn">
        <span aria-hidden="true">{c.active ? "⛔ " : "✅ "}</span>
        {c.active ? "חסימה" : "שחזור"}
        {/* Every row repeats the same two words; without the name the button
            list is unusable when read out of context. */}
        <span className="sr-only"> של {label}</span>
      </button>
    </form>
  );
}

function DeleteForm({ c, importToken }: { c: CustomerView; importToken: string }) {
  const label = c.name ? `${c.name} (${c.phone})` : c.phone;
  return (
    <form
      action="/api/admin/delete-customer"
      method="POST"
      style={{ display: "inline" }}
      onSubmit={(e) => {
        // Permanent and unrecoverable — unlike חסימה, which is reversible.
        if (!window.confirm(`למחוק את ${label} לצמיתות? הפעולה תמחק גם את המתנות של הלקוח ואינה ניתנת לשחזור.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="import_token" value={importToken} />
      <input type="hidden" name="phone" value={c.phone} />
      <button type="submit" className="admin-table-btn admin-table-btn-danger">
        <span aria-hidden="true">🗑 </span>מחיקה
        <span className="sr-only"> לצמיתות של {label}</span>
      </button>
    </form>
  );
}

function StatusBadges({ c }: { c: CustomerView }) {
  return (
    <span style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap" }}>
      {c.active ? <span className="badge badge-active">פעיל</span> : <span className="badge badge-removed">הוסר</span>}
      {c.isNew && <span className="badge badge-new">חדש</span>}
    </span>
  );
}

export default function CustomerTable({ customers, importToken }: Props) {
  const [query, setQuery] = useState("");
  // Defer the heavy filter+render off the keystroke so typing stays responsive.
  const deferredQuery = useDeferredValue(query);
  const ids = useId();
  const searchId = `${ids}-search`;
  const countId = `${ids}-count`;

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return customers;
    const qDigits = q.replace(/\D/g, "");
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (qDigits !== "" && c.phone.replace(/\D/g, "").includes(qDigits))
    );
  }, [customers, deferredQuery]);

  const shown = filtered.slice(0, RENDER_LIMIT);
  const hasQuery = deferredQuery.trim() !== "";
  const emptyMessage = hasQuery ? "אין תוצאות לחיפוש הזה" : "אין לקוחות להצגה";

  return (
    <>
      <div className="form-group">
        <label htmlFor={searchId}>חיפוש לקוחות</label>
        <input
          type="search"
          id={searchId}
          className="table-search"
          placeholder="שם, טלפון, עיר או דוא&quot;ל..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          aria-describedby={countId}
        />
      </div>
      {/* Announces the new count as the list narrows — the visual feedback of a
          shrinking table is invisible to a screen-reader user. */}
      <p id={countId} role="status" aria-live="polite" style={{ fontSize: "0.8125rem", margin: "0 0 10px", color: "#5f5a55" }}>
        {hasQuery
          ? `${filtered.length} תוצאות מתוך ${customers.length}`
          : `${customers.length} לקוחות`}
        {filtered.length > RENDER_LIMIT &&
          ` · מציג ${RENDER_LIMIT} ראשונים — חפשו כדי לצמצם`}
      </p>

      {/* Desktop: full table. tabIndex makes the horizontal scroller reachable
          by keyboard — a scrollable region that can't be focused fails WCAG
          2.1.1 because its off-screen columns are unreachable without a mouse. */}
      <div
        className="customers-desktop admin-table-wrap"
        role="region"
        aria-label="טבלת לקוחות"
        tabIndex={0}
      >
        <table className="admin-table">
          <caption className="sr-only">
            רשימת לקוחות המועדון — שם, פרטי קשר, מועדי הרשמה והסרה, סטטוס ופעולות
          </caption>
          <thead style={{ background: "#f5f5f5" }}>
            <tr style={{ borderBottom: "2px solid #d32f2f" }}>
              <th scope="col" style={TH}>
                שם
              </th>
              <th scope="col" style={TH}>
                דוא&quot;ל
              </th>
              <th scope="col" style={TH}>
                טלפון
              </th>
              <th scope="col" style={TH_CENTER}>
                תאריך לידה
              </th>
              <th scope="col" style={TH_CENTER}>
                יום נישואין
              </th>
              <th scope="col" style={TH}>
                עיר
              </th>
              <th scope="col" style={TH_CENTER}>
                מועד הרשמה
              </th>
              <th scope="col" style={TH_CENTER}>
                מועד הסרה
              </th>
              <th scope="col" style={TH_CENTER}>
                סטטוס
              </th>
              <th scope="col" style={TH_CENTER}>
                <span className="sr-only">פעולות</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: "20px", textAlign: "center", color: "#5f5a55" }}>
                  {emptyMessage}
                </td>
              </tr>
            )}
            {shown.map((c) => (
              <tr key={c.phone} style={{ borderBottom: "1px solid #eee" }}>
                {/* The name identifies the row, so it is a row header. */}
                <th scope="row" style={{ ...TH, fontWeight: 600 }}>
                  {c.name}
                </th>
                <td style={{ ...TH, fontSize: "0.75rem" }}>{c.email || "-"}</td>
                <td style={{ ...TH, fontSize: "0.75rem" }}>
                  <bdi style={{ direction: "ltr", unicodeBidi: "embed" }}>{c.phone}</bdi>
                </td>
                <td style={{ ...TH_CENTER, fontSize: "0.75rem" }}>{c.date_of_birth || "-"}</td>
                <td style={{ ...TH_CENTER, fontSize: "0.75rem" }}>{c.wedding_day || "-"}</td>
                <td style={{ ...TH, fontSize: "0.75rem" }}>{c.city || "-"}</td>
                <td style={{ ...TH_CENTER, fontSize: "0.75rem" }}>
                  <bdi>{c.joinedAt ?? c.regDate}</bdi>
                </td>
                <td style={{ ...TH_CENTER, fontSize: "0.75rem", minWidth: "9rem" }}>
                  <RemovalCell c={c} />
                </td>
                <td style={TH_CENTER}>
                  <StatusBadges c={c} />
                </td>
                <td style={{ ...TH_CENTER, whiteSpace: "nowrap" }}>
                  <ToggleForm c={c} importToken={importToken} />
                  <DeleteForm c={c} importToken={importToken} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards with progressive disclosure */}
      <ul className="customers-mobile" aria-label="רשימת לקוחות">
        {filtered.length === 0 && (
          <li style={{ textAlign: "center", color: "#5f5a55" }}>{emptyMessage}</li>
        )}
        {shown.map((c) => (
          <li key={c.phone} className="customer-card">
            <div className="customer-card-head">
              <h3 className="customer-card-name">{c.name}</h3>
              <StatusBadges c={c} />
            </div>
            <p className="customer-card-line">
              <a href={`tel:${c.phone}`}>
                <bdi style={{ direction: "ltr", unicodeBidi: "embed" }}>{c.phone}</bdi>
              </a>
              {c.city ? ` · ${c.city}` : ""}
            </p>
            <p className="customer-card-line">
              נרשם/ה <bdi>{c.joinedAt ?? c.regDate}</bdi>
            </p>
            {!c.active && (
              <p className="customer-card-line">
                הוסר/ה <bdi>{c.removedAt ?? "במועד לא ידוע"}</bdi>
                {c.removedBy ? ` · ${REMOVED_BY_LABEL[c.removedBy]}` : ""}
              </p>
            )}
            <details>
              <summary>פרטים נוספים</summary>
              <p className="customer-card-line">דוא&quot;ל: {c.email || "-"}</p>
              <p className="customer-card-line">תאריך לידה: {c.date_of_birth || "-"}</p>
              <p className="customer-card-line">יום נישואין: {c.wedding_day || "-"}</p>
            </details>
            <div style={{ marginTop: "6px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <ToggleForm c={c} importToken={importToken} />
              <DeleteForm c={c} importToken={importToken} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
