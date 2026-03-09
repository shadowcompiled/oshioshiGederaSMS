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

const IMPORT_TOKEN_PREFIX = "import:";
const IMPORT_WINDOW_SECONDS = 300; // 5 minutes

export function createImportToken(): string {
  const window = Math.floor(Date.now() / (IMPORT_WINDOW_SECONDS * 1000));
  const payload = `${IMPORT_TOKEN_PREFIX}${window}`;
  const sig = createHmac("sha256", getSecret()).update(payload).digest("hex");
  return `${payload}:${sig}`;
}

export function verifyImportToken(token: string | null): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.trim().split(":");
  if (parts.length < 3) return false;
  const window = parseInt(parts[1], 10);
  if (Number.isNaN(window)) return false;
  const sig = parts.slice(2).join(":");
  const payload = `${IMPORT_TOKEN_PREFIX}${window}`;
  const expected = createHmac("sha256", getSecret()).update(payload).digest("hex");
  if (expected.length !== sig.length) return false;
  try {
    if (timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"))) return true;
  } catch {
    return false;
  }
  const prevPayload = `${IMPORT_TOKEN_PREFIX}${window - 1}`;
  const prevExpected = createHmac("sha256", getSecret()).update(prevPayload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(prevExpected, "utf8"), Buffer.from(sig, "utf8"));
  } catch {
    return false;
  }
}
