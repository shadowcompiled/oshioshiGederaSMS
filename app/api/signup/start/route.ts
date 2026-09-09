import { NextRequest, NextResponse } from "next/server";
import { getDb, queryCustomers, initDb } from "@/lib/db";
import { parseSubmitFields } from "@/lib/submit-form";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";
import { startPhoneVerification } from "@/lib/phone-verification";
import { isRealSmsConfigured, sendSms } from "@/lib/sms";
import { verificationSms } from "@/lib/sms-messages";
import { OTP_LENGTH, OTP_TTL_MS } from "@/lib/otp";
import { isPhoneVerificationRequired } from "@/lib/features";

/**
 * Step 1 of signup: validate the whole form, then text a one-time code to the
 * number the customer typed. No membership is created here — that only happens
 * once /api/signup/verify has proven the customer holds the phone.
 *
 * The full form is validated up front on purpose: it would be rude to send an
 * SMS and only then tell someone their email address is malformed.
 *
 * This route is also where the browser *discovers* whether verification is
 * switched on (`verificationRequired` in the response). The flag is never
 * shipped to the client as build-time state: the landing page is statically
 * rendered and cacheable, so an inlined value could outlive a change to the
 * switch and leave the form offering a flow the server no longer accepts.
 */
export const dynamic = "force-dynamic";

export type StartError =
  | "missing"
  | "invalid_phone"
  | "invalid_email"
  | "underage"
  | "consent"
  | "already_registered"
  | "rate"
  | "cooldown"
  | "too_many_sends"
  | "sms_unavailable"
  | "sms_failed"
  | "system";

function fail(error: StartError, extra: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok: underLimit } = await checkRateLimit(ip, "signup_start", LIMITS.signupStart.max);
  if (!underLimit) return fail("rate", {}, 429);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("missing");
  }

  const parsed = parseSubmitFields({
    name: form.get("name"),
    phone: form.get("phone"),
    email: form.get("email"),
    date_of_birth: form.get("date_of_birth"),
    wedding_day: form.get("wedding_day"),
    city: form.get("city"),
    consent: form.get("consent"),
  });
  if (!parsed.ok) return fail(parsed.error);
  const { phone } = parsed.fields;

  try {
    await initDb();
    const db = getDb();
    try {
      // One verified number, one membership. An active row here is a hard stop;
      // an inactive one is a past member re-joining, which reuses the same row.
      const existing = (
        await queryCustomers(db, "SELECT active FROM customers WHERE phone = $1", [phone])
      )[0];
      if (existing && (existing.active === true || existing.active === 1)) {
        return fail("already_registered");
      }

      // Switched off: no code, no SMS, no phone_verifications row. The client
      // submits straight away and /api/submit skips the token check the same
      // way. The duplicate-number check above still ran, so one number still
      // maps to one membership — only the proof-of-ownership step is skipped.
      if (!isPhoneVerificationRequired()) {
        return NextResponse.json({ ok: true, phone, verificationRequired: false });
      }

      if (!isRealSmsConfigured() && process.env.NODE_ENV === "production") {
        console.error("Signup OTP requested but no real SMS provider is configured");
        return fail("sms_unavailable");
      }

      const started = await startPhoneVerification(db, phone);
      if (!started.ok) return fail(started.error, { retryAfterSec: started.retryAfterSec });

      if (isRealSmsConfigured()) {
        const sent = await sendSms(
          phone,
          verificationSms(started.code, Math.floor(OTP_TTL_MS / 60000))
        );
        if (!sent.ok) {
          console.error("Failed to send verification SMS", sent.status ?? "", sent.error);
          return fail("sms_failed");
        }
      } else {
        // Local development without real SMS (no provider configured, or the
        // mock guard is active): surface the code so the flow is testable.
        // Guarded by NODE_ENV, and unreachable in production because the
        // check above already returned sms_unavailable there.
        console.warn(`[dev] verification code for ${phone}: ${started.code}`);
        return NextResponse.json({
          ok: true,
          phone,
          verificationRequired: true,
          codeLength: OTP_LENGTH,
          resendInSec: started.resendInSec,
          expiresInSec: started.expiresInSec,
          devCode: started.code,
        });
      }

      return NextResponse.json({
        ok: true,
        phone,
        verificationRequired: true,
        codeLength: OTP_LENGTH,
        resendInSec: started.resendInSec,
        expiresInSec: started.expiresInSec,
      });
    } finally {
      if (db.type === "sqlite") db.conn.close();
    }
  } catch (e) {
    console.error("Signup start error:", e);
    return fail("system");
  }
}
