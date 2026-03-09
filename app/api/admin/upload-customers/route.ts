import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { processImportFile, MAX_FILE_SIZE } from "@/lib/import-customers";

async function redirectAdmin(req: NextRequest, msg: string, sessionOk: boolean) {
  const url = new URL("/admin", req.url);
  url.searchParams.set("msg", msg);
  const res = NextResponse.redirect(url, 303);
  if (sessionOk) await attachSessionCookie(res);
  return res;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const sessionOk = await getAdminSession();
  const tokenOk = verifyImportToken((formData.get("import_token") as string) ?? null);
  if (!sessionOk && !tokenOk) {
    return redirectAdmin(req, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.", false);
  }

  try {
    const file = formData.get("file") as File | null;
    if (!file || !file.size) {
      return redirectAdmin(req, "לא נבחר קובץ.", sessionOk);
    }
    if (file.size > MAX_FILE_SIZE) {
      return redirectAdmin(req, "הקובץ גדול מדי (עד 5MB).", sessionOk);
    }
    const type = file.type.toLowerCase();
    const name = (file.name || "").toLowerCase();
    const isCsv = type === "text/csv" || name.endsWith(".csv");
    const isXlsx = type.includes("spreadsheet") || type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls");
    if (!isCsv && !isXlsx) {
      return redirectAdmin(req, "סוג קובץ לא נתמך. העלה CSV או Excel (.xlsx).", sessionOk);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { added, updated, skipped } = await processImportFile(buffer, file.name || "");
    return redirectAdmin(req, `ייבוא הושלם: נוספו ${added}, עודכנו ${updated}, דולגו ${skipped} שורות.`, sessionOk);
  } catch (e) {
    console.error("Upload error:", e);
    return redirectAdmin(req, e instanceof Error ? e.message : "שגיאה בייבוא.", sessionOk);
  }
}
