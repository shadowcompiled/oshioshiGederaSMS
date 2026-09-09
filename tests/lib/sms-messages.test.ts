import { describe, it, expect } from "vitest";
import { BRAND, welcomeSms, welcomeBackSms, birthdaySms, anniversarySms } from "@/lib/sms-messages";

describe("sms messages", () => {
  it("brand is Oshi Oshi Gedera", () => {
    expect(BRAND).toBe("Oshi Oshi Gedera");
  });
  // Israeli Spam Law §30A(e)(2): every promo SMS must carry the advertiser name.
  it("every message starts with the brand and includes the name", () => {
    for (const msg of [welcomeSms("דנה"), welcomeBackSms("דנה"), birthdaySms("דנה"), anniversarySms("דנה")]) {
      expect(msg.startsWith(`${BRAND}:`)).toBe(true);
      expect(msg).toContain("דנה");
    }
  });
  it("welcome message mentions the joining gift starting tomorrow", () => {
    expect(welcomeSms("דנה")).toContain("מתנת הצטרפות");
    // The joining gift is issued with valid_from = tomorrow (lib/gifts.ts), so
    // the wording points at the next order rather than the current one — which
    // is the rule that date is there to enforce.
    expect(welcomeSms("דנה")).toContain("תקף בהזמנה הבאה");
    expect(welcomeSms("דנה")).not.toContain("מחר");
  });
  // Re-subscribers already used (or still hold) their joining gift — the
  // welcome-back message must not promise a new one.
  it("welcome-back message carries brand and name but promises no joining gift", () => {
    const msg = welcomeBackSms("דנה");
    expect(msg.startsWith(`${BRAND}:`)).toBe(true);
    expect(msg).toContain("דנה");
    expect(msg).not.toContain("מתנת הצטרפות");
  });
});
