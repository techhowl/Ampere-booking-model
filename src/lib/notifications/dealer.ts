/**
 * Dealer notification.
 *
 * Behind an interface because the dealer management system does not exist for
 * us yet — open item #4, where the authoritative dealer list lives is still
 * being established. Same pattern as FakeJuspayClient and FakeSmsClient: build
 * the whole flow against the fake, swap the client when access arrives.
 *
 * In production this goes out over WhatsApp via a BSP, with SMS as the
 * fallback. Both need registered templates, so the payload here is structured
 * rather than a formatted string — the template fills from these fields.
 */

export interface TestRideNotification {
  dealerCode: string;
  dealerName: string;
  /** The dealer's own number, not the customer's. */
  dealerPhone: string | null;
  customerName: string;
  /**
   * Last four digits only. The dealer gets the full number from the lead
   * record in their own system; it has no business travelling through a
   * notification payload.
   */
  customerPhoneLast4: string;
  customerPincode: string;
  modelName: string;
  colourName: string | null;
  mode: 'home' | 'dealer';
  /** "Tomorrow, 13:00 – 15:00" */
  slot: string;
  bookingId: string;
}

export interface NotificationResult {
  notificationId: string;
}

export interface DealerNotifier {
  testRideBooked(notification: TestRideNotification): Promise<NotificationResult>;
}

export class NotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationError';
  }
}

/* ------------------------------------------------------------------ */

export class FakeDealerNotifier implements DealerNotifier {
  readonly sent: TestRideNotification[] = [];
  private failNext = false;

  failOnce() {
    this.failNext = true;
  }

  async testRideBooked(notification: TestRideNotification): Promise<NotificationResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new NotificationError('Fake dealer notifier was told to fail');
    }

    this.sent.push(notification);

    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.info(
        `[fake-dealer] ${notification.dealerName}: test ride for ${notification.customerName} ` +
          `(••••${notification.customerPhoneLast4}) — ${notification.modelName}, ` +
          `${notification.mode === 'home' ? 'at home' : 'at the dealership'}, ${notification.slot}`,
      );
    }

    return { notificationId: `fake-notify-${this.sent.length}` };
  }

  lastFor(dealerCode: string): TestRideNotification | undefined {
    return [...this.sent].reverse().find((n) => n.dealerCode === dealerCode);
  }

  reset() {
    this.sent.length = 0;
    this.failNext = false;
  }
}

/* ------------------------------------------------------------------ */

let notifier: DealerNotifier | null = null;

export function getDealerNotifier(): DealerNotifier {
  if (!notifier) notifier = new FakeDealerNotifier();
  return notifier;
}

export function setDealerNotifier(next: DealerNotifier): void {
  notifier = next;
}
