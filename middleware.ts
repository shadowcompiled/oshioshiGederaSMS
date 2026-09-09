import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  COOKIE_NAME,
  createSessionJwt,
  getCookieOptions,
  isDueForRefresh,
  readSession,
} from "@/lib/session-jwt";

/** Pages whose session should slide forward as they are used. */
const SESSION_PATHS = ["/admin", "/waiter"];

/**
 * Keep an in-use session alive.
 *
 * The cookie carries a 7-day expiry, but nothing was extending it. The only
 * place that re-issued it was lib/auth.getSessionRole(), which runs during a
 * Server Component render — where Next.js forbids setting cookies, so the
 * write threw and was swallowed by its own catch. Reading pages therefore
 * never refreshed the session, and an owner who only browsed the customer
 * list was logged out exactly 7 days after their last write action. The page
 * on screen still looked fine, because it was a stale render, until the next
 * navigation bounced them to /login.
 *
 * Middleware is allowed to set cookies, so the refresh belongs here — and
 * only once the token is past halfway through its life, to avoid signing a
 * JWT on every request.
 */
async function refreshSession(req: NextRequest, res: NextResponse): Promise<void> {
  const path = req.nextUrl.pathname;
  if (!SESSION_PATHS.some((p) => path === p || path.startsWith(p + "/"))) return;

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return;
  const session = await readSession(token);
  if (!session || !isDueForRefresh(session.expiresAt)) return;
  try {
    res.cookies.set(COOKIE_NAME, await createSessionJwt(session.role), getCookieOptions());
  } catch {
    // A failed refresh must never block the page: the token they arrived with
    // is still valid, so they simply keep the session they had.
  }
}

export async function middleware(req: NextRequest) {
  if (req.method === "POST" && req.nextUrl.pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/api/login";
    return NextResponse.rewrite(url);
  }

  const res = NextResponse.next();
  await refreshSession(req, res);
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
