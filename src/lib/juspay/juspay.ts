/**
 * Juspay integration.
 *
 * The central problem: Juspay's browser return carries order_id, dealer and
 * amount — the SAME three fields on success and on failure. Nothing in it says
 * which. So the browser is treated as navigation only. Truth comes from the
 * webhook, with the status API as a synchronous reconciler.
 *
 * Everything here is built against FakeJuspayClient so the whole payment flow,
 * including reconciliation, can be finished before Juspay credentials arrive.
 * Swapping in the real client later is a constructor change.
 */

export type JuspayStatus = 'CHARGED' | 'PENDING' | 'AUTHORIZATION_FAILED' | 'NEW';

export interface CreateOrderInput {
  orderId: string;
  amount: number;
  customerPhone: string;
  returnUrl: string;
  /** "full" | "partial" opens with EMI suppressed; "emi" surfaces EMI plans. */
  paymentIntent: 'full' | 'partial' | 'emi';
}

export interface CreateOrderResult {
  orderId: string;
  redirectUrl: string;
}

export interface OrderStatusResult {
  orderId: string;
  status: JuspayStatus;
  amountPaid?: number;
  paymentMethod?: string;
  raw: unknown;
}

export interface JuspayClient {
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  getOrderStatus(orderId: string): Promise<OrderStatusResult>;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

/* ------------------------------------------------------------------ */
/* Fake — drives development and the whole test suite                  */
/* ------------------------------------------------------------------ */

type Scenario = 'success' | 'failure' | 'pending' | 'timeout';

export class FakeJuspayClient implements JuspayClient {
  private scenarios = new Map<string, Scenario>();
  private orders = new Map<string, CreateOrderInput>();
  private statusCalls = new Map<string, number>();

  /** Decide what this order will do. Default is success. */
  script(orderId: string, scenario: Scenario) {
    this.scenarios.set(orderId, scenario);
  }

  statusCallCount(orderId: string) {
    return this.statusCalls.get(orderId) ?? 0;
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    this.orders.set(input.orderId, input);
    return {
      orderId: input.orderId,
      // Our own stand-in checkout, so the whole loop is walkable before Juspay
      // credentials arrive. The real client returns payment_links.web here.
      redirectUrl: `/pay/${input.orderId}`,
    };
  }

  /** What was asked for, so a test can assert the amount and the filter. */
  lastOrder(orderId: string): CreateOrderInput | undefined {
    return this.orders.get(orderId);
  }

  async getOrderStatus(orderId: string): Promise<OrderStatusResult> {
    this.statusCalls.set(orderId, this.statusCallCount(orderId) + 1);
    const scenario = this.scenarios.get(orderId) ?? 'success';

    if (scenario === 'timeout') throw new Error('Juspay status API timed out');

    const status: JuspayStatus =
      scenario === 'success' ? 'CHARGED' : scenario === 'failure' ? 'AUTHORIZATION_FAILED' : 'PENDING';

    return { orderId, status, amountPaid: status === 'CHARGED' ? 104250 : undefined, raw: { scenario } };
  }

  /** The fake accepts "valid-signature" and rejects everything else. */
  verifyWebhookSignature(_rawBody: string, signature: string): boolean {
    return signature === 'valid-signature';
  }
}

/* ------------------------------------------------------------------ */
/* Status resolution — the part that must be right                     */
/* ------------------------------------------------------------------ */

export type ResolvedStatus = 'paid' | 'failed' | 'pending' | 'unknown';

export function mapJuspayStatus(status: JuspayStatus): ResolvedStatus {
  switch (status) {
    case 'CHARGED':
      return 'paid';
    case 'AUTHORIZATION_FAILED':
      return 'failed';
    case 'PENDING':
    case 'NEW':
      return 'pending';
  }
}

/**
 * State machine for order status.
 *
 * `paid` is TERMINAL. Webhooks can arrive twice, out of order, or after the
 * customer has already been shown a confirmation. A paid order is never
 * downgraded by a later message.
 */
export function nextStatus(current: ResolvedStatus, incoming: ResolvedStatus): ResolvedStatus {
  if (current === 'paid') return 'paid';
  if (incoming === 'paid') return 'paid';
  if (current === 'failed' && incoming === 'pending') return 'failed';
  return incoming;
}

export interface StoredOrder {
  orderId: string;
  status: ResolvedStatus;
  statusSource?: 'webhook' | 'status_api';
}

/**
 * Called when the customer lands back on our return URL.
 *
 * We deliberately ignore every field in the return query string except the
 * order id. Those parameters are attacker-controlled; the amount shown on a
 * confirmation screen must never come from them.
 */
export async function resolveOnReturn(
  client: JuspayClient,
  stored: StoredOrder,
): Promise<{ status: ResolvedStatus; source: 'webhook' | 'status_api' | 'none' }> {
  // The webhook may already have landed while the customer was redirecting.
  if (stored.status === 'paid' || stored.status === 'failed') {
    return { status: stored.status, source: stored.statusSource ?? 'webhook' };
  }

  try {
    const result = await client.getOrderStatus(stored.orderId);
    return { status: mapJuspayStatus(result.status), source: 'status_api' };
  } catch {
    // Never guess. The UI shows "confirming your payment" and polls.
    return { status: 'unknown', source: 'none' };
  }
}
