import { SignJWT, jwtVerify } from "jose";

export const COOKIE_NAME = "admin_session";
export const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function getSecret(): Uint8Array {
  const secret = process.env.SECRET_KEY;
  if (!secret || secret === "CHANGE_THIS_TO_A_LONG_RANDOM_STRING") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SECRET_KEY must be set in production");
    }
    return new TextEncoder().encode("dev-secret-key");
  }
  return new TextEncoder().encode(secret);
}

export function getCookieOptions(): { httpOnly: boolean; secure: boolean; sameSite: "lax"; maxAge: number; path: string } {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  };
}

export type SessionRole = "admin" | "waiter";

export async function createSessionJwt(role: SessionRole = "admin"): Promise<string> {
  // `admin: true` kept on admin tokens for backward compatibility with
  // sessions issued before roles existed.
  const claims: Record<string, unknown> = role === "admin" ? { role, admin: true } : { role };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());
  return token;
}

/** Role carried by a session token, or null when missing/invalid/expired. */
export async function getTokenRole(token: string): Promise<SessionRole | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.role === "waiter") return "waiter";
    if (payload.role === "admin" || payload.admin === true) return "admin";
    return null;
  } catch {
    return null;
  }
}

/** Admin-only check — every existing admin surface gates on this. */
export async function verifySessionToken(token: string): Promise<boolean> {
  return (await getTokenRole(token)) === "admin";
}

/**
 * Role and expiry of a session token, or null when missing/invalid/expired.
 * The expiry is exposed so the middleware can slide the window only when the
 * token is actually getting old, rather than re-signing on every page view.
 */
export async function readSession(
  token: string
): Promise<{ role: SessionRole; expiresAt: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const role: SessionRole | null =
      payload.role === "waiter"
        ? "waiter"
        : payload.role === "admin" || payload.admin === true
          ? "admin"
          : null;
    if (!role) return null;
    // exp is in seconds since the epoch; absent means we cannot tell, so treat
    // it as due for a refresh rather than assuming it has ages left.
    const exp = typeof payload.exp === "number" ? payload.exp : 0;
    return { role, expiresAt: exp * 1000 };
  } catch {
    return null;
  }
}

/**
 * Whether a session is far enough through its life to be worth re-issuing.
 * Half the window: frequent enough that anyone using the system regularly is
 * never logged out, rare enough that we are not signing a JWT per request.
 */
export function isDueForRefresh(expiresAt: number, now: number = Date.now()): boolean {
  return expiresAt - now < (MAX_AGE * 1000) / 2;
}

/**
 * Where to send someone after they log in.
 *
 * Only same-site, absolute-path destinations are allowed. Anything else — a
 * full URL, a protocol-relative "//evil.example", a backslash some browsers
 * normalise to a slash — returns null, because this value arrives in a query
 * string and would otherwise be an open redirect: a link to our own login page
 * that lands the operator on someone else's site with a session freshly minted.
 */
export function safeReturnPath(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  const value = next.trim();
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\") || value.includes("://")) return null;
  // Control characters have no business in a Location header. Checked by
  // code point rather than a regex literal, so no raw control byte ever
  // has to live in this source file.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return value;
}
