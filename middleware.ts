import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, getCookieOptions, verifySessionToken } from "@/lib/session-jwt";

export async function middleware(req: NextRequest) {
  if (req.method === "POST" && req.nextUrl.pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/api/login";
    return NextResponse.rewrite(url);
  }

  if (req.method === "GET" && req.nextUrl.pathname === "/admin") {
    const hasCookie = req.cookies.get(COOKIE_NAME)?.value;
    const sessionToken = req.nextUrl.searchParams.get("session");
    if (!hasCookie && sessionToken) {
      const valid = await verifySessionToken(sessionToken);
      if (valid) {
        const url = new URL("/admin", req.url);
        url.searchParams.delete("session");
        const res = NextResponse.redirect(url, 302);
        res.cookies.set(COOKIE_NAME, sessionToken, getCookieOptions());
        return res;
      }
      return NextResponse.redirect(new URL("/login", req.url), 302);
    }
  }

  const res = NextResponse.next();
  if (process.env.NODE_ENV === "production") {
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("X-Frame-Options", "DENY");
    res.headers.set("X-XSS-Protection", "1; mode=block");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp)$).*)"],
};
