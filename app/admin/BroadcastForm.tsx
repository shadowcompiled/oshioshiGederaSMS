"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  smsUnits,
  segmentsForUnits,
  estimateUnsubFooterUnits,
} from "@/lib/sms-segments";
import SmsPreviewDialog, { type SmsPreview } from "./SmsPreviewDialog";

/**
 * The broadcast composer. Sending is deliberately a two-step action: pressing
 * a send button only asks the server for a preview, and nothing leaves the
 * building until the operator approves the rendered message in the dialog.
 *
 * The live counter below the textarea is a client-side estimate for typing
 * feedback; the numbers in the preview come from the server, which knows the
 * real opt-out link and footer variant. `footerKeyword` and
 * `canReceiveReplies` are passed down from the server page so that even the
 * estimate reflects the provider that is actually configured.
 */

type Props = {
  importToken: string;
  activeCount: number;
  newCount: number;
  footerKeyword: string;
  canReceiveReplies: boolean;
  appBaseUrl: string;
};

type Mode = "broadcast" | "test";

const TEST_PHONE_STORAGE_KEY = "oshi-admin-test-phone";

export default function BroadcastForm({
  importToken,
  activeCount,
  newCount,
  footerKeyword,
  canReceiveReplies,
  appBaseUrl,
}: Props) {
  const ids = useId();
  const messageId = `${ids}-message`;
  const counterId = `${ids}-counter`;
  const testPhoneId = `${ids}-test-phone`;
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"all" | "new_only">("all");
  const [testPhone, setTestPhone] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState<Mode | null>(null);
  const [pending, setPending] = useState<{ mode: Mode; preview: SmsPreview } | null>(null);

  // The test number is almost always the phone of the operator, so remember it
  // rather than making them retype it on every visit.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TEST_PHONE_STORAGE_KEY);
      if (saved) setTestPhone(saved);
    } catch {
      // Private mode / blocked storage: the field just starts empty.
    }
  }, []);

  const footerUnits = useMemo(
    () => estimateUnsubFooterUnits(footerKeyword, appBaseUrl || undefined, canReceiveReplies),
    [footerKeyword, appBaseUrl, canReceiveReplies]
  );
  const units = smsUnits(message);
  const totalUnits = units === 0 ? 0 : units + footerUnits;
  const totalSegments = segmentsForUnits(totalUnits);
  const recipients = audience === "all" ? activeCount : newCount;
  const level = totalSegments >= 4 ? "high" : totalSegments >= 3 ? "warn" : "ok";
  const busy = sending || previewing !== null;

  /** Step one of every send: ask the server what would actually go out. */
  async function requestPreview(mode: Mode) {
    setFeedback(null);
    setPreviewing(mode);
    try {
      const res = await fetch("/api/admin/sms-preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          import_token: importToken,
          message,
          send_to: audience,
          mode,
          phone: mode === "test" ? testPhone : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true || !data.preview) {
        setFeedback({ ok: false, msg: data.msg ?? `שגיאה ${res.status} בהפקת התצוגה המקדימה.` });
        return;
      }
      if (mode === "test") {
        try {
          window.localStorage.setItem(TEST_PHONE_STORAGE_KEY, testPhone.trim());
        } catch {
          // Not worth surfacing: the send itself is unaffected.
        }
      }
      setPending({ mode, preview: data.preview as SmsPreview });
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : "שגיאת רשת." });
    } finally {
      setPreviewing(null);
    }
  }

  /** Step two: the operator approved what they saw. */
  async function confirmSend() {
    if (!pending) return;
    const { mode } = pending;
    setSending(true);
    try {
      let res: Response;
      if (mode === "test") {
        res = await fetch("/api/admin/send-test", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ import_token: importToken, phone: testPhone, message }),
        });
      } else {
        const formData = new FormData();
        formData.set("message", message);
        formData.set("send_to", audience);
        formData.set("import_token", importToken);
        res = await fetch("/api/admin/broadcast", {
          method: "POST",
          body: formData,
          credentials: "include",
          headers: { Accept: "application/json" },
        });
      }

      const data = await res.json().catch(() => ({}));
      if (data.msg != null) {
        setFeedback({ ok: data.ok === true, msg: data.msg });
        // A test send keeps the draft — checking the draft before the real
        // broadcast is the entire point. A completed broadcast clears it.
        if (data.ok === true && mode === "broadcast") setMessage("");
      } else {
        setFeedback({ ok: false, msg: res.ok ? "תגובה לא צפויה מהשרת." : `שגיאה ${res.status}` });
      }
      setPending(null);
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : "שגיאת רשת." });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {feedback && (
        <p
          style={{
            marginBottom: "10px",
            padding: "8px 12px",
            borderRadius: "6px",
            fontWeight: "bold",
            backgroundColor: feedback.ok ? "#e8f5e9" : "#ffebee",
            color: feedback.ok ? "#1b5e20" : "#b71c1c",
          }}
          role={feedback.ok ? "status" : "alert"}
        >
          {feedback.msg}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void requestPreview("broadcast");
        }}
      >
        <div className="form-group">
          <label htmlFor={messageId}>תוכן ההודעה</label>
          <textarea
            id={messageId}
            name="message"
            placeholder="הקלידו הודעה כאן..."
            required
            disabled={busy}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{ height: "100px" }}
            aria-describedby={counterId}
          />
        </div>
        {/* aria-live: the segment count is the number that decides what a
            broadcast costs, and it changes as the message is typed. */}
        <div id={counterId} className="sms-counter" data-level={level} aria-live="polite">
          <span>{units} תווים</span>
          <span>
            כולל קישור הסרה: ~{totalUnits} תווים · ~{totalSegments} מקטעי SMS לנמען
          </span>
        </div>
        {/* A radio group needs a group label, not just two field labels. The
            options sit in their own flex row: a <legend> inside a flex
            container lays out inconsistently across browsers. */}
        <fieldset className="audience-group">
          <legend>קהל היעד</legend>
          <div className="audience-options">
          <label>
            <input
              type="radio"
              name="audience"
              value="all"
              checked={audience === "all"}
              onChange={() => setAudience("all")}
              disabled={busy}
            />
            כל הפעילים ({activeCount})
          </label>
          <label>
            <input
              type="radio"
              name="audience"
              value="new_only"
              checked={audience === "new_only"}
              onChange={() => setAudience("new_only")}
              disabled={busy || newCount === 0}
            />
            רק חדשים שטרם קיבלו הודעה ({newCount})
          </label>
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={busy || message.trim() === "" || recipients === 0}
          style={{ width: "auto", minWidth: "14rem", marginTop: "14px" }}
        >
          {previewing === "broadcast" ? "מכין תצוגה..." : `🚀 המשך לשליחה ל-${recipients} לקוחות`}
        </button>

        {/* Test send: its own number, so a rehearsal never depends on the
            audience selection above. Not a nested form (HTML forbids that) —
            the button goes through the same preview step. */}
        <div className="sms-test-row">
          <div className="form-group" style={{ margin: 0, flex: "1 1 12rem" }}>
            <label htmlFor={testPhoneId}>שליחת בדיקה למספר</label>
            <input
              id={testPhoneId}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder="0501234567"
              value={testPhone}
              disabled={busy}
              onChange={(e) => setTestPhone(e.target.value)}
              style={{ margin: 0 }}
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void requestPreview("test")}
            disabled={busy || message.trim() === "" || testPhone.trim() === ""}
            style={{ width: "auto", flex: "0 1 11rem" }}
          >
            {previewing === "test" ? (
              "מכין תצוגה..."
            ) : (
              <>
                <span aria-hidden="true">📱 </span>בדיקה
              </>
            )}
          </button>
        </div>
        <p className="sms-test-hint">
          הודעת הבדיקה זהה לחלוטין להודעה שהלקוחות יקבלו, כולל קישור ההסרה.
        </p>
      </form>

      {pending && (
        <SmsPreviewDialog
          preview={pending.preview}
          sending={sending}
          onConfirm={() => void confirmSend()}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
