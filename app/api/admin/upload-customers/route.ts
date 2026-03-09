import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { processImportFile, MAX_FILE_SIZE } from "@/lib/import-customers";

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
    const { added, updated, skipped } = await processImportFile(buffer, file.name || "");
    return redirectAdmin(req, `ייבוא הושלם: נוספו ${added}, עודכנו ${updated}, דולגו ${skipped} שורות.`);
  } catch (e) {
    console.error("Upload error:", e);
    return redirectAdmin(req, e instanceof Error ? e.message : "שגיאה בייבוא.");
  }
}
