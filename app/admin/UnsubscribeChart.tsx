"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { UnsubscribeDay } from "@/lib/unsubscribe-report";

const BAR_COLOR = "#b71c1c";
// Send days are events, not a second measure, so they are drawn as a marker
// line in neutral ink rather than as a second bar series on another axis.
const SEND_COLOR = "#37474f";
const CARD_SHADOW = "0 2px 12px rgba(0,0,0,0.08)";
const CARD_BORDER = "1px solid rgba(0,0,0,0.06)";
const PREVIEW_CHARS = 60;

/** "2026-10-07" -> "07/10", the way the dates read in Israel. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function preview(message: string): string {
  return message.length > PREVIEW_CHARS ? message.slice(0, PREVIEW_CHARS) + "…" : message;
}

/**
 * Opt-outs on send days and the day after, against every other day. A send's
 * effect lands within about a day, so that pair is the window to compare.
 */
function summarize(days: UnsubscribeDay[]) {
  const afterSend = new Set<number>();
  days.forEach((d, i) => {
    if (d.broadcasts > 0) {
      afterSend.add(i);
      if (i + 1 < days.length) afterSend.add(i + 1);
    }
  });
  let sendTotal = 0;
  let quietTotal = 0;
  days.forEach((d, i) => {
    if (afterSend.has(i)) sendTotal += d.unsubscribes;
    else quietTotal += d.unsubscribes;
  });
  const quietDays = days.length - afterSend.size;
  return {
    sends: days.reduce((s, d) => s + d.broadcasts, 0),
    sendDays: afterSend.size,
    sendAvg: afterSend.size ? sendTotal / afterSend.size : 0,
    quietDays,
    quietAvg: quietDays ? quietTotal / quietDays : 0,
    total: sendTotal + quietTotal,
  };
}

const fmtAvg = (n: number) => n.toLocaleString("he-IL", { maximumFractionDigits: 1 });

function DayTooltip({ active, payload }: { active?: boolean; payload?: { payload: UnsubscribeDay }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: "#fff",
        padding: "10px 14px",
        borderRadius: "8px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        border: "1px solid #eee",
        fontSize: "14px",
        maxWidth: 280,
        direction: "rtl",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "4px" }}>{shortDate(d.date)}</div>
      <div style={{ color: "#555" }}>הסרות: {d.unsubscribes}</div>
      {d.broadcasts > 0 ? (
        <div style={{ color: "#333", marginTop: "6px" }}>
          <div style={{ fontWeight: 600 }}>
            📢 נשלחה הודעה{d.broadcasts > 1 ? ` (${d.broadcasts} שליחות)` : ""} ל-{d.recipients} לקוחות
          </div>
          {d.messages.map((m, i) => (
            <div key={i} style={{ color: "#666", fontSize: "13px", marginTop: "2px" }}>
              ״{preview(m)}״
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "#78909c", marginTop: "4px" }}>לא נשלחה הודעה</div>
      )}
    </div>
  );
}

export default function UnsubscribeChart({ days }: { days: UnsubscribeDay[] }) {
  const s = summarize(days);
  const hasData = s.total > 0 || s.sends > 0;

  return (
    <section
      className="stats-card"
      aria-labelledby="unsub-chart-heading"
      style={{
        direction: "rtl",
        background: "#fff",
        padding: "20px",
        border: CARD_BORDER,
        borderRadius: "12px",
        boxShadow: CARD_SHADOW,
        marginBottom: "28px",
      }}
    >
      <h2 id="unsub-chart-heading" style={{ margin: "0 0 6px 0", fontSize: "1rem", fontWeight: 600, color: "#333" }}>
        הסרות מהמועדון לפי יום ושליחות הודעות ({days.length} ימים אחרונים)
      </h2>

      {!hasData ? (
        <p style={{ color: "#5f5a55", fontSize: "0.875rem", margin: 0 }}>אין הסרות או שליחות בתקופה הזו.</p>
      ) : (
        <>
          <p style={{ color: "#444", fontSize: "0.875rem", margin: "0 0 12px 0" }}>
            {s.sends > 0 ? (
              <>
                ביום שליחה וביום שאחריו: <strong>{fmtAvg(s.sendAvg)}</strong> הסרות ליום בממוצע · בשאר הימים:{" "}
                <strong>{fmtAvg(s.quietAvg)}</strong> הסרות ליום
              </>
            ) : (
              <>לא נשלחו הודעות בתקופה הזו · {s.total} הסרות בסך הכל</>
            )}
          </p>

          <div
            aria-hidden="true"
            style={{ display: "flex", gap: "16px", fontSize: "13px", color: "#555", marginBottom: "8px", flexWrap: "wrap" }}
          >
            <span>
              <span style={{ display: "inline-block", width: 10, height: 10, background: BAR_COLOR, borderRadius: 2, marginLeft: 6 }} />
              הסרות ביום
            </span>
            <span>
              <span
                style={{ display: "inline-block", width: 0, height: 12, borderRight: `2px dashed ${SEND_COLOR}`, marginLeft: 6, verticalAlign: "middle" }}
              />
              📢 יום שבו נשלחה הודעה
            </span>
          </div>

          {/* Text alternative (WCAG 1.1.1): the chart below is aria-hidden. */}
          <table className="sr-only">
            <caption>הסרות מהמועדון ושליחות הודעות לפי יום</caption>
            <thead>
              <tr>
                <th scope="col">תאריך</th>
                <th scope="col">הסרות</th>
                <th scope="col">נשלחה הודעה</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <th scope="row">{d.date}</th>
                  <td>{d.unsubscribes}</td>
                  <td>{d.broadcasts > 0 ? `כן, ל-${d.recipients} לקוחות` : "לא"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="stats-chart-container" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fontSize: 12, fill: "#555" }}
                  axisLine={{ stroke: "#e0e0e0" }}
                  tickLine={false}
                  minTickGap={12}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#555" }} axisLine={false} tickLine={false} />
                <Tooltip content={<DayTooltip />} cursor={{ fill: "rgba(183, 28, 28, 0.06)" }} />
                {days
                  .filter((d) => d.broadcasts > 0)
                  .map((d) => (
                    <ReferenceLine
                      key={d.date}
                      x={d.date}
                      stroke={SEND_COLOR}
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      label={{ value: "📢", position: "top", fontSize: 14 }}
                    />
                  ))}
                <Bar dataKey="unsubscribes" name="הסרות" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}
