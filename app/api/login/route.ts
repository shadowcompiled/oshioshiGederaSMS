import { NextRequest, NextResponse } from "next/server";
import { attachSessionCookie } from "@/lib/auth";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = checkRateLimit(ip, "login", LIMITS.login.max);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }

  let password = "";
  try {
    const form = await req.formData();
    password = (form.get("password") as string) ?? "";
  } catch {
    const body = await req.json().catch(() => ({}));
    password = (body as { password?: string }).password ?? "";
  }

  if (password === ADMIN_PASSWORD) {
    const res = NextResponse.json({ ok: true });
    await attachSessionCookie(res);
    return res;
  }

  return NextResponse.json({ ok: false, error: "wrong" }, { status: 401 });
}
