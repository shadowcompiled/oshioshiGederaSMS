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
 * Base62 rather than hex. This token rides in every marketing SMS, where each
 * character is paid for in message segments, so the alphabet is chosen to carry
 * the most entropy per character: base62 gives 5.95 bits against hex's 4, which
 * is 47 bits in eight characters where hex would manage only 32.
 */
const TOKEN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN_LENGTH = 8;

/**
 * Short unsubscribe token: 8 base62 characters (~2^47.6) of HMAC over the
 * phone, keyed by the app secret.
 *
 * This is deliberately weaker than the 128-bit token it replaces, bought in
 * exchange for 24 characters of every SMS. It holds up because guessing is
 * online-only — there is no oracle to attack offline, each number has exactly
 * one valid token, and /api/unsubscribe/confirm is rate limited — and because
 * the worst a forged token achieves is unsubscribing one member, which is
 * reversible from the admin screen.
 */
function shortToken(phone: string): string {
  // Fold the first 8 HMAC bytes into base62. Reducing 64 bits into 62^8 biases
  // the result by under 2^-16, which is far below anything an online guessing
  // attack could exploit.
  const digest = createHmac("sha256", getSecret()).update(phone).digest();
  let n = BigInt("0x" + digest.subarray(0, 8).toString("hex"));
  const base = BigInt(TOKEN_ALPHABET.length);
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out = TOKEN_ALPHABET[Number(n % base)] + out;
    n /= base;
  }
  return out;
}

export function generateSecureToken(phone: string): string {
  return shortToken(phone);
}

/**
 * The 128-bit hex token this scheme replaced. Still accepted, because every
 * link already sitting in a customer's SMS inbox carries one, and those stay
 * clickable for as long as the message does.
 */
function hex128Token(phone: string): string {
  return createHmac("sha256", getSecret()).update(phone).digest("hex").slice(0, 32);
}

/** Legacy 64-bit token (kept only so unsubscribe links in already-sent SMS still verify). */
function legacySecureToken(phone: string): string {
  const data = `${phone}:${getSecret()}`;
  return createHmac("sha256", getSecret()).update(data).digest("hex").slice(0, 16);
}

export function verifyToken(phone: string, token: string): boolean {
  const candidates = [shortToken(phone), hex128Token(phone), legacySecureToken(phone)];
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
