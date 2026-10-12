import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { getAppSecret } from "@/lib/security";
import { resolveAppBaseUrl, publishSmsTask } from "@/lib/qstash";
import { issueMonthlyGifts } from "@/lib/gifts";
import { purgeStalePhoneVerifications } from "@/lib/phone-verification";
import { birthdaySms, anniversarySms } from "@/lib/sms-messages";

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  return handleCron(req);
}

export async function POST(req: NextRequest) {
  return handleCron(req);
}

async function handleCron(req: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  const authHeader = req.headers.get("Authorization");
  const secretParam = req.nextUrl.searchParams.get("secret");
  if (authHeader !== `Bearer ${CRON_SECRET}` && secretParam !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await initDb();
  const db = getDb();
  // Issue this month's gifts FIRST — gift existence must never depend on
  // QStash being configured or reachable.
  const { birthday, anniversary } = await issueMonthlyGifts(db);
  // Housekeeping, never allowed to fail the run: expired verification rows are
  // dead weight once both the code and its send window have aged out.
  try {
    await purgeStalePhoneVerifications(db);
  } catch (e) {
    console.error("Failed to purge stale phone verifications:", e);
  }
  if (db.type === "sqlite") db.conn.close();

  const baseUrl = resolveAppBaseUrl(req.nextUrl.origin);
  const targetEndpoint = `${baseUrl}/api/send_sms_task`;
  const secret = getAppSecret();
  let birthdayQueued = 0;
  let anniversaryQueued = 0;

  if (QSTASH_TOKEN && baseUrl) {
    for (const [phone, name] of birthday) {
      const r = await publishSmsTask({
        targetEndpoint,
        phone,
        message: birthdaySms(name),
        secret,
        token: QSTASH_TOKEN,
        timeoutMs: 5000,
        kind: "birthday",
      });
      if (r.ok) birthdayQueued += 1;
      else console.error("Failed to queue birthday sms for", phone, r.error);
    }
    for (const [phone, name] of anniversary) {
      const r = await publishSmsTask({
        targetEndpoint,
        phone,
        message: anniversarySms(name),
        secret,
        token: QSTASH_TOKEN,
        timeoutMs: 5000,
        kind: "birthday",
      });
      if (r.ok) anniversaryQueued += 1;
      else console.error("Failed to queue anniversary sms for", phone, r.error);
    }
  }

  return NextResponse.json({
    status: "success",
    birthdays: { found: birthday.length, queued: birthdayQueued },
    anniversaries: { found: anniversary.length, queued: anniversaryQueued },
  });
}
