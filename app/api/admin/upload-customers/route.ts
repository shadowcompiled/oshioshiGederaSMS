import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getDb, runDb, initDb, queryCustomers } from "@/lib/db";
import { formatPhone, isValidPhone, isValidEmail } from "@/lib/validation";
import * as XLSX from "xlsx";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Map possible header names (Hebrew/English) to our DB columns
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

function parseXLSX(buffer: Buffer): Record<string, string>[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  if (data.length < 2) return [];
  const rawHeaders = (data[0] ?? []).map((h) => String(h ?? "").trim());
  const headers = rawHeaders.map((h) => normalizeHeader(h));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < data.length; i++) {
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

function redirectAdmin(req: NextRequest, msg: string) {
  const url = new URL("/admin", req.url);
  url.searchParams.set("msg", msg);
  return NextResponse.redirect(url, 303);
}

function redirectLogin(req: NextRequest) {
  return NextResponse.redirect(new URL("/login", req.url), 303);
}

export async function POST(req: NextRequest) {
  const ok = await getAdminSession();
  if (!ok) return redirectLogin(req);

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file || !file.size) {
      return redirectAdmin(req, "לא נבחר קובץ.");
    }
    if (file.size > MAX_FILE_SIZE) {
      return redirectAdmin(req, "הקובץ גדול מדי (עד 5MB).");
    }
    const type = file.type.toLowerCase();
    const name = (file.name || "").toLowerCase();
    const isCsv = type === "text/csv" || name.endsWith(".csv");
    const isXlsx = type.includes("spreadsheet") || type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls");
    if (!isCsv && !isXlsx) {
      return redirectAdmin(req, "סוג קובץ לא נתמך. העלה CSV או Excel (.xlsx).");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = isCsv ? parseCSV(buffer) : parseXLSX(buffer);
    if (rows.length === 0) {
      return redirectAdmin(req, "לא נמצאו שורות בקובץ או שהעמודות לא מזוהות.");
    }

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

    return redirectAdmin(req, `ייבוא הושלם: נוספו ${added}, עודכנו ${updated}, דולגו ${skipped} שורות.`);
  } catch (e) {
    console.error("Upload error:", e);
    return redirectAdmin(req, e instanceof Error ? e.message : "שגיאה בייבוא.");
  }
}
