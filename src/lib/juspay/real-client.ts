import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CreateOrderInput,
  CreateOrderResult,
  JuspayClient,
  JuspayStatus,
  OrderStatusResult,
} from './juspay';

/**
 * The real Juspay client, built against "Integration steps with Juspay APIs
 * and webhooks" (Hypercredit).
 *
 * We do not take payments. We create a session, hand the customer Juspay's own
 * hosted page, and they handle everything from there. No card details reach
 * this codebase, by design and by compliance.
 *
 * NOT YET VERIFIED AGAINST A LIVE ACCOUNT. Three things are still outstanding
 * from Juspay and are marked VERIFY below:
 *   - the webhook signature scheme
 *   - the exact Order Status API response shape
 *   - sandbox credentials to test any of it
 *
 * Until those arrive `getJuspayClient()` returns the fake. Nothing here runs.
 */

const TIMEOUT_MS = 15_000;

export interface JuspayConfig {
  /** Issued on the Juspay dashboard. Sent as the Authorization header. */
  apiKey: string;
  merchantId: string;
  /** Identifies which hosted payment page to open. */
  paymentPageClientId: string;
  /** https://sandbox.juspay.in or https://api.juspay.in */
  baseUrl: string;
  /** Where Juspay's servers notify us. Absolute and publicly reachable. */
  webhookUrl: string;
  /** Verifies that a webhook genuinely came from Juspay. */
  webhookSecret: string;
}

export interface OrderContext {
  customerId: string;
  modelName: string;
  /** Ex-showroom, in rupees. */
  productPrice: number;
  rtoCharges: number;
  /** On-road. Juspay calls this total_amount. */
  totalAmount: number;
  dealerCode: string;
  dealerName: string;
  pincode: string;
  city?: string | null;
  state?: string | null;
}

export class JuspayApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'JuspayApiError';
  }
}

/**
 * Which payment methods Juspay surfaces.
 *
 * From the integration document: CF_LSP is the TVS Credit vehicle loan, CF_EMI
 * is card instalments. Build spec 10 is firm that these are different products
 * at materially different rates and must never be presented as one.
 *
 * This sets the default the customer lands on. They can still change it on
 * Juspay's page — it is a filter, not a trap.
 */
function paymentFilter(intent: CreateOrderInput['paymentIntent']) {
  if (intent === 'emi') {
    return {
      allowDefaultOptions: false,
      options: [
        { paymentMethodType: 'CONSUMER_FINANCE', paymentMethodSubTypes: ['CF_EMI'], enable: true },
        { paymentMethodType: 'CONSUMER_FINANCE', paymentMethodSubTypes: ['CF_LSP'], enable: true },
      ],
      emiOptions: {
        standardEmi: { enable: true },
        lowCostEmi: { enable: true },
        noCostEmi: { enable: true },
      },
    };
  }

  // Full and partial both suppress financing and open on the usual rails.
  return {
    allowDefaultOptions: true,
    options: [
      { paymentMethodType: 'CONSUMER_FINANCE', paymentMethodSubTypes: ['CF_EMI'], enable: false },
      { paymentMethodType: 'CONSUMER_FINANCE', paymentMethodSubTypes: ['CF_LSP'], enable: false },
    ],
    emiOptions: {
      standardEmi: { enable: false },
      lowCostEmi: { enable: false },
      noCostEmi: { enable: false },
    },
  };
}

