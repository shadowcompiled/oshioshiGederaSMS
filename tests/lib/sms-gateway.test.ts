import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSmsViaGateway, isSmsGatewayConfigured, to019Destination } from "@/lib/sms-gateway";

// fetch is always stubbed: nothing in this file can reach 019.
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("SMS_019_TOKEN", "tok");
  vi.stubEnv("SMS_019_USERNAME", "oshi");
  vi.stubEnv("SMS_019_SOURCE", "OSHI GEDERA");
  vi.stubEnv("SMS_019_API_URL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("to019Destination", () => {
  it("turns +972 into local 05X form", () => {
    expect(to019Destination("+972526555139")).toEqual({ phone: "0526555139", international: false });
  });
  it("passes a local number through and flags foreign ones", () => {
    expect(to019Destination("0526555139")).toEqual({ phone: "0526555139", international: false });
    expect(to019Destination("+447700900123")).toEqual({ phone: "447700900123", international: true });
  });
});

describe("isSmsGatewayConfigured", () => {
  it("needs token, username and a valid sender", () => {
    expect(isSmsGatewayConfigured()).toBe(true);
    vi.stubEnv("SMS_019_SOURCE", "אושי");
    expect(isSmsGatewayConfigured()).toBe(false);
    vi.stubEnv("SMS_019_SOURCE", "OSHI GEDERA");
    vi.stubEnv("SMS_019_TOKEN", "");
    expect(isSmsGatewayConfigured()).toBe(false);
  });

  it("ignores the old Android gateway settings entirely", () => {
    vi.stubEnv("SMS_019_TOKEN", "");
    vi.stubEnv("ANDROID_SMS_GATEWAY_LOGIN", "x");
    vi.stubEnv("ANDROID_SMS_GATEWAY_PASSWORD", "y");
    expect(isSmsGatewayConfigured()).toBe(false);
  });
});

describe("sendSmsViaGateway", () => {
  it("posts 019's documented payload with the sender name and a local destination", async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 0, message: "SMS will be sent", shipment_id: "1" }));
    const r = await sendSmsViaGateway("+972526555139", "שלום");
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://019sms.co.il/api");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      sms: {
        user: { username: "oshi" },
        source: "OSHI GEDERA",
        destinations: { phone: [{ _: "0526555139" }] },
        message: "שלום",
      },
    });
  });

  it("reports a non-zero 019 status (e.g. no credit) as a failure", async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 4, message: "insufficient credit" }));
    const r = await sendSmsViaGateway("+972526555139", "x");
    expect(r).toEqual({ ok: false, error: "019 status 4: insufficient credit" });
  });

  it("reports an HTTP error as a failure", async () => {
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response("down", { status: 503 })));
    const r = await sendSmsViaGateway("+972526555139", "x");
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it("refuses to send without credentials, without calling 019", async () => {
    vi.stubEnv("SMS_019_TOKEN", "");
    const r = await sendSmsViaGateway("+972526555139", "x");
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honours SMS_019_API_URL so the no-send /api/test endpoint can be used", async () => {
    vi.stubEnv("SMS_019_API_URL", "https://019sms.co.il/api/test/");
    fetchMock.mockReturnValueOnce(reply({ status: 0 }));
    await sendSmsViaGateway("+972526555139", "x");
    expect(fetchMock.mock.calls[0][0]).toBe("https://019sms.co.il/api/test");
  });
});
