import { NextRequest, NextResponse } from "next/server";
import { getDb, queryCustomers } from "@/lib/db";
import { getAppSecret } from "@/lib/security";

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

  const now = new Date();
  const currentMonth = now.getMonth() + 1;

  const db = getDb();
  const activeCondition = db.type === "postgres" ? "WHERE active = TRUE" : "WHERE active = 1";
  const rows = await queryCustomers(
    db,
    `SELECT phone, name, date_of_birth FROM customers ${activeCondition}`,
    []
  );
  if (db.type === "sqlite") db.conn.close();

  const birthdaysFound: [string, string][] = [];
  for (const row of rows) {
    const dobStr = row.date_of_birth as string;
    if (!dobStr) continue;
    try {
      const dobDate = new Date(dobStr);
      if (dobDate.getMonth() + 1 === currentMonth) {
        birthdaysFound.push([String(row.phone), String(row.name ?? "")]);
      }
    } catch {
      // skip invalid date
    }
  }

  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin;
  const targetEndpoint = `${baseUrl}/api/send_sms_task`;
  const secret = getAppSecret();
  let sentCount = 0;

  if (QSTASH_TOKEN) {
    for (const [phone, name] of birthdaysFound) {
      const msg = `היי ${name}, חוגג/ת יום הולדת החודש? 🎂\nמזל טוב! מחכה לך הטבה מיוחדת ב-Sushi VIP. בואו לחגוג איתנו! 🍣`;
      try {
        await fetch(`https://qstash.upstash.io/v2/publish/${targetEndpoint}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${QSTASH_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ phone, message: msg, secret }),
          signal: AbortSignal.timeout(5000),
        });
        sentCount += 1;
      } catch (e) {
        console.error("Failed to queue birthday sms for", phone, e);
      }
    }
  }

  return NextResponse.json({
    status: "success",
    month: currentMonth,
    found: birthdaysFound.length,
    queued: sentCount,
  });
}
