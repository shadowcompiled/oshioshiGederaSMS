import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * /api/admin/sms-preview must answer "what exactly goes out, to how many
 * people, and will it actually be delivered?" — and must answer it without
 * sending anything. The last part is asserted directly: the mock outbox stays
 * empty across every case below.
 */

// getAdminSession uses next/headers cookies(), unavailable outside a request
// context. The route also accepts a signed import token, which is what the
// no-session cases below exercise.
let adminOk = false;
vi.mock("@/lib/auth", () => ({
  getAdminSession: async () => adminOk,
  attachSessionCookie: async (res: unknown) => res,
}));

// The audience count is the only DB read; stub it so these tests are about the
// preview logic, not schema setup.
let audienceRows: { phone: string }[] = [];
let lastQuery = "";
vi.mock("@/lib/db", () => ({
  initDb: async () => {},
  getDb: () => ({ type: "sqlite", conn: { close: () => {} } }),
  queryCustomers: async (_db: unknown, sql: string) => {
    lastQuery = sql;
    return audienceRows;
  },
}));

import { POST } from "@/app/api/admin/sms-preview/route";
import { createImportToken } from "@/lib/security";
import { mockSmsOutbox } from "@/lib/sms";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  adminOk = false;
  audienceRows = [];
  lastQuery = "";
  mockSmsOutbox.length = 0;
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.SECRET_KEY = "preview-test-secret";
  process.env.APP_URL = "https://club.test";
  process.env.UNSUBSCRIBE_KEYWORD = "1111";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  mockSmsOutbox.length = 0;
});

type Body = Record<string, unknown>;

