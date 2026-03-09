import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { getDb, queryCustomers } from "@/lib/db";
import { getAppSecret } from "@/lib/security";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

function redirectAdmin(req: NextRequest, msg: string) {
  return NextResponse.redirect(new URL("/admin?msg=" + encodeURIComponent(msg), req.url), 303);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const sessionOk = await getAdminSession();
  const tokenFromBody = (form.get("import_token") as string) ?? null;
  const tokenFromQuery = req.nextUrl.searchParams.get("import_token");
  const tokenOk = verifyImportToken(tokenFromBody ?? tokenFromQuery ?? null);
  if (!sessionOk && !tokenOk) return redirectAdmin(req, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.");

  const ip = await getClientIp();
  const { ok: rateOk } = checkRateLimit(ip, "broadcast", LIMITS.broadcast.max);
  if (!rateOk) return redirectAdmin(req, "יותר מדי בקשות");

  const message = (form.get("message") as string)?.trim() ?? "";
  if (!message || message.length > 1000) {
    return redirectAdmin(req, "הודעה לא תקינה");
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
    return redirectAdmin(req, "שגיאה: חסר QSTASH_TOKEN. הגדר QSTASH_TOKEN ב-Vercel.");
  }

  const qstashPublishUrl = `https://qstash.upstash.io/v2/publish/${targetEndpoint}`;

  let count = 0;
  let lastError: string | null = null;
  for (const row of rows) {
    const phone = String(row.phone ?? "").trim();
    if (!phone) continue;
    try {
      const res = await fetch(qstashPublishUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${QSTASH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, message, secret }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        count += 1;
      } else {
        const text = await res.text();
        lastError = `QStash ${res.status}: ${text.slice(0, 100)}`;
        console.error("QStash publish failed", res.status, text, "for", phone);
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error("Failed to queue", phone, e);
    }
  }

  if (rows.length > 0 && count === 0) {
    return redirectAdmin(
      req,
      "שליחה לתור נכשלה. בדוק ש-QSTASH_TOKEN תקין ב-Vercel ואת כתובת ה-API. " + (lastError ? lastError : "")
    );
  }

  return NextResponse.redirect(
    new URL("/admin?msg=" + encodeURIComponent(`ההודעות נשלחו לתור (נשלח ל-${count} לקוחות)`), req.url),
    303
  );
}
