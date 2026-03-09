import { NextRequest, NextResponse } from "next/server";
import { setAdminSession, attachSessionCookie } from "@/lib/auth";
import { getClientIp } from "@/lib/get-ip";
import { checkRateLimit, LIMITS } from "@/lib/ratelimit";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

export async function POST(req: NextRequest) {
  const ip = await getClientIp();
  const { ok } = checkRateLimit(ip, "login", LIMITS.login.max);
  if (!ok) {
    return NextResponse.redirect(new URL("/login?error=rate", req.url), 303);
  }

  const form = await req.formData();
  const password = (form.get("password") as string) ?? "";

  if (password === ADMIN_PASSWORD) {
    await setAdminSession();
    const adminUrl = new URL("/admin", req.url);
    const res = NextResponse.redirect(adminUrl, 302);
    await attachSessionCookie(res);
    return res;
  }

  return NextResponse.redirect(new URL("/login?error=wrong", req.url), 303);
}
