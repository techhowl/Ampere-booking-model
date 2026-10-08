import { maskPhone } from '@/lib/phone-format';

/**
 * SMS, behind an interface so the whole OTP flow can be built and tested before
 * a provider exists. Same pattern as FakeJuspayClient: swapping in the real
 * client later is a constructor change.
 *
 * Indian transactional SMS must go through a DLT-registered template — the
 * content is pre-approved with the regulator and only the variables change.
 * `templateId` carries that registration; it is unset until the templates are
 * registered, which is a commercial step, not a coding one.
 */

export interface SmsMessage {
  /** E.164. */
  to: string;
  body: string;
  /** DLT template id. Required in production once templates are registered. */
  templateId?: string;
}

export interface SmsResult {
  messageId: string;
}

export interface SmsClient {
  send(message: SmsMessage): Promise<SmsResult>;
}

export class SmsDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmsDeliveryError';
  }
}

/** The message an OTP is delivered in. Kept here so the template text is in one place. */
export function otpMessage(code: string): string {
  return `${code} is your Ampere verification code. It expires in 10 minutes. Do not share it with anyone.`;
}

/* ------------------------------------------------------------------ */
/* Fake — drives development and the whole test suite                  */
/* ------------------------------------------------------------------ */

export interface SentMessage extends SmsMessage {
  messageId: string;
  sentAt: Date;
}

export class FakeSmsClient implements SmsClient {
  readonly sent: SentMessage[] = [];
  private failNext = false;

  /** Make the next send throw, for testing the failure path. */
  failOnce() {
    this.failNext = true;
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new SmsDeliveryError('Fake SMS provider was told to fail');
    }

    const messageId = `fake-sms-${this.sent.length + 1}`;
    this.sent.push({ ...message, messageId, sentAt: new Date() });

    // Without a provider there is no other way to read the code locally. The
    // number is masked even here: production never runs this class, but the
    // habit of never printing one in full is the point.
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.info(`[fake-sms] to ${maskPhone(message.to)}: ${message.body}`);
    }

    return { messageId };
  }

  lastTo(to: string): SentMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }

  reset() {
    this.sent.length = 0;
    this.failNext = false;
  }
}

/* ------------------------------------------------------------------ */

let client: SmsClient | null = null;

/**
 * The fake is the only implementation today. When a provider arrives this is
 * the one place that changes.
 */
export function getSmsClient(): SmsClient {
  if (!client) client = new FakeSmsClient();
  return client;
}

/** Tests and the dev console swap the client here. */
export function setSmsClient(next: SmsClient): void {
  client = next;
}
