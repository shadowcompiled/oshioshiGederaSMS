"use server";

import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { processImportFile, MAX_FILE_SIZE } from "@/lib/import-customers";

export async function importCustomersAction(formData: FormData) {
  const ok = await getAdminSession();
  if (!ok) redirect("/login");

  const file = formData.get("file") as File | null;
  if (!file || !file.size) {
    redirect("/admin?msg=" + encodeURIComponent("לא נבחר קובץ."));
  }
  if (file.size > MAX_FILE_SIZE) {
    redirect("/admin?msg=" + encodeURIComponent("הקובץ גדול מדי (עד 5MB)."));
  }

  const type = file.type.toLowerCase();
  const name = (file.name || "").toLowerCase();
  const isCsv = type === "text/csv" || name.endsWith(".csv");
  const isXlsx = type.includes("spreadsheet") || type.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls");
  if (!isCsv && !isXlsx) {
    redirect("/admin?msg=" + encodeURIComponent("סוג קובץ לא נתמך. העלה CSV או Excel (.xlsx)."));
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { added, updated, skipped } = await processImportFile(buffer, file.name || "");
    const msg = `ייבוא הושלם: נוספו ${added}, עודכנו ${updated}, דולגו ${skipped} שורות.`;
    redirect("/admin?msg=" + encodeURIComponent(msg));
  } catch (e) {
    console.error("Import error:", e);
    const errMsg = e instanceof Error ? e.message : "שגיאה בייבוא.";
    redirect("/admin?msg=" + encodeURIComponent(errMsg));
  }
}
