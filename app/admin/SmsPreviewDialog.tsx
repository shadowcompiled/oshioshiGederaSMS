"use client";

import { useEffect, useId, useRef } from "react";

/**
 * The confirmation step for anything that sends an SMS.
 *
 * It renders what /api/admin/sms-preview returned — the *actual* message text
 * produced by the server's renderer, not a client-side guess — so the operator
 * approves the thing that ships, footer and opt-out link included. Nothing is
 * recomputed here; this component only displays and asks.
 */

export type SmsPreview = {
  text: string;
  units: number;
  segments: number;
  unsubLink: string;
  /** True when the text is byte-exact for this recipient (a test send). */
  exactRecipient: boolean;
  recipient: string | null;
  audience: {
    mode: "test" | "all" | "new_only";
    recipients: number;
    totalSegments: number;
  };
  sender: {
    provider: string;
    environment: "test" | "development" | "preview" | "production";
    senderName: string;
    delivers: boolean;
    canReceiveReplies: boolean;
  };
  notes: { level: "info" | "warn" | "error"; text: string }[];
  /** A reason the send cannot proceed. When set, confirming is disabled. */
  blocking: string | null;
};

type Props = {
  preview: SmsPreview;
  sending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const AUDIENCE_LABEL: Record<SmsPreview["audience"]["mode"], string> = {
  test: "הודעת בדיקה",
  all: "כל הלקוחות הפעילים",
  new_only: "לקוחות שטרם קיבלו הודעה",
};

export default function SmsPreviewDialog({ preview, sending, onConfirm, onCancel }: Props) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Whatever had focus when the dialog opened gets it back on close, so
  // keyboard users are not dropped at the top of the page.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const isTest = preview.audience.mode === "test";
  const blocked = preview.blocking !== null;

  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => returnFocusTo.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !sending) {
        e.preventDefault();
        onCancel();
        return;
      }
      // A modal must not leak focus to the page behind it.
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, sending]);

  // Name it precisely: an alphanumeric sender id if one is set, the SIM number
  // for the Android gateway (whose number the app never sees), and nothing at
  // all under the mock — where claiming a sender would be a fiction.
  const senderLabel =
    preview.sender.senderName ||
    (preview.sender.provider === "mock" ? "—" : "מספר השולח המוגדר");

  return (
    <div
      className="sms-preview-overlay"
      // A click on the backdrop is a cancel, but not mid-send.
      onClick={() => !sending && onCancel()}
    >
      <div
        className="sms-preview-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="sms-preview-title">
          {isTest ? "תצוגה מקדימה — הודעת בדיקה" : "תצוגה מקדימה לפני שליחה"}
        </h3>

        <p className="sms-preview-to">
          {isTest ? (
            <>
              אל <strong dir="ltr">{preview.recipient}</strong>
            </>
          ) : (
            <>
              אל <strong>{preview.audience.recipients}</strong> נמענים ·{" "}
              {AUDIENCE_LABEL[preview.audience.mode]}
            </>
          )}
        </p>

        {/* The message as the phone will show it: the operator's text plus the
            opt-out footer the server appends. */}
        <div className="sms-preview-bubble" dir="auto">
          {preview.text}
        </div>

        {!preview.exactRecipient && (
          <p className="sms-preview-hint">
            קישור ההסרה בתצוגה הוא לדוגמה — בהודעה עצמה כל נמען מקבל קישור עם המספר שלו, באותו אורך.
          </p>
        )}

        <dl className="sms-preview-facts">
          <div>
            <dt>תווים</dt>
            <dd>{preview.units}</dd>
          </div>
          <div>
            <dt>הודעות לחיוב לנמען</dt>
            <dd>{preview.segments}</dd>
          </div>
          {!isTest && (
            <div>
              <dt>סה"כ הודעות</dt>
              <dd>{preview.audience.totalSegments}</dd>
            </div>
          )}
          <div>
            <dt>נשלח מ</dt>
            <dd>{senderLabel}</dd>
          </div>
          <div>
            <dt>ספק</dt>
            <dd>{preview.sender.provider}</dd>
          </div>
        </dl>

        {preview.notes.map((note, i) => (
          <p key={i} className="sms-preview-note" data-level={note.level}>
            {note.text}
          </p>
        ))}

        {blocked && (
          <p className="sms-preview-note" data-level="error" role="alert">
            {preview.blocking}
          </p>
        )}

        <div className="sms-preview-actions">
          <button
            type="button"
            ref={confirmRef}
            onClick={onConfirm}
            disabled={sending || blocked}
            style={{ width: "auto", flex: "1 1 12rem" }}
          >
            {sending
              ? "שולח..."
              : isTest
                ? "שלח בדיקה"
                : `אישור ושליחה ל-${preview.audience.recipients}`}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={sending}
            style={{ width: "auto", flex: "0 1 9rem" }}
          >
            חזרה לעריכה
          </button>
        </div>
      </div>
    </div>
  );
}
