import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getDb, runDb, initDb } from "@/lib/db";

function redirectAdmin(req: NextRequest, msg: string) {
  const url = new URL("/admin", req.url);
  url.searchParams.set("msg", msg);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  const ok = await getAdminSession();
  if (!ok) {
    return redirectAdmin(req, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.");
  }

  try {
    await initDb();
    const db = getDb();
    if (db.type === "postgres") {
      await runDb(db, "TRUNCATE TABLE customers", []);
    } else {
      await runDb(db, "DELETE FROM customers", []);
      db.conn.close();
    }
    return redirectAdmin(req, "מאגר הלקוחות אופס (0 אנשי קשר).");
  } catch (e) {
    console.error("Reset DB error:", e);
    return redirectAdmin(req, "שגיאה באיפוס המאגר.");
  }
}
