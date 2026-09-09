/**
 * The provider-neutral SMS contract. Everything the application knows about
 * "sending an SMS" is this file; everything a specific vendor needs lives in
 * its adapter under lib/sms/providers/.
 */

/** Shape-compatible with the old lib/sms-gateway.ts result, so call sites and
 *  their tests keep the same success/failure semantics across providers. */
export type SendSmsResult =
  | { ok: true; body: unknown }
  | { ok: false; status?: number; error: string };

export type OutboundSms = {
  /** Destination in the app's canonical form (+972…). Adapters convert to
   *  whatever their vendor expects — callers never format per-provider. */
  to: string;
  /** The exact text to deliver. No adapter may append or rewrite content;
   *  footers are the caller's business (see /api/send_sms_task). */
  text: string;
  /** Alphanumeric sender name, for providers that support one. Adapters that
   *  cannot honor it (the Android gateway sends from its SIM) ignore it. */
  senderId?: string;
};

export interface SmsProvider {
  /** Stable identifier, also the value SMS_PROVIDER selects by. */
  readonly name: string;
  /** True when the environment carries everything this provider needs to
   *  actually deliver. Read env per call — see lib/sms-gateway.ts history. */
  isConfigured(): boolean;
  send(message: OutboundSms, timeoutMs?: number): Promise<SendSmsResult>;
}
