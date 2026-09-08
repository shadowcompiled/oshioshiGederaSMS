"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  smsUnits,
  billedMessagesForUnits,
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
 *
 * There is one audience: every active member. The old "only those who have
 * never received a message" cohort is gone.
 */

type Props = {
  importToken: string;
  activeCount: number;
  footerKeyword: string;
  canReceiveReplies: boolean;
  appBaseUrl: string;
};

type Mode = "broadcast" | "test";

/** A saved test recipient. Kept per browser — see loadPeople below. */
type Person = { id: string; name: string; phone: string };

/** Mirrors MAX_TEST_RECIPIENTS in app/api/admin/send-test/route.ts. */
const MAX_TEST_RECIPIENTS = 4;

const PEOPLE_KEY = "oshi-admin-test-people";
const LEGACY_PHONE_KEY = "oshi-admin-test-phone";

/**
 * The test list lives in localStorage rather than the database on purpose:
 * these are the owner's own handsets and the people they ask to proofread, not
 * club members, and they have no business in the customers table.
 */
function loadPeople(): Person[] {
  try {
    const raw = window.localStorage.getItem(PEOPLE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (p): p is Person =>
              !!p && typeof p === "object" && typeof (p as Person).phone === "string"
          )
          .map((p) => ({
            id: String(p.id ?? p.phone),
            name: String(p.name ?? ""),
            phone: String(p.phone),
          }));
      }
    }
    // Carry over the single number the previous version remembered, so the
    // first visit after this change is not an empty list.
    const legacy = window.localStorage.getItem(LEGACY_PHONE_KEY);
    if (legacy) return [{ id: legacy, name: "", phone: legacy }];
  } catch {
    // Private mode / blocked storage: start empty, everything still works.
  }
  return [];
}