function req(body: Body): NextRequest {
  return new NextRequest("http://localhost/api/admin/sms-preview", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}

/** A request authorised by the signed import token rather than a session. */
function authed(body: Body): NextRequest {
  return req({ import_token: createImportToken(), ...body });
}

async function preview(body: Body) {
  const res = await POST(authed(body));
  const json = await res.json();
  return { status: res.status, json, p: json.preview };
}

describe("authorisation", () => {
  it("refuses a request with neither a session nor an import token", async () => {
    const res = await POST(req({ message: "היי", mode: "broadcast" }));
    expect(res.status).toBe(403);
    expect((await res.json()).ok).toBe(false);
  });

  it("refuses a forged import token", async () => {
    const res = await POST(req({ import_token: "import:999:deadbeef", message: "היי" }));
    expect(res.status).toBe(403);
  });

  it("accepts a valid import token", async () => {
    process.env.QSTASH_TOKEN = "qs-token";
    audienceRows = [{ phone: "+972501111111" }];
    const { status, json } = await preview({ message: "היי", mode: "broadcast" });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });
});

describe("input validation", () => {
  it("rejects an empty message", async () => {
    const { status, json } = await preview({ message: "   ", mode: "broadcast" });
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
  });

  it("rejects a message over 1000 characters, matching the send endpoints", async () => {
    const { status } = await preview({ message: "א".repeat(1001), mode: "broadcast" });
    expect(status).toBe(400);
  });

  it("rejects an unusable phone in test mode", async () => {
    const { status, json } = await preview({ message: "היי", mode: "test", phone: "12345" });
    expect(status).toBe(400);
    expect(json.msg).toContain("טלפון");
  });

  it("rejects a malformed JSON body", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/admin/sms-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("test-send preview", () => {
  it("renders the exact text for that recipient, footer included", async () => {
    const { p } = await preview({ message: "מבצע 1+1", mode: "test", phone: "0501234567" });
    expect(p.exactRecipient).toBe(true);
    expect(p.recipient).toBe("+972501234567");
    // The leading character is the invisible RTL mark the handset needs.
    expect(p.text.replace("‏", "").startsWith("מבצע 1+1")).toBe(true);
    expect(p.text).toContain("להסרה:");
    expect(p.text).toContain("https://club.test/unsubscribe/972501234567?token=");
    expect(p.audience.mode).toBe("test");
    expect(p.audience.recipients).toBe(1);
  });

  it("reports units and segments over the full text, not just the typed part", async () => {
    const { p } = await preview({ message: "היי", mode: "test", phone: "0501234567" });
    expect(p.units).toBe(p.text.length);
    expect(p.units).toBeGreaterThan("היי".length);
    expect(p.segments).toBeGreaterThanOrEqual(1);
  });

  it("does not need QSTASH_TOKEN — a test send bypasses the queue", async () => {
    delete process.env.QSTASH_TOKEN;
    const { p } = await preview({ message: "היי", mode: "test", phone: "0501234567" });
    expect(p.blocking).toBeNull();
  });
});

describe("broadcast preview", () => {
  beforeEach(() => {
    process.env.QSTASH_TOKEN = "qs-token";
  });

  it("counts the audience and multiplies out the billable total", async () => {
    audienceRows = [{ phone: "+9725011" }, { phone: "+9725022" }, { phone: "+9725033" }];
    const { p } = await preview({ message: "היי", mode: "broadcast", send_to: "all" });
    expect(p.audience.recipients).toBe(3);
    expect(p.audience.totalSegments).toBe(3 * p.segments);
    expect(p.audience.mode).toBe("all");
  });

  it("narrows the count to never-messaged customers for the new-only audience", async () => {
    audienceRows = [{ phone: "+9725011" }];
    const { p } = await preview({ message: "היי", mode: "broadcast", send_to: "new_only" });
    expect(lastQuery).toContain("received_message_at IS NULL");
    expect(p.audience.mode).toBe("new_only");
  });

  it("uses a stand-in recipient and says so, since there is no single number", async () => {
    audienceRows = [{ phone: "+9725011" }];
    const { p } = await preview({ message: "היי", mode: "broadcast" });
    expect(p.exactRecipient).toBe(false);
    expect(p.recipient).toBeNull();
  });

  it("blocks an empty audience instead of queueing nothing", async () => {
    audienceRows = [];
    const { p } = await preview({ message: "היי", mode: "broadcast", send_to: "all" });
    expect(p.blocking).toContain("אין לקוחות פעילים");
  });

  it("blocks when QSTASH_TOKEN is missing, since the queue is the delivery path", async () => {
    delete process.env.QSTASH_TOKEN;
    audienceRows = [{ phone: "+9725011" }];
    const { p } = await preview({ message: "היי", mode: "broadcast" });
    expect(p.blocking).toContain("QSTASH_TOKEN");
  });

  it("does not cry wolf over a message that still fits one billed unit", async () => {
    audienceRows = [{ phone: "+9725011" }];
    // 60 chars plus the ~115-char footer is under the 202-character billing
    // unit, so this is one message and deserves no warning.
    const { p } = await preview({ message: "א".repeat(60), mode: "broadcast" });
    expect(p.segments).toBe(1);
    expect(p.notes.some((n: { text: string }) => n.text.includes("מחויבת"))).toBe(false);
  });

  it("warns once the message costs more than one billed message", async () => {
    audienceRows = [{ phone: "+9725011" }];
    const { p } = await preview({ message: "א".repeat(400), mode: "broadcast" });
    expect(p.segments).toBeGreaterThanOrEqual(2);
    expect(p.notes.some((n: { text: string }) => n.text.includes("מחויבת"))).toBe(true);
  });
});

describe("sender reporting", () => {
  it("says plainly that a test run would not really deliver", async () => {
    // The test environment always gets the mock provider — that guard is the
    // point of lib/sms — so the preview must not imply a real send.
    const { p } = await preview({ message: "היי", mode: "test", phone: "0501234567" });
    expect(p.sender.provider).toBe("mock");
    expect(p.sender.delivers).toBe(false);
    expect(p.sender.environment).toBe("test");
    expect(p.notes.some((n: { text: string }) => n.text.includes("מצב הדגמה"))).toBe(true);
  });
});

describe("the preview never sends", () => {
  it("leaves the outbox empty across preview calls", async () => {
    process.env.QSTASH_TOKEN = "qs-token";
    audienceRows = [{ phone: "+9725011" }];
    await preview({ message: "היי", mode: "test", phone: "0501234567" });
    await preview({ message: "היי", mode: "broadcast" });
    expect(mockSmsOutbox).toHaveLength(0);
  });
});
