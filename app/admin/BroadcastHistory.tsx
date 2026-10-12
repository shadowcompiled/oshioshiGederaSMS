"use client";

import { useState } from "react";
import type { BroadcastSummary } from "@/lib/broadcast-history";
import { smsBilledMessages } from "@/lib/sms-segments";

const CARD_SHADOW = "0 2px 12px rgba(0,0,0,0.08)";
const CARD_BORDER = "1px solid rgba(0,0,0,0.06)";

const OK = "#2e7d32";
const BAD = "#b71c1c";
const WAIT = "#ef6c00";
const MUTED = "#5f6368";

/** "2026-10-12T09:30:00Z" -> "12/10 09:30" in Israel time, how the office reads it. */
function israelStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function audienceLabel(audience: string): string {
  return audience === "new_only" ? "לקוחות חדשים בלבד" : "כל המועדון";
}

/**
 * One broadcast's outcome as a single sentence, because the number that matters
 * is "did anyone miss it", not the breakdown.
 */
function verdict(b: BroadcastSummary): { text: string; color: string } {
  if (!b.audited) {
    return { text: "נשלח לפני שהמעקב הופעל — אין נתוני מסירה", color: MUTED };
  }
  const outstanding = b.failed + b.missing;
  if (outstanding === 0) return { text: "כולם קיבלו", color: OK };
  if (b.failed > 0 && b.missing > 0) {
    return { text: `${b.failed} נכשלו, ${b.missing} ללא תשובה`, color: BAD };
  }
  if (b.failed > 0) return { text: `${b.failed} נכשלו`, color: BAD };
  return { text: `${b.missing} עדיין בתור`, color: WAIT };
}

function Bar({ b }: { b: BroadcastSummary }) {
  if (!b.audited || b.queued === 0) return null;
  const pct = (n: number) => `${(n / b.queued) * 100}%`;
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        height: 6,
        borderRadius: 3,
        overflow: "hidden",
        background: "#eceff1",
        marginTop: 8,
      }}
    >
      <div style={{ width: pct(b.delivered), background: OK }} />
      <div style={{ width: pct(b.failed), background: BAD }} />
      <div style={{ width: pct(b.missing), background: WAIT }} />
    </div>
  );
}

export default function BroadcastHistory({ broadcasts }: { broadcasts: BroadcastSummary[] }) {
  const [openAt, setOpenAt] = useState<string | null>(null);

  const totals = broadcasts.reduce(
    (acc, b) => {
      if (!b.audited) return acc;
      acc.delivered += b.delivered;
      acc.outstanding += b.failed + b.missing;
      return acc;
    },
    { delivered: 0, outstanding: 0 }
  );

  return (
    <section
      className="admin-card"
      aria-labelledby="history-heading"
      style={{ boxShadow: CARD_SHADOW, border: CARD_BORDER }}
    >
      <h2 id="history-heading" style={{ marginTop: 0 }}>
        היסטוריית הודעות
      </h2>

      {broadcasts.length === 0 ? (
        <p style={{ color: MUTED, margin: 0 }}>עדיין לא נשלחו הודעות מהמערכת.</p>
      ) : (
        <>
          <p style={{ color: MUTED, marginTop: 0, fontSize: "0.875rem" }}>
            {broadcasts.length} שידורים אחרונים · {totals.delivered} הודעות נמסרו
            {totals.outstanding > 0 ? ` · ${totals.outstanding} לא הגיעו` : ""}
          </p>

          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {broadcasts.map((b) => {
              const v = verdict(b);
              const open = openAt === b.sentAt;
              return (
                <li
                  key={b.sentAt}
                  style={{
                    border: CARD_BORDER,
                    borderRadius: 10,
                    padding: "12px 14px",
                    background: "#fff",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "baseline",
                      justifyContent: "space-between",
                    }}
                  >
                    <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                      {israelStamp(b.sentAt)}
                    </strong>
                    <span style={{ color: v.color, fontWeight: 700, fontSize: "0.875rem" }}>
                      {v.text}
                    </span>
                  </div>

                  <div style={{ color: MUTED, fontSize: "0.8125rem", marginTop: 4 }}>
                    {audienceLabel(b.audience)} · {b.queued} נמענים ·{" "}
                    {smsBilledMessages(b.message)} הודעות לנמען
                  </div>

                  <Bar b={b} />

                  <button
                    type="button"
                    className="btn-link"
                    aria-expanded={open}
                    onClick={() => setOpenAt(open ? null : b.sentAt)}
                    style={{ marginTop: 6 }}
                  >
                    {open ? "הסתר את ההודעה" : "הצג את ההודעה"}
                  </button>

                  {open && (
                    <p
                      style={{
                        whiteSpace: "pre-wrap",
                        background: "#f7f8f9",
                        borderRadius: 8,
                        padding: "10px 12px",
                        margin: "6px 0 0",
                        fontSize: "0.875rem",
                        lineHeight: 1.6,
                      }}
                    >
                      {b.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
