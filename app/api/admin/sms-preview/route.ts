import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { initDb, getDb, queryCustomers } from "@/lib/db";
import { parseTestRecipients } from "@/lib/test-recipients";
import { smsSendability } from "@/lib/sms";
import { renderBroadcastSms, PREVIEW_SAMPLE_PHONE } from "@/lib/sms-render";
import { smsUnits, billedMessagesForUnits } from "@/lib/sms-segments";

/**
 * "What exactly am I about to send, and to whom?" — answered without sending.
 *
 * This is a read-only endpoint: it renders the message through the very same
 * lib/sms-render.ts the QStash worker uses, counts the audience with the same
 * query /api/admin/broadcast uses, and asks lib/sms what the live provider
 * configuration would do. Nothing here writes to the database or touches a
 * vendor, so it is safe to call on every keystroke of a confirm dialog.
 *
 * The value of routing the preview through the real renderer is that a footer
 * change can never make the preview lie: there is only one template.
 */

const MAX_MESSAGE_LENGTH = 1000;

type Note = { level: "info" | "warn" | "error"; text: string };

async function countAudience(): Promise<number> {
  await initDb();
  const db = getDb();
  try {
    const activeClause = db.type === "postgres" ? "active = TRUE" : "active = 1";
    const rows = await queryCustomers(db, `SELECT phone FROM customers WHERE ${activeClause}`, []);
    return rows.length;
  } finally {
    if (db.type === "sqlite") db.conn.close();
  }
}

export async function POST(req: NextRequest) {
  let body: {
    import_token?: string;
    message?: string;
    mode?: string;
    /** Test mode: up to four numbers (see the send endpoint's cap). */
    phones?: unknown;
    phone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, msg: "בקשה לא תקינה." }, { status: 400 });
  }

  const sessionOk = await getAdminSession();
  const tokenOk = verifyImportToken(body.import_token ?? null);
  if (!sessionOk && !tokenOk) {
    return NextResponse.json(
      { ok: false, msg: "הפעולה נכשלה. נא לרענן את הדף ולנסות שוב." },
      { status: 403 }
    );
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ ok: false, msg: "אין תוכן להודעה." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { ok: false, msg: `ההודעה ארוכה מדי (עד ${MAX_MESSAGE_LENGTH} תווים).` },
      { status: 400 }
    );
  }

  const isTest = body.mode === "test";

  // A test renders against the real destination, so its preview is byte-exact.
  // An audience preview has no single recipient, so it uses a stand-in number
  // of the same length — the link, and therefore the segment count, measures
  // true even though the digits are a placeholder.
  let recipientPhone = PREVIEW_SAMPLE_PHONE;
  let testPhones: string[] = [];
  if (isTest) {
    // The very same parser the send endpoint uses, so a set the preview
    // approves is a set the send will accept — same validation, same cap, same
    // de-duplication.
    const parsed = parseTestRecipients({ phones: body.phones, phone: body.phone });
    if (!parsed.ok) return NextResponse.json({ ok: false, msg: parsed.error }, { status: 400 });
    testPhones = parsed.phones;
    recipientPhone = testPhones[0];
  }

  let recipients = testPhones.length;
  if (!isTest) {
    try {
      recipients = await countAudience();
    } catch (e) {
      console.error("SMS preview: audience count failed", e);
      return NextResponse.json({ ok: false, msg: "לא ניתן לספור את קהל היעד." }, { status: 500 });
    }
  }

  const rendered = renderBroadcastSms(message, recipientPhone, req.nextUrl.origin);
  const units = smsUnits(rendered.text);
  const segments = billedMessagesForUnits(units);
  const sender = smsSendability(recipientPhone);

  const notes: Note[] = [];
  let blocking: string | null = null;

  if (!sender.delivers) {
    if (sender.provider === "mock") {
      notes.push({
        level: "warn",
        text: "מצב הדגמה (mock): ההודעה תירשם ביומן השרת אך לא תישלח באמת לאף מספר.",
      });
    } else if (!sender.configured) {
      blocking = `שער ה-SMS "${sender.provider}" אינו מוגדר — חסרים פרטי התחברות. בדוק את משתני הסביבה.`;
    }
  }

  if (sender.refusal) {
    // The non-production allowlist guard. Better learned here than from a
    // send that appears to succeed and reaches nobody.
    blocking = blocking ?? sender.refusal;
  }

  if (!isTest && recipients === 0) {
    blocking = blocking ?? "אין לקוחות פעילים לשליחה.";
  }

  if (!isTest && !process.env.QSTASH_TOKEN) {
    blocking = blocking ?? "חסר QSTASH_TOKEN — לא ניתן להעמיד הודעות בתור השליחה.";
  }

  if (segments >= 2) {
    notes.push({
      level: segments >= 3 ? "error" : "warn",
      text: `ההודעה ארוכה ומחויבת כ-${segments} הודעות לכל נמען.`,
    });
  }

  if (!sender.canReceiveReplies) {
    notes.push({
      level: "info",
      text: sender.senderName
        ? `השולח "${sender.senderName}" הוא שם ולא מספר, ולכן אינו מקבל תשובות — ההסרה מוצעת בקישור בלבד.`
        : "השולח אינו מקבל תשובות — ההסרה מוצעת בקישור בלבד.",
    });
  }

  return NextResponse.json({
    ok: true,
    preview: {
      text: rendered.text,
      units,
      segments,
      unsubLink: rendered.unsubLink,
      // Exact for a single test recipient. With several, the body shown is
      // rendered for the first — the others differ only in their own opt-out
      // link, which is the same length.
      exactRecipient: isTest && testPhones.length === 1,
      recipient: isTest ? recipientPhone : null,
      recipients: testPhones,
      audience: {
        mode: isTest ? "test" : "all",
        recipients,
        totalSegments: recipients * segments,
      },
      sender: {
        provider: sender.provider,
        environment: sender.environment,
        senderName: sender.senderName,
        delivers: sender.delivers,
        canReceiveReplies: sender.canReceiveReplies,
      },
      notes,
      blocking,
    },
  });
}
