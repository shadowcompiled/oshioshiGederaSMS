import { getDb, runDb, initDb, queryCustomers } from "@/lib/db";
import { formatPhone, isValidPhone, isValidEmail } from "@/lib/validation";
import * as XLSX from "xlsx";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const HEADER_MAP: Record<string, string> = {
  name: "name",
  שם: "name",
  "שם מלא": "name",
  "שם לקוח": "name",
  phone: "phone",
  טלפון: "phone",
  סלולרי: "phone",
  mobile: "phone",
  email: "email",
  "דוא\"ל": "email",
  אימייל: "email",
  "date_of_birth": "date_of_birth",
  "תאריך לידה": "date_of_birth",
  dob: "date_of_birth",
  "wedding_day": "wedding_day",
  "יום חתונה": "wedding_day",
  wedding: "wedding_day",
  city: "city",
  עיר: "city",
};

function normalizeHeader(h: string): string {
  const t = (h || "").toString().trim();
  return HEADER_MAP[t] || HEADER_MAP[t.toLowerCase()] || "";
}

function setRowVal(row: Record<string, string>, col: string, value: string) {
  const v = value.trim();
  if (!col) return;
  if (col === "phone" || col === "name" || col === "email") {
    row[col] = (row[col] || "").trim() || v;
  } else {
    row[col] = v || row[col] || "";
  }
}

function parseCSV(buffer: Buffer): Record<string, string>[] {
  const str = buffer.toString("utf-8");
  const lines = str.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headerLine = lines[0];
  const delimiter = headerLine.includes("\t") ? "\t" : ",";
  const headers = headerLine.split(delimiter).map((h) => normalizeHeader(h.trim()));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter);
    const row: Record<string, string> = {};
    headers.forEach((col, j) => {
      setRowVal(row, col, (values[j] ?? "").toString());
    });
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

// Known header keywords to detect header row (Hebrew/English)
const HEADER_KEYWORDS = ["שם", "name", "טלפון", "phone", "סלולרי", "mobile", "עיר", "city", "דוא\"ל", "email", "אימייל"];

function rowLooksLikeHeader(cells: unknown[]): boolean {
  const str = (cells ?? []).map((c) => String(c ?? "").trim().toLowerCase()).join(" ");
  return HEADER_KEYWORDS.some((kw) => str.includes(kw));
}

function parseXLSX(buffer: Buffer): Record<string, string>[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (data.length < 2) return [];

  // Find header row: first row that contains known column names (handles "דוח מועדון לקוחות" style reports)
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(data.length, 30); i++) {
    const row = data[i] ?? [];
    if (rowLooksLikeHeader(row)) {
      headerRowIndex = i;
      break;
    }
  }

  const rawHeaders = (data[headerRowIndex] ?? []).map((h) => String(h ?? "").trim());
  const headers = rawHeaders.map((h) => normalizeHeader(h));
  const hasRequired = headers.some((c) => c === "name" || c === "phone");
  if (!hasRequired) return [];

  const rows: Record<string, string>[] = [];
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const values = data[i] ?? [];
    const row: Record<string, string> = {};
    headers.forEach((col, j) => {
      const v = values[j];
      setRowVal(row, col, v != null ? String(v) : "");
    });
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

function rowToCustomer(row: Record<string, string>): { phone: string; name: string; email: string; date_of_birth: string; wedding_day: string; city: string } | null {
  const name = (row.name ?? "").trim().slice(0, 100);
  const rawPhone = (row.phone ?? "").trim().slice(0, 20);
  const email = (row.email ?? "").trim().slice(0, 255);
  const dob = (row.date_of_birth ?? "").trim();
  const wedding = (row.wedding_day ?? "").trim();
  const city = (row.city ?? "").trim().slice(0, 50);

  if (!name || !rawPhone) return null;
  const phone = formatPhone(rawPhone);
  if (!isValidPhone(phone)) return null;
  if (email && !isValidEmail(email)) return null;

  return {
    phone,
    name,
    email: email || "",
    date_of_birth: dob || "",
    wedding_day: wedding || "",
    city: city || "",
  };
}

export type ImportResult = { added: number; updated: number; skipped: number; total: number };

export async function processImportFile(buffer: Buffer, filename: string): Promise<ImportResult> {
  const name = (filename || "").toLowerCase();
  const isCsv = name.endsWith(".csv");
  const rows = isCsv ? parseCSV(buffer) : parseXLSX(buffer);

  await initDb();
  const db = getDb();
  const insertSql =
    db.type === "postgres"
      ? `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT(phone) DO UPDATE SET active = TRUE, name = EXCLUDED.name, email = EXCLUDED.email,
         date_of_birth = EXCLUDED.date_of_birth, wedding_day = EXCLUDED.wedding_day, city = EXCLUDED.city`
      : `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active)
         VALUES ($1, $2, $3, $4, $5, $6, 1)
         ON CONFLICT(phone) DO UPDATE SET active = 1, name = excluded.name, email = excluded.email,
         date_of_birth = excluded.date_of_birth, wedding_day = excluded.wedding_day, city = excluded.city`;

  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const c = rowToCustomer(row);
    if (!c) {
      skipped++;
      continue;
    }
    const existing = await queryCustomers(db, "SELECT phone FROM customers WHERE phone = $1", [c.phone]);
    const existed = existing.length > 0;
    await runDb(db, insertSql, [c.phone, c.name, c.email || "", c.date_of_birth || "", c.wedding_day || "", c.city || ""]);
    if (existed) updated++;
    else added++;
  }
  if (db.type === "sqlite") db.conn.close();

  return { added, updated, skipped, total: rows.length };
}

export { MAX_FILE_SIZE };
