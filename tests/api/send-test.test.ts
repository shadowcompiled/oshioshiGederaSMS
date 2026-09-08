import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The admin test-send exists to answer one question: "is this exactly what my
 * customers will get?" These tests assert that it is — byte for byte against
 * the QStash worker that does the real broadcasting.
 *
 * That parity was previously broken: the test-send appended its own, shorter
 * footer ("להסרה: {link}") while the worker appended the reply-keyword form,
 * so a test message could sit at a different segment count than the broadcast
 * it was meant to rehearse. Both now render through lib/sms-render.ts.
 */

let adminOk = false;
vi.mock("@/lib/auth", () => ({
  getAdminSession: async () => adminOk,
  attachSessionCookie: async (res: unknown) => res,
}));

// The worker reads the client IP for rate limiting; next/headers is not
// available outside a request context. A fresh bucket per test keeps the
// in-memory limiter from carrying over.
let ipCounter = 0;
vi.mock("@/lib/get-ip", () => ({ getClientIp: async () => `test-ip-sendtest-${ipCounter}` }));

let dbWrites: { sql: string; params: unknown[] }[] = [];
vi.mock("@/lib/db", () => ({
  initDb: async () => {},
  getDb: () => ({ type: "sqlite", conn: { close: () => {} } }),
  runDb: async (_db: unknown, sql: string, params: unknown[]) => {
    dbWrites.push({ sql, params });
    return { rowCount: 1 };
  },
  queryCustomers: async () => [],
}));

import { POST as sendTestPOST } from "@/app/api/admin/send-test/route";
import { POST as workerPOST } from "@/app/api/send_sms_task/route";
import { createImportToken, getAppSecret } from "@/lib/security";
import { mockSmsOutbox } from "@/lib/sms";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  ipCounter += 1;
  adminOk = false;
  dbWrites = [];
  mockSmsOutbox.length = 0;
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.SECRET_KEY = "send-test-secret";
  process.env.APP_URL = "https://club.test";
  process.env.UNSUBSCRIBE_KEYWORD = "1111";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  mockSmsOutbox.length = 0;
});

function testSendReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/admin/send-test", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}

function formSendReq(fields: Record<string, string>): NextRequest {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new NextRequest("http://localhost/api/admin/send-test", { method: "POST", body: fd });
}

function workerReq(phone: string, message: string): NextRequest {
  return new NextRequest("http://localhost/api/send_sms_task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: getAppSecret(), phone, message }),
  });
}

describe("the test message is the real message", () => {
  it("sends text byte-identical to what the broadcast worker sends", async () => {
    const phone = "+972501234567";
    const message = "Oshi Oshi Gedera: מבצע 1+1 על כל הסושי הערב! 🍣";

    const testRes = await sendTestPOST(testSendReq({ import_token: createImportToken(), phone, message }));
    expect(testRes.status).toBe(200);

    const workerRes = await workerPOST(workerReq(phone, message));
    expect(workerRes.status).toBe(200);

    expect(mockSmsOutbox).toHaveLength(2);
    const [fromTest, fromWorker] = mockSmsOutbox;
    expect(fromTest.to).toBe(fromWorker.to);
    expect(fromTest.text).toBe(fromWorker.text);
  });

  it("accepts a local-format number and normalises it the way the worker does", async () => {
    const message = "היי";
    await sendTestPOST(testSendReq({ import_token: createImportToken(), phone: "0501234567", message }));
    await workerPOST(workerReq("+972501234567", message));
    expect(mockSmsOutbox[0].text).toBe(mockSmsOutbox[1].text);
    expect(mockSmsOutbox[0].to).toBe("+972501234567");
  });

  it("carries the opt-out footer with the recipient's own unsubscribe link", async () => {
    await sendTestPOST(
      testSendReq({ import_token: createImportToken(), phone: "0501234567", message: "היי" })
    );
    expect(mockSmsOutbox[0].text).toContain("להסרה:");
    expect(mockSmsOutbox[0].text).toContain("https://club.test/unsubscribe/972501234567?token=");
  });
});

