import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { initDb, getDb, queryCustomers } from "@/lib/db";
import { getAppSecret } from "@/lib/security";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";
import { resolveAppBaseUrl, publishSmsTask } from "@/lib/qstash";

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

function wantsJson(req: NextRequest): boolean {
  return req.headers.get("accept")?.includes("application/json") ?? false;
}

async function respond(req: NextRequest, ok: boolean, msg: string, sessionOk: boolean) {
  if (wantsJson(req)) {
    return NextResponse.json({ ok, msg });
  }
  const res = NextResponse.redirect(new URL("/admin?msg=" + encodeURIComponent(msg), req.url), 303);
  if (sessionOk) await attachSessionCookie(res, "admin");
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
    const { ok: rateOk } = await checkRateLimit(ip, "broadcast", LIMITS.broadcast.max);
    if (!rateOk) return respond(req, false, "יותר מדי בקשות", sessionOk);

    const message = (form.get("message") as string)?.trim() ?? "";
    if (!message || message.length > 1000) {
      return respond(req, false, "הודעה לא תקינה", sessionOk);
    }

    await initDb();
    const db = getDb();
    // Every active member, always. The former "only those who never received a
    // message" audience is gone: it split the club into cohorts that no longer
    // mean anything to the business.
    const activeClause = db.type === "postgres" ? "active = TRUE" : "active = 1";
    const rows = await queryCustomers(
      db,
      `SELECT phone FROM customers WHERE ${activeClause}`,
      []
    );
    if (db.type === "sqlite") db.conn.close();

    if (rows.length === 0) {
      return respond(req, false, "אין לקוחות פעילים לשליחה.", sessionOk);
    }

    // Request origin first (matches Python url_root), then env fallbacks.
    const requestOrigin = req.url ? new URL(req.url).origin : req.nextUrl?.origin ?? "";
    const baseUrl = resolveAppBaseUrl(requestOrigin);
    const targetEndpoint = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/send_sms_task` : "";
    if (!targetEndpoint.startsWith("https://") || /undefined/i.test(targetEndpoint)) {
      return respond(
        req,
        false,
        "שגיאה: לא ניתן לקבוע כתובת API. הגדר ב-Vercel: VERCEL_URL או APP_URL (למשל https://your-app.vercel.app).",
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
    let count = 0;
    let lastError: string | null = null;
    for (let i = 0; i < phones.length; i += CHUNK) {
      const chunk = phones.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map((phone) =>
          publishSmsTask({ targetEndpoint, phone, message, secret, token: QSTASH_TOKEN! })
        )
      );
      for (const r of results) {
        if (r.ok) count += 1;
        else if (r.error) lastError = r.error;
      }
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
