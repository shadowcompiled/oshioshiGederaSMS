"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import DateField from "./DateField";
import CityField from "./CityField";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "אנא מלאו את כל שדות החובה",
  invalid_phone: "מספר טלפון לא תקין",
  invalid_email: 'כתובת דוא"ל לא תקינה',
  already_registered: "אתם כבר רשומים למועדון! המספר שלכם כבר קיים במערכת.",
  system: "תקלה במערכת",
  rate: "יותר מדי בקשות. נסו שוב מאוחר יותר.",
  consent: "כדי להצטרף למועדון יש לאשר קבלת הודעות SMS",
  underage: "ההצטרפות למועדון מותרת מגיל 18 ומעלה",
  sms_unavailable: "שירות ההודעות אינו זמין כרגע. נסו שוב מאוחר יותר.",
  sms_failed: "לא הצלחנו לשלוח את קוד האימות. בדקו את המספר ונסו שוב.",
  invalid_code: "הקוד שגוי. בדקו את ההודעה ונסו שוב.",
  expired: "תוקף הקוד פג. שלחו קוד חדש.",
  no_code: "לא נמצא קוד פעיל. שלחו קוד חדש.",
  too_many_attempts: "יותר מדי ניסיונות. שלחו קוד חדש.",
  too_many_sends: "נשלחו יותר מדי קודים למספר הזה. נסו שוב בעוד שעה.",
  verification_required: "יש לאמת את מספר הטלפון לפני ההצטרפות.",
  verification_disabled: "אימות טלפון אינו פעיל כרגע. רעננו את הדף ונסו שוב.",
};

// Optional business contact for the success screen; buttons hide when unset.
const BUSINESS_PHONE = process.env.NEXT_PUBLIC_BUSINESS_PHONE ?? "";
const WHATSAPP_PHONE = process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "";

const CODE_LENGTH = 6;

type Step = "details" | "code" | "done";