export default function BroadcastForm({
  importToken,
  activeCount,
  footerKeyword,
  canReceiveReplies,
  appBaseUrl,
}: Props) {
  const ids = useId();
  const messageId = `${ids}-message`;
  const counterId = `${ids}-counter`;
  const nameId = `${ids}-name`;
  const phoneId = `${ids}-phone`;

  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState<Mode | null>(null);
  const [pending, setPending] = useState<{ mode: Mode; preview: SmsPreview } | null>(null);

  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");

  // Read storage after mount: it does not exist during prerender, and the
  // server could not know what it holds anyway.
  useEffect(() => {
    const loaded = loadPeople();
    setPeople(loaded);
    // Pre-tick the first saved entry — usually the owner's own phone.
    if (loaded.length > 0) setSelected([loaded[0].id]);
  }, []);

  function persist(next: Person[]) {
    setPeople(next);
    try {
      window.localStorage.setItem(PEOPLE_KEY, JSON.stringify(next));
    } catch {
      // Not worth surfacing: the list still works for this session.
    }
  }

  const footerUnits = useMemo(
    () => estimateUnsubFooterUnits(footerKeyword, appBaseUrl || undefined, canReceiveReplies),
    [footerKeyword, appBaseUrl, canReceiveReplies]
  );
  const units = smsUnits(message);
  const totalUnits = units === 0 ? 0 : units + footerUnits;
  const totalMessages = billedMessagesForUnits(totalUnits);
  const level = totalMessages >= 3 ? "high" : totalMessages >= 2 ? "warn" : "ok";
  const busy = sending || previewing !== null;

  /**
   * Who this test goes to: the ticked saved people, plus a number typed into
   * the add row but not saved — so a one-off check does not force a saved
   * entry that then has to be cleaned up again.
   */
  const testPhones = useMemo(() => {
    const chosen = people.filter((p) => selected.includes(p.id)).map((p) => p.phone);
    const typed = draftPhone.trim();
    return typed ? [...chosen, typed] : chosen;
  }, [people, selected, draftPhone]);

  const overCap = testPhones.length > MAX_TEST_RECIPIENTS;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function savePerson() {
    const phone = draftPhone.trim();
    if (!phone) return;
    const id = `${Date.now()}-${phone}`;
    persist([...people, { id, name: draftName.trim(), phone }]);
    setSelected((prev) => [...prev, id]);
    setDraftName("");
    setDraftPhone("");
  }

  function removePerson(id: string) {
    persist(people.filter((p) => p.id !== id));
    setSelected((prev) => prev.filter((x) => x !== id));
  }

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
          mode,
          phones: mode === "test" ? testPhones : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok !== true || !data.preview) {
        setFeedback({ ok: false, msg: data.msg ?? `שגיאה ${res.status} בהפקת התצוגה המקדימה.` });
        return;
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
          body: JSON.stringify({ import_token: importToken, phones: testPhones, message }),
        });
      } else {
        const formData = new FormData();
        formData.set("message", message);
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
        {/* aria-live: the billed-message count is the number that decides what
            a broadcast costs, and it changes as the message is typed. */}
        <div id={counterId} className="sms-counter" data-level={level} aria-live="polite">
          <span>{units} תווים</span>
          <span>
            כולל קישור הסרה: ~{totalUnits} תווים · ~{totalMessages} הודעות לחיוב לנמען
          </span>
        </div>

        <button
          type="submit"
          disabled={busy || message.trim() === "" || activeCount === 0}
          style={{ width: "auto", minWidth: "14rem", marginTop: "14px" }}
        >
          {previewing === "broadcast" ? "מכין תצוגה..." : `🚀 המשך לשליחה ל-${activeCount} לקוחות`}
        </button>

        {/* Test send: its own recipients, so a rehearsal never touches the
            club. Not a nested form (HTML forbids that) — the button goes
            through the same preview step as the broadcast. */}
        <div className="test-panel">
          <p className="test-panel-title">שליחת בדיקה</p>

          {people.length > 0 && (
            <ul className="test-people">
              {people.map((p) => (
                <li key={p.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      disabled={busy}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="test-person-name">{p.name || "ללא שם"}</span>
                    <bdi className="test-person-phone">{p.phone}</bdi>
                  </label>
                  <button
                    type="button"
                    className="test-person-remove"
                    disabled={busy}
                    onClick={() => removePerson(p.id)}
                    // The label repeats down the list, so a screen reader needs
                    // to know which entry this particular button removes.
                    aria-label={`מחיקת ${p.name || p.phone} מרשימת הבדיקה`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="test-add-row">
            <div className="form-group" style={{ margin: 0, flex: "1 1 8rem" }}>
              <label htmlFor={nameId}>שם (לא חובה)</label>
              <input
                id={nameId}
                type="text"
                maxLength={40}
                placeholder="אושר"
                value={draftName}
                disabled={busy}
                onChange={(e) => setDraftName(e.target.value)}
                style={{ margin: 0 }}
              />
            </div>
            <div className="form-group" style={{ margin: 0, flex: "1 1 9rem" }}>
              <label htmlFor={phoneId}>מספר</label>
              <input
                id={phoneId}
                type="tel"
                className="input-ltr"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                placeholder="0501234567"
                value={draftPhone}
                disabled={busy}
                onChange={(e) => setDraftPhone(e.target.value)}
                style={{ margin: 0 }}
              />
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={savePerson}
              disabled={busy || draftPhone.trim() === ""}
              style={{ width: "auto", flex: "0 1 7rem" }}
            >
              <span aria-hidden="true">💾 </span>שמירה
            </button>
          </div>

          <div className="test-send-row">
            <button
              type="button"
              onClick={() => void requestPreview("test")}
              disabled={busy || message.trim() === "" || testPhones.length === 0 || overCap}
              style={{ width: "auto", flex: "0 1 13rem" }}
            >
              {previewing === "test" ? "מכין תצוגה..." : `📱 בדיקה ל-${testPhones.length} מספרים`}
            </button>
            <p className="sms-test-hint" role={overCap ? "alert" : undefined}>
              {overCap
                ? `נבחרו ${testPhones.length} מספרים — ניתן לשלוח בדיקה לעד ${MAX_TEST_RECIPIENTS} בכל פעם.`
                : "הודעת הבדיקה זהה לחלוטין להודעה שהלקוחות יקבלו, כולל קישור ההסרה. מספר שהוקלד ולא נשמר ייכלל גם הוא."}
            </p>
          </div>
        </div>
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
