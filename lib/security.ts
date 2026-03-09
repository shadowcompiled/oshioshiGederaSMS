import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const secret = process.env.SECRET_KEY;
  if (!secret || secret === "CHANGE_THIS_TO_A_LONG_RANDOM_STRING") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SECRET_KEY must be set in production");
    }
    return "dev-secret-key";
  }
  return secret;
}

export function generateSecureToken(phone: string): string {
  const data = `${phone}:${getSecret()}`;
  return createHmac("sha256", getSecret()).update(data).digest("hex").slice(0, 16);
}

export function verifyToken(phone: string, token: string): boolean {
  const expected = generateSecureToken(phone);
  if (expected.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(token, "utf8"));
  } catch {
    return false;
  }
}

export function getAppSecret(): string {
  return getSecret();
}
