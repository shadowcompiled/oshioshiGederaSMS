import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { initDb, getDb, queryCustomers } from "@/lib/db";
import { getAppSecret } from "@/lib/security";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

function redirectAdmin(req: NextRequest, msg: string) {
  return NextResponse.redirect(new URL("/admin?msg=" + encodeURIComponent(msg), req.url), 303);
}

export async function POST(req: NextRequest) {
  try {
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

    await initDb();
    const onlyNew = form.get("send_to") === "new_only";
    const db = getDb();
    const activeClause = db.type === "postgres" ? "active = TRUE" : "active = 1";
    const newClause = "AND received_message_at IS NULL";
    const whereClause = onlyNew ? `${activeClause} ${newClause}` : activeClause;
    const rows = await queryCustomers(
      db,
      `SELECT phone FROM customers WHERE ${whereClause}`,
      []
    );
    if (db.type === "sqlite") db.conn.close();

    if (onlyNew && rows.length === 0) {
      return redirectAdmin(req, "אין לקוחות חדשים (שטרם קיבלו הודעה) לשליחה.");
    }
    if (rows.length === 0) {
      return redirectAdmin(req, "אין לקוחות פעילים לשליחה.");
    }

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (req.nextUrl.origin || "").replace(/\/$/, "");
    const targetEndpoint = `${baseUrl}/api/send_sms_task`;
    const secret = getAppSecret();

    if (!QSTASH_TOKEN) {
      return redirectAdmin(req, "שגיאה: חסר QSTASH_TOKEN. הגדר QSTASH_TOKEN ב-Vercel.");
    }

    const batchUrl = "https://qstash.upstash.io/v2/batch";
    const batchBody = rows
      .map((row) => String(row.phone ?? "").trim())
      .filter(Boolean)
      .map((phone) => ({
        destination: targetEndpoint,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message, secret }),
      }));

    if (batchBody.length === 0) {
      return redirectAdmin(req, "אין מספרי טלפון תקינים לשליחה.");
    }

    let count = 0;
    let lastError: string | null = null;
    try {
      const res = await fetch(batchUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${QSTASH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batchBody),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        const text = await res.text();
        lastError = `QStash ${res.status}: ${text.slice(0, 150)}`;
        console.error("QStash batch failed", res.status, text);
      } else {
        const results = (await res.json()) as unknown[];
        count = Array.isArray(results) ? results.filter((r) => r && typeof r === "object" && "messageId" in r).length : 0;
        if (count < batchBody.length && Array.isArray(results)) {
          lastError = `חלק מההודעות לא נשלחו (${count}/${batchBody.length})`;
        }
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error("Broadcast QStash error", e);
    }

    if (count === 0) {
      return redirectAdmin(
        req,
        "שליחה לתור נכשלה. בדוק ש-QSTASH_TOKEN תקין ב-Vercel ואת כתובת ה-API. " + (lastError ?? "")
      );
    }

    return NextResponse.redirect(
      new URL("/admin?msg=" + encodeURIComponent(`ההודעות נשלחו לתור (נשלח ל-${count} לקוחות)`), req.url),
      303
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Broadcast error:", err);
    return redirectAdmin(req, "שגיאה בשידור: " + msg);
  }
}
