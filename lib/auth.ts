import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  COOKIE_NAME,
  createSessionJwt,
  verifySessionToken,
  getCookieOptions,
} from "./session-jwt";

export async function setAdminSession(): Promise<void> {
  const token = await createSessionJwt();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, getCookieOptions());
}

export async function getAdminSession(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return false;
    const valid = await verifySessionToken(token);
    if (!valid) return false;
    try {
      await setAdminSession();
    } catch {
      // Cookie refresh failed; token is still valid, allow access
    }
    return true;
  } catch {
    return false;
  }
}

/** Call this on any admin API response (redirect or file) so the browser keeps the session. */
export async function attachSessionCookie(res: NextResponse): Promise<NextResponse> {
  const token = await createSessionJwt();
  res.cookies.set(COOKIE_NAME, token, getCookieOptions());
  return res;
}

export async function clearAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
