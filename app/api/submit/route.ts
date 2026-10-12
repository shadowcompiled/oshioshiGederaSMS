import { NextRequest, NextResponse } from "next/server";
import { getDb, runDb, queryCustomers, initDb } from "@/lib/db";
import { parseSubmitFields, type SubmitError } from "@/lib/submit-form";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";
import { issueSignupGifts } from "@/lib/gifts";
import { welcomeSms, welcomeBackSms } from "@/lib/sms-messages";
import { CONSENT_VERSION } from "@/lib/consent";
import { resolveAppBaseUrl, publishSmsTask } from "@/lib/qstash";
import { getAppSecret } from "@/lib/security";
import { consumeSignupToken } from "@/lib/phone-verification";
import { isPhoneVerificationRequired } from "@/lib/features";

export type SubmitErrorKey = SubmitError | "already_registered" | "system" | "rate" | "verification_required";

function wantsJson(req: NextRequest): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("application/json");
}

function jsonResponse(ok: boolean, error?: SubmitErrorKey) {
  return NextResponse.json({ success: ok, error: error ?? null });
}

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = await checkRateLimit(ip, "submit", LIMITS.submit.max);
  if (!ok) {
    if (wantsJson(req)) return jsonResponse(false, "rate");
    return NextResponse.redirect(new URL("/?error=rate", req.url));
  }

  const form = await req.formData();
  const parsed = parseSubmitFields({
    name: form.get("name"),
    phone: form.get("phone"),
    email: form.get("email"),
    date_of_birth: form.get("date_of_birth"),
    wedding_day: form.get("wedding_day"),
    city: form.get("city"),
    consent: form.get("consent"),
  });

  if (!parsed.ok) {
    if (wantsJson(req)) return jsonResponse(false, parsed.error);
    return NextResponse.redirect(new URL(`/?error=${parsed.error}`, req.url));
  }
  const { name, phone, email, dob, wedding, city } = parsed.fields;

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
        if (db.type === "sqlite") db.conn.close();
        if (wantsJson(req)) return jsonResponse(false, "already_registered");
        return NextResponse.redirect(new URL("/?error=already_registered", req.url));
      }
    }

    // The gate: while REQUIRE_PHONE_VERIFICATION is on, a membership is only
    // ever created for a number whose owner answered an SMS code. The token was
    // minted by /api/signup/verify, is bound to this exact phone, expires, and
    // is spent atomically here — so it cannot be replayed, reused for a
    // different number, or forged client-side. Checked after the duplicate
    // check so an already-registered customer doesn't burn a token for nothing.
    //
    // The flag is read here, at request time, rather than trusted from the
    // client: a browser holding a stale copy of the page can never talk the
    // server out of verifying.
    if (isPhoneVerificationRequired() && !(await consumeSignupToken(db, phone, form.get("verification_token")))) {
      if (db.type === "sqlite") db.conn.close();
      if (wantsJson(req)) return jsonResponse(false, "verification_required");
      return NextResponse.redirect(new URL("/?error=verification_required", req.url));
    }

    const consentAt = new Date().toISOString();
    const insertSql =
      db.type === "postgres"
        ? `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active, consent_at, consent_version, consent_ip)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9)
           ON CONFLICT(phone) DO UPDATE SET active = TRUE, unsubscribed_at = NULL, name = EXCLUDED.name, email = EXCLUDED.email,
           date_of_birth = EXCLUDED.date_of_birth, wedding_day = EXCLUDED.wedding_day, city = EXCLUDED.city,
           consent_at = EXCLUDED.consent_at, consent_version = EXCLUDED.consent_version, consent_ip = EXCLUDED.consent_ip`
        : `INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active, consent_at, consent_version, consent_ip)
           VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)
           ON CONFLICT(phone) DO UPDATE SET active = 1, unsubscribed_at = NULL, name = excluded.name, email = excluded.email,
           date_of_birth = excluded.date_of_birth, wedding_day = excluded.wedding_day, city = excluded.city,
           consent_at = excluded.consent_at, consent_version = excluded.consent_version, consent_ip = excluded.consent_ip`;
    await runDb(db, insertSql, [phone, name, email, dob, wedding, city, consentAt, CONSENT_VERSION, ip]);

    // Joining Reward (+ same-month birthday/anniversary) — issued inside the
    // same request; duplicate-safe on re-subscribes via UNIQUE(phone,type,period).
    // joiningIssued=false means a re-subscriber whose joining gift already
    // exists — the welcome SMS must not promise a fresh one.
    let joiningIssued = false;
    try {
      ({ joiningIssued } = await issueSignupGifts(db, { phone, dob, wedding }));
    } catch (e) {
      console.error("Failed to issue signup gifts for", phone, e);
    }

    if (db.type === "sqlite") db.conn.close();

    // Welcome SMS — queued synchronously (serverless can't outlive the response),
    // but failures are swallowed: nothing after the committed insert may change
    // the HTTP outcome of a successful signup.
    try {
      const qstashToken = process.env.QSTASH_TOKEN;
      const baseUrl = resolveAppBaseUrl(req.nextUrl.origin);
      if (qstashToken && baseUrl) {
        const r = await publishSmsTask({
          targetEndpoint: `${baseUrl}/api/send_sms_task`,
          phone,
          message: joiningIssued ? welcomeSms(name) : welcomeBackSms(name),
          secret: getAppSecret(),
          token: qstashToken,
          timeoutMs: 5000,
          kind: "welcome",
        });
        if (!r.ok) console.error("Failed to queue welcome sms for", phone, r.error);
      }
    } catch (e) {
      console.error("Failed to queue welcome sms for", phone, e);
    }
    if (wantsJson(req)) return jsonResponse(true);
    return NextResponse.redirect(new URL("/?success=1", req.url));
  } catch (e) {
    console.error("Submit error:", e);
    if (wantsJson(req)) return jsonResponse(false, "system");
    return NextResponse.redirect(new URL("/?error=system", req.url));
  }
}
