import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createSessionJwt,
  readSession,
  isDueForRefresh,
  safeReturnPath,
  MAX_AGE,
} from "@/lib/session-jwt";

/**
 * The session used to expire on people who were actively using the system.
 * lib/auth.getSessionRole() was the only place that re-issued the cookie, and
 * it runs during a Server Component render — where Next.js forbids setting
 * cookies, so the write threw and its own catch swallowed it. Browsing the
 * admin list therefore never extended the session, and the owner was logged
 * out 7 days after their last write action, mid-task. The refresh now happens
 * in middleware, which is allowed to set cookies; these cover the decisions it
 * makes.
 */

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.SECRET_KEY = "session-refresh-test-secret";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("readSession", () => {
  it("returns the role and an expiry a week out", async () => {
    const token = await createSessionJwt("admin");
    const session = await readSession(token);
    expect(session?.role).toBe("admin");
    const secondsLeft = (session!.expiresAt - Date.now()) / 1000;
    // Allow a couple of seconds of clock/rounding slack.
    expect(secondsLeft).toBeGreaterThan(MAX_AGE - 5);
    expect(secondsLeft).toBeLessThanOrEqual(MAX_AGE + 1);
  });

  it("keeps the waiter role distinct, so a refresh cannot promote anyone", async () => {
    const session = await readSession(await createSessionJwt("waiter"));
    expect(session?.role).toBe("waiter");
  });

  it("returns null for a forged or corrupt token", async () => {
    expect(await readSession("not-a-jwt")).toBeNull();
    const real = await createSessionJwt("admin");
    expect(await readSession(real.slice(0, -3) + "aaa")).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const token = await createSessionJwt("admin");
    process.env.SECRET_KEY = "a-completely-different-secret";
    expect(await readSession(token)).toBeNull();
  });
});

describe("isDueForRefresh", () => {
  const now = 1_800_000_000_000;
  const week = MAX_AGE * 1000;

  it("leaves a freshly issued session alone", () => {
    expect(isDueForRefresh(now + week, now)).toBe(false);
  });

  it("refreshes once past halfway through the window", () => {
    expect(isDueForRefresh(now + week / 2 - 1000, now)).toBe(true);
  });

  it("does not refresh exactly at the halfway mark", () => {
    expect(isDueForRefresh(now + week / 2, now)).toBe(false);
  });

  it("treats an already-expired session as due, not as fresh", () => {
    expect(isDueForRefresh(now - 1000, now)).toBe(true);
  });
});

describe("safeReturnPath", () => {
  it("keeps the admin view someone was opening, query string included", () => {
    expect(safeReturnPath("/admin")).toBe("/admin");
    expect(safeReturnPath("/admin?filter=unsubscribed")).toBe("/admin?filter=unsubscribed");
    expect(safeReturnPath("/waiter")).toBe("/waiter");
  });

  it("refuses an absolute URL, which would send the operator off-site", () => {
    expect(safeReturnPath("https://evil.example/steal")).toBeNull();
    expect(safeReturnPath("http://evil.example")).toBeNull();
  });

  it("refuses a protocol-relative path — the classic open-redirect bypass", () => {
    // "//evil.example" is a URL, not a path: the browser keeps the scheme and
    // changes the host.
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("//evil.example/admin")).toBeNull();
  });

  it("refuses backslashes, which some browsers normalise to slashes", () => {
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("\\\\evil.example")).toBeNull();
  });

  it("refuses anything that is not an absolute path", () => {
    expect(safeReturnPath("admin")).toBeNull();
    expect(safeReturnPath("javascript:alert(1)")).toBeNull();
    expect(safeReturnPath("")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
  });

  it("refuses control characters, which could split a Location header", () => {
    expect(safeReturnPath("/admin\r\nSet-Cookie: x=1")).toBeNull();
    expect(safeReturnPath("/admin\u0000")).toBeNull();
    expect(safeReturnPath("/admin\u007f")).toBeNull();
  });

  it("tolerates surrounding whitespace rather than refusing the trip home", () => {
    expect(safeReturnPath("  /admin?filter=unsubscribed  ")).toBe("/admin?filter=unsubscribed");
  });
});
