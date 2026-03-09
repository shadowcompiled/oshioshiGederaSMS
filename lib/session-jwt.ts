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

export async function createSessionJwt(): Promise<string> {
  const token = await new SignJWT({ admin: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());
  return token;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}
