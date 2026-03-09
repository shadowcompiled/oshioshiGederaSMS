import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, attachSessionCookie } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { initDb, getDb, queryCustomers } from "@/lib/db";
import { getAppSecret } from "@/lib/security";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

/** QStash publish base: same as Python (https://qstash.upstash.io) or QSTASH_URL origin for EU. */
function getQstashPublishBase(): string {
  const raw = process.env.QSTASH_URL;
  if (!raw || !String(raw).trim()) return "https://qstash.upstash.io";
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.origin;
  } catch {
    return "https://qstash.upstash.io";
  }
}
const QSTASH_PUBLISH_BASE = getQstashPublishBase();

function normalizeBaseUrl(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/undefined/i.test(trimmed)) return "";
  if (trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("http://")) return trimmed;
  return `https://${trimmed}`;
}

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

    // Match Python: base from request first (request.url_root.rstrip('/')), then env fallbacks
    const requestOrigin = req.url ? new URL(req.url).origin : req.nextUrl?.origin ?? "";
    const baseUrl =
      normalizeBaseUrl(requestOrigin) ||
      normalizeBaseUrl(process.env.VERCEL_URL) ||
      normalizeBaseUrl(process.env.APP_URL) ||
      normalizeBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL);
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

    // Match Python: single URL string, raw POST (requests.post(url, headers=..., json=...))
    const qstashUrl = `${QSTASH_PUBLISH_BASE}/v2/publish/${targetEndpoint}`;
    const authHeader = `Bearer ${QSTASH_TOKEN}`;

    const CHUNK = 8;
    let count = 0;
    let lastError: string | null = null;
    for (let i = 0; i < phones.length; i += CHUNK) {
      const chunk = phones.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map(async (phone) => {
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
