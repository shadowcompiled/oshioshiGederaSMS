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

/**
 * The opt-out token that goes in every SMS.
 *
 * 96 bits of the same HMAC, written in base64url instead of hex: 16 characters
 * rather than 32, for the same job. Length matters here in a way it rarely
 * does — this token is printed inside a link in every promotional message, and
 * SMS is billed by the character.
 *
 * 96 bits is far past what this guards. The token only stops one person
 * unsubscribing another, guessing is an online attack against a rate-limited
 * endpoint, and the prize for winning is removing someone from a restaurant
 * mailing list.
 */
export function generateSecureToken(phone: string): string {
  return createHmac("sha256", getSecret()).update(phone).digest("base64url").slice(0, 16);
}

/** The 128-bit hex token, still honoured: links in already-sent SMS use it. */
function hexSecureToken(phone: string): string {
  return createHmac("sha256", getSecret()).update(phone).digest("hex").slice(0, 32);
}

/** Legacy 64-bit token (kept only so unsubscribe links in already-sent SMS still verify). */
function legacySecureToken(phone: string): string {
  const data = `${phone}:${getSecret()}`;
  return createHmac("sha256", getSecret()).update(data).digest("hex").slice(0, 16);
}

/**
 * Accepts every token form we have ever issued. An opt-out link must keep
 * working for as long as the message holding it exists on someone's phone —
 * a customer who saved an SMS from last year and taps "remove me" must not be
 * met with a redirect to the signup page.
 */
export function verifyToken(phone: string, token: string): boolean {
  const candidates = [generateSecureToken(phone), hexSecureToken(phone), legacySecureToken(phone)];
  return candidates.some((expected) => {
    if (expected.length !== token.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(token, "utf8"));
    } catch {
      return false;
    }
  });
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