export class RealJuspayClient implements JuspayClient {
  constructor(
    private readonly config: JuspayConfig,
    /** Supplies the order detail Juspay wants in metadata. */
    private readonly contextFor: (orderId: string) => Promise<OrderContext>,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: this.config.apiKey,
      'Content-Type': 'application/json',
      // Mandatory per the document, and our idempotency handle on their side.
      'X-Request-Id': randomUUID(),
      ...extra,
    };
  }

  /**
   * Session Order API — POST /session.
   *
   * Returns the hosted page URL. The customer is sent there and does not come
   * back until Juspay redirects them to our return_url.
   */
  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const ctx = await this.contextFor(input.orderId);

    const body = {
      order_id: input.orderId,
      amount: input.amount.toFixed(2),
      currency: 'INR',
      description: `Ampere ${ctx.modelName}`,
      customer_id: ctx.customerId,
      customer_phone: input.customerPhone,
      payment_page_client_id: this.config.paymentPageClientId,
      action: 'paymentPage',
      return_url: input.returnUrl,

      'metadata.source': 'Online',
      'metadata.webhook_url': this.config.webhookUrl,
      'metadata.order_basket': [
        {
          brand: 'Ampere',
          category: 'Automobile',
          sub_category: 'Low Speed EV',
          product_name: ctx.modelName,
          product_price: ctx.productPrice,
          rto_charges: ctx.rtoCharges,
          total_amount: ctx.totalAmount,
          unit: 1,
        },
      ],
      'metadata.dealer_details': {
        dealer_code: ctx.dealerCode,
        dealer_name: ctx.dealerName,
      },
      /*
       * VERIFY: the document marks delivery_address mandatory, with
       * address_line_1 and address_line_2 both required. We do not collect an
       * address — the journey asks only for a pincode.
       *
       * Sending the pincode alone until Ampere decides whether to add address
       * fields. Open question 5 in docs/juspay/integration-notes.md.
       */
      'metadata.delivery_address': {
        address_line_1: '',
        address_line_2: '',
        city: ctx.city ?? '',
        state: ctx.state ?? '',
        pincode: ctx.pincode,
        address_type: 'DELIVERY',
      },

      // VERIFY: the field table says `payment_rule`, the sample payload says
      // `payment_rules`. Sending the sample's spelling; question 4 to Juspay.
      payment_rules: {
        payment_flows: {
          part_payment: {
            status: 'OPTIONAL',
            info: {
              plan_info: [
                {
                  plan_type: 'EDITABLE',
                  editable_plan_details: [
                    {
                      minimum_part_amount: String(Math.round(input.amount)),
                      maximum_no_of_parts: 1,
                      plan_title: 'Pay now',
                      plan_description: '',
                      parts_info: [
                        { part_number: 1, payment_filter: paymentFilter(input.paymentIntent) },
                      ],
                    },
                  ],
                  plan_type_description: '',
                  fixed_plan_details: null,
                  plan_type_title: '',
                },
              ],
            },
          },
        },
      },
    };

    const response = await this.post('/session', body);

    const links = response.payment_links as Record<string, string> | undefined;
    const redirectUrl = links?.web;
    if (!redirectUrl) {
      throw new JuspayApiError(
        200,
        JSON.stringify(response),
        'Juspay returned a session with no payment_links.web to redirect to',
      );
    }

    return { orderId: input.orderId, redirectUrl };
  }

  /**
   * Order Status API — the reconciler for when a customer returns before the
   * webhook lands.
   *
   * VERIFY: the document links to generic documentation rather than giving the
   * response shape. The field reads below are our best reading of it and need
   * confirming against a real sandbox call.
   */
  async getOrderStatus(orderId: string): Promise<OrderStatusResult> {
    const response = await this.get(`/orders/${encodeURIComponent(orderId)}`);

    const raw = typeof response.status === 'string' ? response.status : 'NEW';
    const amount = response.amount;

    return {
      orderId,
      status: normaliseStatus(raw),
      amountPaid: typeof amount === 'number' ? amount : undefined,
      paymentMethod:
        typeof response.payment_method === 'string' ? response.payment_method : undefined,
      raw: response,
    };
  }

  /**
   * VERIFY — THIS IS THE ONE THAT MATTERS.
   *
   * Juspay has not supplied the signature scheme. The implementation below
   * assumes HMAC-SHA256 over the raw body, hex-encoded, which is the common
   * shape — but assuming is not good enough for the check that decides whether
   * a payment notification is genuine.
   *
   * Until Juspay confirm, this client must not be used in production. Spec 15:
   * unsigned payloads are logged and dropped.
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!signature || !this.config.webhookSecret) return false;

    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    const a = Buffer.from(expected);
    const b = Buffer.from(signature.trim().toLowerCase());
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /* ---------------------------------------------------------------- */

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return this.parse(res, path);
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers({ 'x-merchantid': this.config.merchantId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return this.parse(res, path);
  }

  private async parse(res: Response, path: string): Promise<Record<string, unknown>> {
    const text = await res.text();

    if (!res.ok) {
      // Never log the body wholesale — it carries the customer's phone number.
      throw new JuspayApiError(res.status, text, `Juspay ${path} returned ${res.status}`);
    }

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new JuspayApiError(res.status, text, `Juspay ${path} returned a non-JSON body`);
    }
  }
}

/**
 * Juspay's vocabulary, mapped onto ours.
 *
 * The document names VBV_SUCCESSFUL and AUTHORIZED alongside CHARGED. Neither
 * means the money has moved: VBV_SUCCESSFUL is a completed identity check, and
 * AUTHORIZED means approved but not yet captured. Only CHARGED is paid.
 *
 * Both map to PENDING here rather than CHARGED, deliberately. Telling a
 * customer their payment succeeded when it has only been authorised is exactly
 * the error spec 6 calls the worst available to us.
 */
function normaliseStatus(raw: string): JuspayStatus {
  switch (raw.toUpperCase()) {
    case 'CHARGED':
      return 'CHARGED';
    case 'AUTHORIZATION_FAILED':
    case 'AUTHENTICATION_FAILED':
    case 'JUSPAY_DECLINED':
      return 'AUTHORIZATION_FAILED';
    case 'AUTHORIZED':
    case 'VBV_SUCCESSFUL':
    case 'PENDING_VBV':
    case 'STARTED':
      return 'PENDING';
    default:
      return 'NEW';
  }
}
