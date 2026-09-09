"use client";

import { useEffect, useId, useMemo, useState } from "react";

/**
 * A date entered as three dropdowns, ordered day / month / year.
 *
 * This replaces `<input type="date">`, which had two problems for this form.
 * It renders in the *browser's* locale, so an Israeli customer could be shown
 * mm/dd/yyyy with no way to tell — a birthday of 03/07 is then silently the
 * wrong date. And its calendar opens on the current month, so entering a birth
 * year means paging back three or four hundred times.
 *
 * Dropdowns fix both: the month is a name, so no order can be misread, and the
 * year is one direct choice. The month list also means an impossible date
 * cannot be entered at all — the day list shrinks to fit the chosen month,
 * including February in a leap year.
 *
 * The value is still submitted as `yyyy-mm-dd` through a hidden input, so the
 * server contract (lib/submit-form.ts caps these at 10 chars) is unchanged.
 */

const MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

function daysInMonth(year: number, month: number): number {
  if (!year || !month) return 31;
  // Day 0 of the next month is the last day of this one — leap years included.
  return new Date(year, month, 0).getDate();
}

type Props = {
  /** Submitted field name, e.g. "date_of_birth". */
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  /** Oldest year offered, as years before today (e.g. 100). */
  minYearsAgo: number;
  /** Newest year offered, as years before today (18 for an adults-only club). */
  maxYearsAgo: number;
};

export default function DateField({
  name,
  label,
  hint,
  required = false,
  disabled = false,
  minYearsAgo,
  maxYearsAgo,
}: Props) {
  const ids = useId();
  const dayId = `${ids}-d`;
  const monthId = `${ids}-m`;
  const yearId = `${ids}-y`;
  const hintId = `${ids}-hint`;
  const groupLabelId = `${ids}-label`;

  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");

  // The year list depends on today's date, and this page is prerendered at
  // build time. Deriving it during render would bake the build year into the
  // HTML and mismatch the client on any New Year in between, so the options
  // are added after mount. Nobody can pick from a dropdown before hydration
  // anyway, and the server re-checks the age regardless.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const years = useMemo(() => {
    if (!mounted) return [];
    const thisYear = new Date().getFullYear();
    const out: number[] = [];
    for (let y = thisYear - maxYearsAgo; y >= thisYear - minYearsAgo; y--) out.push(y);
    return out;
  }, [mounted, minYearsAgo, maxYearsAgo]);

  const maxDay = daysInMonth(Number(year), Number(month));

  // Picking February after picking the 31st must not leave an impossible date
  // sitting in the form.
  useEffect(() => {
    if (day && Number(day) > maxDay) setDay(String(maxDay));
  }, [day, maxDay]);

  const complete = day !== "" && month !== "" && year !== "";
  const value = complete
    ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    : "";

  return (
    <div className="form-group">
      {/* A group of three controls needs one group label. role="group" with
          aria-labelledby carries it without a fieldset, whose default layout
          fights the flex row below. */}
      <span className="date-field-label" id={groupLabelId}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            {" "}
            *
          </span>
        )}
        {hint && (
          <span className="label-hint" id={hintId}>
            {hint}
          </span>
        )}
      </span>
      <div
        role="group"
        aria-labelledby={groupLabelId}
        aria-describedby={hint ? hintId : undefined}
        className="date-field"
      >
        <span className="date-part">
          <label htmlFor={dayId}>יום</label>
          <select
            id={dayId}
            value={day}
            required={required}
            disabled={disabled}
            onChange={(e) => setDay(e.target.value)}
          >
            <option value="">--</option>
            {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </span>
        <span className="date-part date-part-month">
          <label htmlFor={monthId}>חודש</label>
          <select
            id={monthId}
            value={month}
            required={required}
            disabled={disabled}
            onChange={(e) => setMonth(e.target.value)}
          >
            <option value="">--</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </span>
        <span className="date-part">
          <label htmlFor={yearId}>שנה</label>
          <select
            id={yearId}
            value={year}
            required={required}
            disabled={disabled}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="">--</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </span>
      </div>
      {/* The wire format the server has always received. */}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
