import { formatPhone, isValidPhone } from "@/lib/validation";

/**
 * Who a test send goes to.
 *
 * Shared by /api/admin/send-test and /api/admin/sms-preview so the two cannot
 * disagree: a set of numbers the preview approves is exactly a set the send
 * will accept — same validation, same cap, same de-duplication. (This lives
 * here rather than in the route because a Next route module may only export
 * request handlers.)
 */

/**
 * How many numbers one test may reach. The test endpoint bypasses the QStash
 * queue and sends inline, so it stays a rehearsal tool rather than a second
 * broadcast path — but more than one handset at a time is genuinely useful:
 * iPhone and Android lay out Hebrew and long links differently, and the owner
 * often wants someone else to proofread the wording.
 */
export const MAX_TEST_RECIPIENTS = 4;

export type TestRecipients =
  | { ok: true; phones: string[] }
  | { ok: false; error: string };

/**
 * Normalise to the app's canonical +972… form, validate, and de-duplicate.
 *
 * De-duplication matters because the numbers come from a saved list the
 * operator ticks plus a free-typed box: the same person reachable twice must
 * not be texted twice. One bad number rejects the whole set rather than
 * sending to the rest — a partial send would leave the operator believing
 * every handset had been checked when one never got the message.
 */
export function parseTestRecipients(input: {
  phones?: unknown;
  phone?: unknown;
}): TestRecipients {
  const raw: string[] = Array.isArray(input.phones)
    ? input.phones.map((p) => String(p ?? ""))
    : input.phone != null
      ? [String(input.phone)]
      : [];

  const seen = new Set<string>();
  const phones: string[] = [];
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const phone = formatPhone(trimmed);
    if (!isValidPhone(phone)) {
      return {
        ok: false,
        error: `מספר טלפון לא תקין: "${trimmed}". נא להזין מספר מלא (למשל 0501234567).`,
      };
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }

  if (phones.length === 0) return { ok: false, error: "לא נבחרו מספרים לבדיקה." };
  if (phones.length > MAX_TEST_RECIPIENTS) {
    return {
      ok: false,
      error: `ניתן לשלוח בדיקה לעד ${MAX_TEST_RECIPIENTS} מספרים בכל פעם.`,
    };
  }
  return { ok: true, phones };
}
