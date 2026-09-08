import { describe, it, expect, afterEach, vi } from "vitest";
import { renderBroadcastSms, currentFooterOptions, PREVIEW_SAMPLE_PHONE } from "@/lib/sms-render";
import { unsubFooter, unsubscribeUrl, withUnsubFooter } from "@/lib/sms-footer";
import { estimateUnsubFooterUnits, smsUnits, segmentsForUnits } from "@/lib/sms-segments";
import { generateSecureToken } from "@/lib/security";

/**
 * The renderer is what makes "preview, then send" a promise rather than a
 * guess: the QStash worker, the admin test-send and the preview endpoint all
 * call renderBroadcastSms, so anything asserted here holds for all three.
 *
 * The bug these tests lock down: the test-send used to build its own, shorter
 * footer ("להסרה: {link}"), so the message the operator checked on their own
 * phone was NOT the message customers received.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("unsubFooter", () => {
  it("offers the reply keyword when the sender can receive replies", () => {
    const footer = unsubFooter("https://x.test/u/1?token=t", { canReply: true, keyword: "1111" });
    expect(footer).toBe("\n\nלהסרה: השב/י 1111 או לחצ/י כאן: https://x.test/u/1?token=t");
  });

  it("drops the reply clause for a one-way alphanumeric sender", () => {
    const footer = unsubFooter("https://x.test/u/1?token=t", { canReply: false, keyword: "1111" });
    expect(footer).toBe("\n\nלהסרה: לחצ/י כאן: https://x.test/u/1?token=t");
    expect(footer).not.toContain("השב");
  });

  it("starts with a blank line so it never runs into the message body", () => {
    expect(unsubFooter("l", { canReply: true, keyword: "1" }).startsWith("\n\n")).toBe(true);
  });
});

describe("unsubscribeUrl", () => {
  it("strips the + from the recipient and any trailing slash from the base", () => {
    expect(unsubscribeUrl("https://a.test/", "+972501234567", "tok")).toBe(
      "https://a.test/unsubscribe/972501234567?token=tok"
    );
  });
});

describe("renderBroadcastSms", () => {
  it("keeps the operator's text verbatim and appends the footer", () => {
    vi.stubEnv("APP_URL", "https://club.test");
    const message = "מבצע 1+1 על כל הסושי!";
    const { text, unsubLink } = renderBroadcastSms(message, "+972501234567");
    expect(text.startsWith(message)).toBe(true);
    expect(text).toBe(withUnsubFooter(message, unsubLink, currentFooterOptions()));
  });

  it("builds a per-recipient opt-out link signed for that number", () => {
    vi.stubEnv("APP_URL", "https://club.test");
    const { unsubLink } = renderBroadcastSms("היי", "+972501234567");
    expect(unsubLink).toBe(
      `https://club.test/unsubscribe/972501234567?token=${generateSecureToken("+972501234567")}`
    );
  });

  it("gives two different recipients two different opt-out links", () => {
    vi.stubEnv("APP_URL", "https://club.test");
    const a = renderBroadcastSms("היי", "+972501111111").unsubLink;
    const b = renderBroadcastSms("היי", "+972502222222").unsubLink;
    expect(a).not.toBe(b);
  });

  it("falls back to the request origin only when no APP_URL is configured", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    expect(renderBroadcastSms("היי", "+972501234567", "https://origin.test").unsubLink).toContain(
      "https://origin.test/unsubscribe/"
    );
  });

  it("prefers APP_URL over the request origin, so links never point at a preview deploy", () => {
    vi.stubEnv("APP_URL", "https://club.test");
    expect(renderBroadcastSms("היי", "+972501234567", "https://preview.vercel.app").unsubLink).toContain(
      "https://club.test/"
    );
  });
});

describe("the preview matches what is sent", () => {
  /**
   * The audience preview has no single recipient, so it renders against a
   * stand-in number. That is only acceptable if the stand-in produces the same
   * segment count as a real one — otherwise the cost shown before a broadcast
   * would be wrong.
   */
  it("renders the sample recipient to the same length as a real number", () => {
    vi.stubEnv("APP_URL", "https://club.test");
    const message = "א".repeat(60);
    const sample = renderBroadcastSms(message, PREVIEW_SAMPLE_PHONE).text;
    const real = renderBroadcastSms(message, "+972541234567").text;
    expect(smsUnits(sample)).toBe(smsUnits(real));
    expect(segmentsForUnits(smsUnits(sample))).toBe(segmentsForUnits(smsUnits(real)));
  });

  it("keeps the composer's footer estimate within a couple of chars of the real footer", () => {
    vi.stubEnv("APP_URL", "https://example.vercel.app");
    vi.stubEnv("UNSUBSCRIBE_KEYWORD", "1111");
    const rendered = renderBroadcastSms("היי", "+972501234567");
    const realFooterUnits = rendered.text.length - "היי".length;
    const estimate = estimateUnsubFooterUnits(
      "1111",
      "https://example.vercel.app",
      rendered.footer.canReply
    );
    // Only the recipient digits differ between the estimate's sample link and
    // the real one; the 32-char token length is fixed.
    expect(Math.abs(estimate - realFooterUnits)).toBeLessThanOrEqual(2);
  });

  it("the estimate is ~13 chars shorter when the sender cannot receive replies", () => {
    const withReply = estimateUnsubFooterUnits("1111", "https://a.test", true);
    const withoutReply = estimateUnsubFooterUnits("1111", "https://a.test", false);
    expect(withReply - withoutReply).toBe("השב/י 1111 או ".length);
  });
});

describe("currentFooterOptions", () => {
  it("reads the unsubscribe keyword from the environment", () => {
    vi.stubEnv("UNSUBSCRIBE_KEYWORD", "STOP");
    expect(currentFooterOptions().keyword).toBe("STOP");
  });

  it("defaults the keyword to 1111", () => {
    vi.stubEnv("UNSUBSCRIBE_KEYWORD", "");
    expect(currentFooterOptions().keyword).toBe("1111");
  });
});
