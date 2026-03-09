import { NextRequest, NextResponse } from "next/server";
import { getDb, runDb, queryCustomers, initDb } from "@/lib/db";
import { formatPhone, isValidEmail, isValidPhone } from "@/lib/validation";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

const ERROR_KEYS = [
  "missing",
  "invalid_phone",
  "invalid_email",
  "already_registered",
  "system",
  "rate",
] as const;
export type SubmitErrorKey = (typeof ERROR_KEYS)[number];

function wantsJson(req: NextRequest): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("application/json");
}

function jsonResponse(ok: boolean, error?: SubmitErrorKey) {
  return NextResponse.json({ success: ok, error: error ?? null });
}

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = checkRateLimit(ip, "submit", LIMITS.submit.max);
  if (!ok) {
    if (wantsJson(req)) return jsonResponse(false, "rate");
    return NextResponse.redirect(new URL("/?error=rate", req.url));
  }

  const form = await req.formData();
  const name = (form.get("name") as string)?.trim().slice(0, 100) ?? "";
  const rawPhone = (form.get("phone") as string)?.trim().slice(0, 20) ?? "";
  const email = (form.get("email") as string)?.trim().slice(0, 255) ?? "";
  const dob = (form.get("date_of_birth") as string)?.trim() ?? "";
  const wedding = (form.get("wedding_day") as string)?.trim() ?? "";
  const city = (form.get("city") as string)?.trim().slice(0, 50) ?? "";

  if (!name || !rawPhone || !email || !dob || !wedding || !city) {
    if (wantsJson(req)) return jsonResponse(false, "missing");
    return NextResponse.redirect(new URL("/?error=missing", req.url));
  }

  const phone = formatPhone(rawPhone);
  if (!isValidPhone(phone)) {
    if (wantsJson(req)) return jsonResponse(false, "invalid_phone");
    return NextResponse.redirect(new URL("/?error=invalid_phone", req.url));
  }
  if (!isValidEmail(email)) {
    if (wantsJson(req)) return jsonResponse(false, "invalid_email");
    return NextResponse.redirect(new URL("/?error=invalid_email", req.url));
  }

  try {
    await initDb();
    const db = getDb();
    const existingRows = await queryCustomers(
      db,
      "SELECT phone, active FROM customers WHERE phone = $1",
      [phone]
    );
    const existing = existingRows[0];

    if (existing) {
      const isActive = existing.active === true || existing.active === 1;
      if (isActive) {
        if (wantsJson(req)) return jsonResponse(false, "already_registered");
        return NextResponse.redirect(new URL("/?error=already_registered", req.url));
      }
    }

    const insertSql =
      db.type === "postgres"
        ? `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)
           ON CONFLICT(phone) DO UPDATE SET active = TRUE, name = EXCLUDED.name, email = EXCLUDED.email,
           date_of_birth = EXCLUDED.date_of_birth, wedding_day = EXCLUDED.wedding_day, city = EXCLUDED.city`
        : `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active)
           VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT(phone) DO UPDATE SET active = 1, name = excluded.name, email = excluded.email,
           date_of_birth = excluded.date_of_birth, wedding_day = excluded.wedding_day, city = excluded.city`;
    await runDb(db, insertSql, [phone, name, email, dob, wedding, city]);

    if (db.type === "sqlite") db.conn.close();
    if (wantsJson(req)) return jsonResponse(true);
    return NextResponse.redirect(new URL("/?success=1", req.url));
  } catch (e) {
    console.error("Submit error:", e);
    if (wantsJson(req)) return jsonResponse(false, "system");
    return NextResponse.redirect(new URL("/?error=system", req.url));
  }
}
