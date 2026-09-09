import type { OutboundSms, SendSmsResult, SmsProvider } from "../types";

/**
 * The provider every environment gets unless real sending is explicitly and
 * deliberately enabled (see lib/sms/index.ts). It never touches the network:
 * it records the message and reports success.
 *
 * The outbox is process-global so tests can assert on what "was sent" and so
 * `npm run dev` prints what production would have delivered.
 */

export type MockSentSms = { to: string; text: string; senderId?: string; at: string };

/** Every message "sent" by this process, oldest first. Tests may truncate it. */
export const mockSmsOutbox: MockSentSms[] = [];

export const mockSmsProvider: SmsProvider = {
  name: "mock",

  isConfigured(): boolean {
    return true;
  },

  async send(message: OutboundSms): Promise<SendSmsResult> {
    const entry: MockSentSms = {
      to: message.to,
      text: message.text,
      ...(message.senderId ? { senderId: message.senderId } : {}),
      at: new Date().toISOString(),
    };
    mockSmsOutbox.push(entry);
    console.log(
      `[sms:mock] not sending (mock provider active) → ${entry.to}: ${entry.text.slice(0, 120)}`
    );
    return { ok: true, body: { mock: true } };
  },
};
