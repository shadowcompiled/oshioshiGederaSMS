import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const clearAdminSession = vi.fn(async () => {});
vi.mock("@/lib/auth", () => ({ clearAdminSession }));

const { GET, POST } = await import("@/app/api/logout/route");

const req = (method: string, headers: Record<string, string> = {}) =>
  new NextRequest("https://club.example/api/logout", { method, headers });

beforeEach(() => clearAdminSession.mockClear());

describe("/api/logout", () => {
  // Next.js prefetched <Link href="/api/logout"> as soon as the admin or waiter
  // screen rendered, which logged the user out behind their back.
  it.each([
    [{ "next-router-prefetch": "1", rsc: "1" }],
    [{ purpose: "prefetch" }],
    [{ "sec-purpose": "prefetch;prerender" }],
  ])("ignores a prefetch GET (%o)", async (headers) => {
    const res = await GET(req("GET", headers));
    expect(res.status).toBe(204);
    expect(clearAdminSession).not.toHaveBeenCalled();
  });

  it("logs out on a real GET", async () => {
    const res = await GET(req("GET"));
    expect(clearAdminSession).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
  });

  it("logs out on POST and lands on the home page as a GET (303, not 307)", async () => {
    const res = await POST(req("POST"));
    expect(clearAdminSession).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://club.example/");
  });
});
