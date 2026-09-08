/**
 * Extract the birth month (1-12) from a stored date-of-birth string.
 * DOB is stored as free-text, so handle ISO (YYYY-MM-DD) and the
 * Israeli day-first formats (DD/MM/YYYY, DD.MM.YYYY). Returns null when
 * the string cannot be parsed into a valid month, so callers can skip it.
 */
export function getBirthMonth(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const s = dob.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return clampMonth(parseInt(iso[2], 10));

  const dayFirst = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(s);
  if (dayFirst) return clampMonth(parseInt(dayFirst[2], 10));

  return null;
}

function clampMonth(m: number): number | null {
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
}

/**
 * Parse a date-of-birth string into calendar parts. Accepts ISO (YYYY-MM-DD)
 * and the Israeli day-first formats (DD/MM/YYYY, DD.MM.YYYY), matching
 * getBirthMonth. Returns null when the string isn't a usable date.
 */
export function parseBirthDate(dob: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!dob) return null;
  const s = dob.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return validParts(+iso[1], +iso[2], +iso[3]);

  const dayFirst = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(s);
  if (dayFirst) {
    const year = dayFirst[3].length <= 2 ? 1900 + +dayFirst[3] : +dayFirst[3];
    return validParts(year, +dayFirst[2], +dayFirst[1]);
  }
  return null;
}

function validParts(y: number, m: number, d: number): { y: number; m: number; d: number } | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject impossible days (e.g. 31 February) via a UTC round-trip.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/**
 * True when someone born on `dob` has already had their `years`-th birthday
 * on `today` (an Israel-local YYYY-MM-DD). Pure calendar comparison — no
 * timezone drift, and the birthday itself counts as reaching the age.
 * Returns false for an unparseable date, so callers fail closed.
 */
export function isAtLeastAge(dob: string | null | undefined, years: number, today: string = israelToday()): boolean {
  const b = parseBirthDate(dob);
  if (!b) return false;
  const [ty, tm, td] = today.split("-").map((n) => parseInt(n, 10));
  if (!Number.isInteger(ty) || !Number.isInteger(tm) || !Number.isInteger(td)) return false;
  const age = ty - b.y - (tm < b.m || (tm === b.m && td < b.d) ? 1 : 0);
  return age >= years;
}

// The business runs in Gedera, Israel — "today" must be the local Israeli day,
// not the server's UTC day, or signups/removals in the early hours bucket wrong.
const ISRAEL_TZ = "Asia/Jerusalem";
const israelDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ISRAEL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Parse a stored timestamp into a Date. created_at/received_message_at/
 * unsubscribed_at are stored in UTC: Postgres CURRENT_TIMESTAMP and SQLite
 * datetime('now') produce "YYYY-MM-DD HH:MM:SS" with no zone, and ISO strings
 * we write carry a trailing Z. Treat zone-less "YYYY-MM-DD HH:MM:SS" as UTC so
 * the instant is correct regardless of where the code runs.
 */
function parseStoredTimestamp(value: string | Date): Date {
  if (value instanceof Date) return value;
  const s = value.trim();
  const looksLikeNaiveDateTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s);
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (looksLikeNaiveDateTime && !hasZone) {
    return new Date(s.replace(" ", "T") + "Z");
  }
  return new Date(s);
}

/** Today's date (YYYY-MM-DD) in Israel local time. */
export function israelToday(): string {
  return israelDateFmt.format(new Date());
}

/**
 * Convert a stored UTC timestamp to its Israel-local calendar date
 * (YYYY-MM-DD), or null if the value is empty/unparseable.
 */
export function toIsraelDateStr(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = parseStoredTimestamp(value);
  if (Number.isNaN(d.getTime())) return null;
  return israelDateFmt.format(d);
}

const israelDateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: ISRAEL_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * A stored UTC timestamp as an exact Israel-local date and time
 * ("31/12/2026, 23:45"), or null when empty/unparseable.
 *
 * The admin list shows this rather than the bare date because "when exactly
 * did this person join, and when exactly did they leave" is a question the
 * owner actually gets asked — and under the spam law, being able to answer it
 * to the minute is the point of keeping the timestamps at all.
 */
export function toIsraelDateTimeStr(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = parseStoredTimestamp(value);
  if (Number.isNaN(d.getTime())) return null;
  return israelDateTimeFmt.format(d);
}
