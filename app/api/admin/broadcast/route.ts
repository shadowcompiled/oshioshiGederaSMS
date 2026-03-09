import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { initDb, getDb, queryCustomers } from "@/lib/db";
import { getAppSecret } from "@/lib/security";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const QSTASH_BASE = (process.env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/$/, "");

function wantsJson(req: NextRequest): boolean {
  return req.headers.get("accept")?.includes("application/json") ?? false;
}

async function respond(req: NextRequest, ok: boolean, msg: string, sessionOk: boolean) {
  if (wantsJson(req)) {
    return NextResponse.json({ ok, msg });
  }
  const res = NextResponse.redirect(new URL("/admin?msg=" + encodeURIComponent(msg), req.url), 303);
  if (sessionOk) await attachSessionCookie(res);
  return res;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const sessionOk = await getAdminSession();
    const tokenFromBody = (form.get("import_token") as string) ?? null;
    const tokenFromQuery = req.nextUrl.searchParams.get("import_token");
    const tokenOk = verifyImportToken(tokenFromBody ?? tokenFromQuery ?? null);
    if (!sessionOk && !tokenOk) return respond(req, false, "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב.", false);

    const ip = await getClientIp();
    const { ok: rateOk } = checkRateLimit(ip, "broadcast", LIMITS.broadcast.max);
    if (!rateOk) return respond(req, false, "יותר מדי בקשות", sessionOk);

    const message = (form.get("message") as string)?.trim() ?? "";
    if (!message || message.length > 1000) {
      return respond(req, false, "הודעה לא תקינה", sessionOk);
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
      return respond(req, false, "אין לקוחות חדשים (שטרם קיבלו הודעה) לשליחה.", sessionOk);
    }
    if (rows.length === 0) {
      return respond(req, false, "אין לקוחות פעילים לשליחה.", sessionOk);
    }

    let baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (req.nextUrl.origin || "").replace(/\/$/, "");
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      baseUrl = baseUrl ? `https://${baseUrl}` : process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "";
    }
    const targetEndpoint = baseUrl ? `${baseUrl}/api/send_sms_task` : "";
    if (!targetEndpoint || !targetEndpoint.startsWith("https://")) {
      return respond(
        req,
        false,
        "שגיאה: לא ניתן לקבוע כתובת API (הגדר VERCEL_URL או VERCEL_PROJECT_PRODUCTION_URL ב-Vercel).",
        sessionOk
      );
    }
    const secret = getAppSecret();

    if (!QSTASH_TOKEN) {
      return respond(req, false, "שגיאה: חסר QSTASH_TOKEN. הגדר QSTASH_TOKEN ב-Vercel.", sessionOk);
    }

    const phones = rows
      .map((row) => String(row.phone ?? "").trim())
      .filter(Boolean);
    if (phones.length === 0) {
      return respond(req, false, "אין מספרי טלפון תקינים לשליחה.", sessionOk);
    }

    const CHUNK = 8;
    const authHeader = `Bearer ${QSTASH_TOKEN}`;
    let count = 0;
    let lastError: string | null = null;
    for (let i = 0; i < phones.length; i += CHUNK) {
      const chunk = phones.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map(async (phone) => {
          const qstashUrl = `${QSTASH_BASE}/v2/publish/${encodeURIComponent(targetEndpoint)}`;
          try {
            const res = await fetch(qstashUrl, {
              method: "POST",
              headers: {
                Authorization: authHeader,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ phone, message, secret }),
              signal: AbortSignal.timeout(12000),
            });
            if (res.ok) return true;
            const text = await res.text();
            lastError = `QStash ${res.status}: ${text.slice(0, 120)}`;
            return false;
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
            return false;
          }
        })
      );
      count += results.filter(Boolean).length;
    }

    if (count === 0) {
      return respond(
        req,
        false,
        "שליחה לתור נכשלה. בדוק ש-QSTASH_TOKEN תקין ב-Vercel ואת כתובת ה-API. " + (lastError ?? ""),
        sessionOk
      );
    }

    return respond(req, true, `ההודעות נשלחו לתור QStash (${count}/${phones.length} לקוחות).`, sessionOk);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Broadcast error:", err);
    return respond(req, false, "שגיאה בשידור: " + msg, false);
  }
}