/** Israeli local display form for the "we texted 05x-xxxxxxx" line. */
function displayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
  return local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3)}` : phone;
}

function messageFor(error: unknown, fallback: string): string {
  return typeof error === "string" && ERROR_MESSAGES[error] ? ERROR_MESSAGES[error] : fallback;
}

export default function VIPForm() {
  const [step, setStep] = useState<Step>("details");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [resendIn, setResendIn] = useState(0);

  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  // The validated form fields are kept so the final submit re-sends exactly
  // what was verified, without asking the customer to retype anything.
  const detailsRef = useRef<FormData | null>(null);

  const ids = useId();
  const feedbackId = `${ids}-feedback`;
  const codeHintId = `${ids}-code-hint`;

  // Resend cooldown, ticked locally. The server enforces the real one — this
  // just stops the customer tapping a button that is going to be refused.
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  // Moving between steps swaps the whole panel, so send focus to the new
  // heading: without this a screen reader or keyboard user is left on a button
  // that no longer exists and lands back at the top of the document.
  useEffect(() => {
    if (step === "code") {
      stepHeadingRef.current?.focus();
      codeRef.current?.focus();
    }
  }, [step]);

  /**
   * Create the membership. `token` is undefined when phone verification is
   * switched off server-side; /api/submit applies the same switch, so a stale
   * tab that skips the code step is still refused rather than let through.
   */
  const completeSignup = useCallback(async (data: FormData, token?: string) => {
    const payload = new FormData();
    data.forEach((value, key) => payload.append(key, value));
    if (token) payload.set("verification_token", token);

    const res = await fetch("/api/submit", {
      method: "POST",
      body: payload,
      headers: { Accept: "application/json" },
    });
    const done = await res.json().catch(() => ({}));
    if (done.success) {
      setStep("done");
      return true;
    }
    setError(messageFor(done.error, "שגיאה. נסו שוב."));
    // The server wants a code after all (the switch was turned on while this
    // page was open): fall back to the verification flow instead of dead-ending.
    if (done.error === "verification_required" || done.error === "already_registered") {
      setStep("details");
    }
    return false;
  }, []);

  const requestCode = useCallback(async (data: FormData, isResend: boolean) => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch("/api/signup/start", {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => ({}));

      if (json.ok) {
        detailsRef.current = data;
        setVerifiedPhone(typeof json.phone === "string" ? json.phone : "");

        // The server, not the page, decides whether a code is required — the
        // landing page is static, so anything baked in at build time would go
        // stale the moment the switch is flipped.
        if (json.verificationRequired === false) {
          await completeSignup(data);
          return true;
        }

        setResendIn(typeof json.resendInSec === "number" ? json.resendInSec : 60);
        setCode("");
        setStep("code");
        if (isResend) setNotice("שלחנו קוד חדש");
        if (typeof json.devCode === "string") {
          // Only ever present when no SMS gateway is configured (local dev).
          setNotice(`קוד לפיתוח בלבד: ${json.devCode}`);
        }
        return true;
      }

      if (json.error === "cooldown" || json.error === "too_many_sends") {
        const wait = typeof json.retryAfterSec === "number" ? json.retryAfterSec : 60;
        setResendIn(wait);
        setError(
          json.error === "cooldown"
            ? `אפשר לבקש קוד נוסף בעוד ${wait} שניות`
            : ERROR_MESSAGES.too_many_sends
        );
        return false;
      }
      setError(messageFor(json.error, "שגיאה. נסו שוב."));
      return false;
    } catch {
      setError("תקלה במערכת. נסו שוב.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [completeSignup]);

  async function handleDetailsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = formRef.current;
    if (!form) return;
    await requestCode(new FormData(form), false);
  }

  async function handleResend() {
    const data = detailsRef.current;
    if (!data || resendIn > 0) return;
    await requestCode(data, true);
  }

  async function handleCodeSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = detailsRef.current;
    if (!data) {
      setStep("details");
      return;
    }
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const verifyRes = await fetch("/api/signup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ phone: verifiedPhone, code }),
      });
      const verified = await verifyRes.json().catch(() => ({}));

      if (!verified.ok) {
        if (verified.error === "invalid_code" && typeof verified.attemptsLeft === "number") {
          setError(
            verified.attemptsLeft > 0
              ? `${ERROR_MESSAGES.invalid_code} (${verified.attemptsLeft} ניסיונות נותרו)`
              : ERROR_MESSAGES.too_many_attempts
          );
        } else {
          setError(messageFor(verified.error, "שגיאה באימות. נסו שוב."));
        }
        setCode("");
        codeRef.current?.focus();
        return;
      }

      // Verified — spend the token immediately to create the membership.
      await completeSignup(data, verified.verificationToken);
    } catch {
      setError("תקלה במערכת. נסו שוב.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <div className="success-view" role="status">
        <div className="success-check" aria-hidden="true">
          ✓
        </div>
        <h2 className="success-title">נרשמתם למועדון</h2>
        <p>
          מעכשיו המבצעים, ההטבות ומתנת יום ההולדת יגיעו אליכם ב-SMS.
          אין צורך לעשות דבר נוסף.
        </p>
        {(BUSINESS_PHONE || WHATSAPP_PHONE) && (
          <div className="success-actions">
            {BUSINESS_PHONE && (
              <a className="btn-ghost" href={`tel:${BUSINESS_PHONE}`}>
                חיוג למסעדה
              </a>
            )}
            {WHATSAPP_PHONE && (
              <a
                className="btn-ghost"
                href={`https://wa.me/${WHATSAPP_PHONE}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                וואטסאפ
                <span className="sr-only"> (נפתח בחלון חדש)</span>
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  const feedback = error ?? notice;

  return (
    <>
      {/* The details form stays mounted and is hidden rather than unmounted, so
          "change phone number" comes back to a form the customer has already
          filled in. [hidden] also drops it from the accessibility tree and the
          tab order, so the two steps never overlap for a keyboard user. */}
      <form
        ref={formRef}
        onSubmit={handleDetailsSubmit}
        aria-describedby={feedbackId}
        hidden={step !== "details"}
      >
        <p className="sheet-section-note">שדות המסומנים בכוכבית אדומה הם שדות חובה.</p>
        <div className="form-group">
          <label htmlFor="name">
            שם מלא <span className="req" aria-hidden="true">*</span>
          </label>
          <input
            type="text"
            id="name"
            name="name"
            placeholder="שמך"
            required
            maxLength={100}
            autoComplete="name"
            disabled={loading}
          />
        </div>
        <div className="form-group">
          <label htmlFor="phone">
            טלפון נייד <span className="req" aria-hidden="true">*</span>
          </label>
          <input
            type="tel"
            id="phone"
            name="phone"
            className="input-ltr"
            dir="ltr"
            placeholder="050-1234567"
            required
            maxLength={20}
            inputMode="tel"
            autoComplete="tel"
            aria-describedby={`${ids}-phone-hint`}
            disabled={loading}
          />
          {/* True whether or not REQUIRE_PHONE_VERIFICATION is on. This step is
              statically rendered and cannot know the mode, so it must not
              promise a code — the next screen says so once the server has. */}
          <p id={`${ids}-phone-hint`} className="field-hint">
            לכאן יגיעו ההטבות, המבצעים והפינוקים.
          </p>
        </div>
        <div className="form-group">
          <label htmlFor="email">
            דוא&quot;ל <span className="req" aria-hidden="true">*</span>
          </label>
          <input
            type="email"
            id="email"
            name="email"
            className="input-ltr"
            dir="ltr"
            placeholder="example@email.com"
            required
            maxLength={255}
            autoComplete="email"
            disabled={loading}
          />
        </div>
        {/* Year bounds are computed at render on the client. The server
            re-checks the age regardless (lib/submit-form.ts fails closed on an
            unparseable date), so this only spares the customer a round-trip. */}
        <DateField
          name="date_of_birth"
          label="תאריך לידה"
          hint="כדי שנדע מתי לשלוח לכם את מתנת יום ההולדת. ההצטרפות מגיל 18."
          required
          disabled={loading}
          minYearsAgo={100}
          maxYearsAgo={18}
        />
        <DateField
          name="wedding_day"
          label="יום נישואין"
          hint="לא חובה. אם תמלאו, תחכה לכם מתנה גם בחודש יום הנישואין."
          disabled={loading}
          minYearsAgo={80}
          maxYearsAgo={0}
        />
        <CityField name="city" label="עיר" required disabled={loading} />
        <div className="form-group consent-group">
          <label className="consent-label" htmlFor="consent">
            <input type="checkbox" id="consent" name="consent" required disabled={loading} />
            <span>
              אני מאשר/ת קבלת הודעות SMS פרסומיות ושיווקיות ממועדון הלקוחות של Oshi Oshi גדרה — כולל
              מבצעים, הטבות, 1+1 ועדכונים — למספר שמסרתי, בהתאם ל
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                תקנון המועדון ומדיניות הפרטיות
                <span className="sr-only"> (נפתח בחלון חדש)</span>
              </a>
              . ניתן להסיר את ההסכמה בכל עת, ללא עלות, בקישור ההסרה שבכל הודעה.
            </span>
          </label>
        </div>
        <button type="submit" disabled={loading}>
        {loading ? "רגע..." : "הצטרפות למועדון"}
        </button>
      </form>

      {step === "code" && (
        <form onSubmit={handleCodeSubmit} className="otp-form" aria-describedby={feedbackId}>
          <h2 className="otp-title" tabIndex={-1} ref={stepHeadingRef}>
            אימות מספר הטלפון
          </h2>
          <p id={codeHintId} className="otp-hint">
            שלחנו לכם הודעת SMS עם קוד בן {CODE_LENGTH} ספרות, למספר{" "}
            <bdi className="otp-phone">{displayPhone(verifiedPhone)}</bdi>. הקלידו את הקוד
            כאן ונסיים.
          </p>
          <div className="form-group">
            <label htmlFor={`${ids}-code`}>
              הקוד שקיבלתם ב-SMS <span className="req" aria-hidden="true">*</span>
            </label>
            <input
              id={`${ids}-code`}
              ref={codeRef}
              className="otp-input"
              type="text"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={CODE_LENGTH}
              required
              dir="ltr"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={codeHintId}
              aria-invalid={error != null}
              disabled={loading}
            />
          </div>
          <button type="submit" disabled={loading || code.length !== CODE_LENGTH}>
            {loading ? "מאמת..." : "אימות והצטרפות"}
          </button>
          <div className="otp-actions">
            <button
              type="button"
              className="btn-link"
              onClick={handleResend}
              disabled={loading || resendIn > 0}
            >
              {resendIn > 0 ? `אפשר לבקש קוד חדש בעוד ${resendIn} שניות` : "לא קיבלתי קוד, שלחו שוב"}
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setStep("details");
                setError(null);
                setNotice(null);
                setCode("");
              }}
              disabled={loading}
            >
              תיקון מספר הטלפון
            </button>
          </div>
        </form>
      )}
      <p
        id={feedbackId}
        role="alert"
        aria-live="assertive"
        className={error ? "error form-feedback" : "notice form-feedback"}
      >
        {feedback}
      </p>
    </>
  );
}
