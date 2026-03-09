import { NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { getDb, queryCustomers, mapRow } from "@/lib/db";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

export async function GET() {
  const ok = await getAdminSession();
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ip = await getClientIp();
  const { ok: rateOk } = checkRateLimit(ip, "export-csv", LIMITS.exportCsv.max);
  if (!rateOk) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const db = getDb();
  const rows = await queryCustomers(
    db,
    "SELECT phone, name, email, date_of_birth, wedding_day, city, active, created_at FROM customers ORDER BY name ASC",
    []
  );
  if (db.type === "sqlite") db.conn.close();

  const header = "שם,טלפון,דוא\"ל,תאריך לידה,יום חתונה,עיר,תאריך רישום,סטטוס\n";
  const lines = rows.map((r) => {
    const c = mapRow(r);
    const status = c.active ? "פעיל" : "הוסר";
    const regDate = c.created_at
      ? (typeof c.created_at === "string"
          ? c.created_at.split(" ")[0]
          : (c.created_at as Date).toISOString().slice(0, 10))
      : "";
    return [c.name, c.phone, c.email || "", c.date_of_birth || "", c.wedding_day || "", c.city || "", regDate, status]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
  });
  const csv = "\uFEFF" + header + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv; charset=utf-8" });
  const filename = `customers_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`;

  const res = new NextResponse(blob, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
  await attachSessionCookie(res);
  return res;
}
