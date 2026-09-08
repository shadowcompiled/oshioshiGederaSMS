import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { verifyImportToken } from "@/lib/security";
import { initDb, getDb, queryCustomers } from "@/lib/db";
import { formatPhone, isValidPhone } from "@/lib/validation";
import { smsSendability } from "@/lib/sms";
import { renderBroadcastSms, PREVIEW_SAMPLE_PHONE } from "@/lib/sms-render";
import { smsUnits, segmentsForUnits } from "@/lib/sms-segments";

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

async function countAudience(onlyNew: boolean): Promise<number> {
  await initDb();
  const db = getDb();
  try {
    const activeClause = db.type === "postgres" ? "active = TRUE" : "active = 1";
    const whereClause = onlyNew ? `${activeClause} AND received_message_at IS NULL` : activeClause;
    const rows = await queryCustomers(db, `SELECT phone FROM customers WHERE ${whereClause}`, []);
    return rows.length;
  } finally {
    if (db.type === "sqlite") db.conn.close();
  }
}

export async function POST(req: NextRequest) {
  let body: { import_token?: string; message?: string; send_to?: string; mode?: string; phone?: string };
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
  const onlyNew = body.send_to === "new_only";

  // A test renders against the real destination, so its preview is byte-exact.
  // An audience preview has no single recipient, so it uses a stand-in number
  // of the same length — the link, and therefore the segment count, measures
  // true even though the digits are a placeholder.
  let recipientPhone = PREVIEW_SAMPLE_PHONE;
  if (isTest) {
    const phone = formatPhone((body.phone ?? "").trim());
    if (!isValidPhone(phone)) {
      return NextResponse.json(
        { ok: false, msg: "מספר טלפון לא תקין. נא להזין מספר מלא (למשל 0501234567)." },
        { status: 400 }
      );
    }
    recipientPhone = phone;
  }

  let recipients = 1;
  if (!isTest) {
    try {
      recipients = await countAudience(onlyNew);
    } catch (e) {
      console.error("SMS preview: audience count failed", e);
      return NextResponse.json({ ok: false, msg: "לא ניתן לספור את קהל היעד." }, { status: 500 });
    }
  }

  const rendered = renderBroadcastSms(message, recipientPhone, req.nextUrl.origin);
  const units = smsUnits(rendered.text);
  const segments = segmentsForUnits(units);
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
    blocking =
      blocking ??
      (onlyNew ? "אין לקוחות חדשים (שטרם קיבלו הודעה) לשליחה." : "אין לקוחות פעילים לשליחה.");
  }

  if (!isTest && !process.env.QSTASH_TOKEN) {
    blocking = blocking ?? "חסר QSTASH_TOKEN — לא ניתן להעמיד הודעות בתור השליחה.";
  }

  if (segments >= 3) {
    notes.push({
      level: segments >= 4 ? "error" : "warn",
      text: `ההודעה מתפצלת ל-${segments} מקטעי SMS ומחויבת כ-${segments} הודעות לכל נמען.`,
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
      exactRecipient: isTest,
      recipient: isTest ? recipientPhone : null,
      audience: {
        mode: isTest ? "test" : onlyNew ? "new_only" : "all",
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
