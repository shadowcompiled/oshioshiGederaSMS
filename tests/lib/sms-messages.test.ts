import { describe, it, expect } from "vitest";
import {
  welcomeSms,
  welcomeBackSms,
  birthdaySms,
  anniversarySms,
  verificationSms,
} from "@/lib/sms-messages";

const PROMOTIONAL = [
  welcomeSms("דנה"),
  welcomeBackSms("דנה"),
  birthdaySms("דנה"),
  anniversarySms("דנה"),
];

describe("sms messages", () => {
  /**
   * Every message is sent from the alphanumeric sender id `OSHI GEDERA`, which
   * the handset displays as the sender. A body that also opened with
   * "Oshi Oshi Gedera:" therefore printed the restaurant's name twice, in two
   * different forms — 019 caps a sender id at 11 characters, so one "Oshi" had
   * to be dropped from it. The name now appears once, as the sender.
   */
  it("no message repeats the restaurant name in the body", () => {
    for (const msg of [...PROMOTIONAL, verificationSms("482913", 10)]) {
      expect(msg.toLowerCase()).not.toContain("oshi");
      expect(msg).not.toContain("גדרה");
    }
  });

  it("every promotional message still addresses the member by name", () => {
    for (const msg of PROMOTIONAL) {
      expect(msg).toContain("דנה");
      // The greeting now opens the message, so the first thing read is the
      // member's own name rather than the sender repeated back at them.
      expect(msg.startsWith("היי דנה")).toBe(true);
    }
  });

  it("welcome message mentions the joining gift, valid on the next order", () => {
    expect(welcomeSms("דנה")).toContain("מתנת הצטרפות");
    // The joining gift is issued with valid_from = tomorrow (lib/gifts.ts), so
    // the wording points at the next order rather than the current one — which
    // is the rule that date is there to enforce.
    expect(welcomeSms("דנה")).toContain("תקף בהזמנה הבאה");
    expect(welcomeSms("דנה")).not.toContain("מחר");
  });

  // Re-subscribers already used (or still hold) their joining gift — the
  // welcome-back message must not promise a new one.
  it("welcome-back message carries the name but promises no joining gift", () => {
    const msg = welcomeBackSms("דנה");
    expect(msg).toContain("דנה");
    expect(msg).not.toContain("מתנת הצטרפות");
  });

  it("verification message leads with the code and offers no opt-out", () => {
    const msg = verificationSms("482913", 10);
    expect(msg.startsWith("482913")).toBe(true);
    expect(msg).toContain("10 דקות");
    // Transactional, so no marketing footer language belongs in it.
    expect(msg).not.toContain("להסרה");
  });
});