describe("responses", () => {
  it("answers JSON when the caller asks for it, so a draft is not lost to a redirect", async () => {
    const res = await sendTestPOST(
      testSendReq({ import_token: createImportToken(), phone: "0501234567", message: "היי" })
    );
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(typeof json.msg).toBe("string");
  });

  it("still redirects a plain form POST, keeping the no-JS path working", async () => {
    const res = await sendTestPOST(
      formSendReq({ import_token: createImportToken(), phone: "0501234567", message: "היי" })
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/admin?msg=");
  });

  it("says the message was not really delivered when the mock provider is active", async () => {
    const res = await sendTestPOST(
      testSendReq({ import_token: createImportToken(), phone: "0501234567", message: "היי" })
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.msg).toContain("מצב הדגמה");
  });

  it("reports a JSON failure with status 400 rather than a redirect", async () => {
    const res = await sendTestPOST(
      testSendReq({ import_token: createImportToken(), phone: "123", message: "היי" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });
});

describe("authorisation and validation", () => {
  it("refuses without a session or a valid import token", async () => {
    const res = await sendTestPOST(testSendReq({ phone: "0501234567", message: "היי" }));
    expect((await res.json()).ok).toBe(false);
    expect(mockSmsOutbox).toHaveLength(0);
  });

  it("refuses an empty message", async () => {
    const res = await sendTestPOST(
      testSendReq({ import_token: createImportToken(), phone: "0501234567", message: "  " })
    );
    expect((await res.json()).ok).toBe(false);
    expect(mockSmsOutbox).toHaveLength(0);
  });

  it("refuses a message over 1000 characters", async () => {
    const res = await sendTestPOST(
      testSendReq({ import_token: createImportToken(), phone: "0501234567", message: "א".repeat(1001) })
    );
    expect((await res.json()).ok).toBe(false);
    expect(mockSmsOutbox).toHaveLength(0);
  });
});

describe("a mock test-send does not mark the customer as contacted", () => {
  it("leaves received_message_at alone when nothing was really delivered", async () => {
    // Otherwise a rehearsal would quietly drop that customer out of the
    // "never messaged" audience without any message having arrived.
    await sendTestPOST(
      testSendReq({ import_token: createImportToken(), phone: "0501234567", message: "היי" })
    );
    expect(dbWrites.filter((w) => w.sql.includes("received_message_at"))).toHaveLength(0);
  });
});

describe("multiple test recipients", () => {
  it("sends one message per number, each with its own opt-out link", async () => {
    const res = await sendTestPOST(
      testSendReq({
        import_token: createImportToken(),
        phones: ["0501234567", "0521111111", "0533333333"],
        message: "היי",
      })
    );
    expect((await res.json()).ok).toBe(true);
    expect(mockSmsOutbox).toHaveLength(3);
    expect(mockSmsOutbox.map((m) => m.to)).toEqual([
      "+972501234567",
      "+972521111111",
      "+972533333333",
    ]);
    // Same wording for everyone, but the link is personal to each number.
    const links = mockSmsOutbox.map((m) => m.text.match(/unsubscribe\/(\d+)\?token=(\w+)/)![0]);
    expect(new Set(links).size).toBe(3);
  });

  it("texts a number chosen twice only once", async () => {
    const res = await sendTestPOST(
      testSendReq({
        import_token: createImportToken(),
        phones: ["0501234567", "+972501234567"],
        message: "היי",
      })
    );
    expect((await res.json()).ok).toBe(true);
    expect(mockSmsOutbox).toHaveLength(1);
  });

  it("refuses more than four numbers without sending any", async () => {
    const res = await sendTestPOST(
      testSendReq({
        import_token: createImportToken(),
        phones: ["0501111111", "0502222222", "0503333333", "0504444444", "0505555555"],
        message: "היי",
      })
    );
    expect((await res.json()).ok).toBe(false);
    expect(mockSmsOutbox).toHaveLength(0);
  });

  it("rejects the whole set when one number is unusable, sending nothing", async () => {
    // A partial send would leave the operator believing every handset was
    // checked when one never got the message.
    const res = await sendTestPOST(
      testSendReq({ import_token: createImportToken(), phones: ["0501234567", "nope"], message: "היי" })
    );
    expect((await res.json()).ok).toBe(false);
    expect(mockSmsOutbox).toHaveLength(0);
  });

  it("refuses an empty selection", async () => {
    const res = await sendTestPOST(
      testSendReq({ import_token: createImportToken(), phones: [], message: "היי" })
    );
    expect((await res.json()).ok).toBe(false);
    expect(mockSmsOutbox).toHaveLength(0);
  });

  it("still accepts the single-phone form used by the plain form POST", async () => {
    const res = await sendTestPOST(
      formSendReq({ import_token: createImportToken(), phone: "0501234567", message: "היי" })
    );
    expect(res.status).toBe(303);
    expect(mockSmsOutbox).toHaveLength(1);
  });

  it("names every number it reached in the confirmation", async () => {
    const res = await sendTestPOST(
      testSendReq({
        import_token: createImportToken(),
        phones: ["0501234567", "0521111111"],
        message: "היי",
      })
    );
    const { msg } = await res.json();
    expect(msg).toContain("+972501234567");
    expect(msg).toContain("+972521111111");
  });
});
