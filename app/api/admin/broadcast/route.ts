import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { getDb, queryCustomers } from "@/lib/db";
import { getAppSecret } from "@/lib/security";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

function redirectAdmin(req: NextRequest, msg: string) {
  return NextResponse.redirect(new URL("/admin?msg=" + encodeURIComponent(msg), req.url), 303);
}

export async function POST(req: NextRequest) {
  const ok = await getAdminSession();
  if (!ok) return redirectAdmin(req, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.");

  const ip = await getClientIp();
  const { ok: rateOk } = checkRateLimit(ip, "broadcast", LIMITS.broadcast.max);
  if (!rateOk) return NextResponse.redirect(new URL("/admin?msg=" + encodeURIComponent("יותר מדי בקשות"), req.url), 303);

  const form = await req.formData();
  const message = (form.get("message") as string)?.trim() ?? "";
  if (!message || message.length > 1000) {
    return NextResponse.redirect(new URL("/admin?msg=" + encodeURIComponent("הודעה לא תקינה"), req.url), 303);
  }

  const db = getDb();
  const activeCondition = db.type === "postgres" ? "WHERE active = TRUE" : "WHERE active = 1";
  const rows = await queryCustomers(
    db,
    `SELECT phone FROM customers ${activeCondition}`,
    []
  );
  if (db.type === "sqlite") db.conn.close();

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (req.nextUrl.origin || "").replace(/\/$/, "");
  const targetEndpoint = `${baseUrl}/api/send_sms_task`;
  const secret = getAppSecret();

  if (!QSTASH_TOKEN) {
    return NextResponse.redirect(new URL("/admin?msg=" + encodeURIComponent("שגיאה: חסר QSTASH_TOKEN"), req.url), 303);
  }

  let count = 0;
  for (const row of rows) {
    const phone = String(row.phone ?? "");
    try {
      await fetch(`https://qstash.upstash.io/v2/publish/${targetEndpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${QSTASH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, message, secret }),
        signal: AbortSignal.timeout(5000),
      });
      count += 1;
    } catch (e) {
      console.error("Failed to queue", phone, e);
    }
  }

  return NextResponse.redirect(
    new URL("/admin?msg=" + encodeURIComponent(`ההודעות נשלחו לתור (נשלח ל-${count} לקוחות)`), req.url),
    303
  );
}
