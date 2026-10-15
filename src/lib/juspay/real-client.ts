import { randomUUID, timingSafeEqual } from 'node:crypto';
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
 * Built against two Juspay sources, which do not fully agree:
 *   - Hyper Checkout (web): /session, /orders/{id}, auth and webhook docs.
 *     This is the authority for transport — headers, status vocabulary and
 *     how a webhook is authenticated.
 *   - Hypercredit: the consumer-finance extensions on the same /session call
 *     — order_basket, payment_rules, dealer metadata, the TVS Credit journey.
 *
 * NOT YET RUN AGAINST A LIVE ACCOUNT. What is still outstanding:
 *   - credentials (API key, merchant id, payment_page_client_id)
 *   - whether order_id may contain hyphens; Juspay says "alphanumeric"
 *   - customer_email is mandatory and our form does not collect one
 *   - whether full payment also requires an explicit Capture call
 *
 * Until credentials arrive `getJuspayClient()` returns the fake.
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
  /** Where Juspay's servers notify us. Absolute, HTTPS, publicly reachable. */
  webhookUrl: string;
  /**
   * The Basic-auth pair we set on the Juspay dashboard, under
   * Payments → Settings → Webhook. Juspay sends it back on every webhook and
   * it is the whole of our authenticity check — guard it like a password.
   *
   * Juspay rejects these characters in the username: @!#$%&'*+-/=?^_.{|}~
   */
  webhookUsername: string;
  webhookPassword: string;
}

export interface OrderContext {
  customerId: string;
  /**
   * Juspay marks customer_email mandatory on /session. Our form deliberately
   * asks for name, phone and pincode only, so this is a synthetic per-order
   * address unless Ampere decides to collect a real one.
   *
   * Consequence to be aware of: Juspay's own receipt goes nowhere. Our
   * confirmation is then the only thing the customer receives.
   */
  customerEmail: string;
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

  /**
   * Juspay authenticates server calls with HTTP Basic, where the API key is
   * the USERNAME and the password is empty — hence the trailing colon. Sending
   * the bare key (which an earlier draft of this file did) fails with 401.
   */
  private authorization(): string {
    return `Basic ${Buffer.from(`${this.config.apiKey}:`).toString('base64')}`;
  }

  /**
   * `x-routing-id` shards traffic on Juspay's side and must be the same value
   * for every call about one customer. `x-merchantid` is required on every
   * endpoint.
   */
  private headers(routingId: string, extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: this.authorization(),
      'x-merchantid': this.config.merchantId,
      'x-routing-id': routingId,
      'Content-Type': 'application/json',
      // Mandatory per the Hypercredit document, and our idempotency handle on
      // their side.
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
      customer_email: ctx.customerEmail,
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

    const response = await this.post('/session', body, ctx.customerId);

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
   * Order Status API — GET /orders/{order_id}. The reconciler for when a
   * customer returns before the webhook lands.
   *
   * Shape confirmed against Juspay's Hyper Checkout documentation: `status`
   * carries the vocabulary normaliseStatus maps, `amount` is the order total
   * and `payment_method` the instrument used.
   */
  async getOrderStatus(orderId: string): Promise<OrderStatusResult> {
    /* Routing must stay consistent per customer, so reuse the id the session
       was created with. A context lookup should not be able to break status
       resolution, so fall back to the order id. */
    let routingId = orderId;
    try {
      routingId = (await this.contextFor(orderId)).customerId;
    } catch {
      // Keep the fallback.
    }

    const response = await this.get(`/orders/${encodeURIComponent(orderId)}`, routingId);

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
   * Is this webhook genuinely from Juspay?
   *
   * There is no signature. Juspay's documented scheme is plain HTTP Basic
   * auth: they send `Authorization: Basic base64(username:password)` using the
   * pair we configured on their dashboard, and our only job is to compare it
   * with what we expect.
   *
   * That is weaker than an HMAC — the credential is replayable by anyone who
   * sees it — which is exactly why the endpoint must be HTTPS-only and the
   * password must be long and random. Spec 15: unverified payloads are
   * recorded and dropped, never acted on.
   *
   * `rawBody` is unused and kept so the interface can accommodate a signature
   * scheme later without a change at every call site.
   */
  verifyWebhook(_rawBody: string, authHeader: string): boolean {
    const { webhookUsername, webhookPassword } = this.config;
    if (!authHeader || !webhookUsername || !webhookPassword) return false;

    const expected = `Basic ${Buffer.from(`${webhookUsername}:${webhookPassword}`).toString('base64')}`;

    /* Constant-time compare. Lengths are compared first because
       timingSafeEqual throws on a mismatch, and the length of a rejected
       credential is not a useful secret. */
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(authHeader.trim(), 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /* ---------------------------------------------------------------- */

  private async post(
    path: string,
    body: unknown,
    routingId: string,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(routingId),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return this.parse(res, path);
  }

  private async get(path: string, routingId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'GET',
      // The Order Status API is form-encoded, unlike /session. Sending
      // application/json here gets the request rejected.
      headers: this.headers(routingId, {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
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
    /* Money has moved. */
    case 'CHARGED': // 21
      return 'CHARGED';

    /* Over, and no money moved. Each of these is a dead end: the customer
       must start a new attempt, so saying "failed" is both true and useful. */
    case 'AUTHORIZATION_FAILED': // 27 — bank refused
    case 'AUTHENTICATION_FAILED': // 26 — customer abandoned the OTP/3DS step
    case 'JUSPAY_DECLINED': // 22 — integration error on our side
    case 'CAPTURE_FAILED': // 34
    case 'VOID_FAILED': // 35
    case 'VOIDED': // 31 — authorisation released
      return 'AUTHORIZATION_FAILED';

    /* In flight. Keep polling; show "confirming your payment". */
    case 'PENDING_VBV': // 23 — 3DS/VKYC in progress
    case 'AUTHORIZING': // 28 — bank has not answered
    case 'STARTED': // 20
    case 'CAPTURE_INITIATED': // 33
    case 'VOID_INITIATED': // 32
    case 'AUTO_REFUNDED': // 36 — refund in flight after a timeout
    case 'VBV_SUCCESSFUL': // identity check done, money untouched
      return 'PENDING';

    /*
     * AUTHORIZED (25) — funds held, NOT captured. In an auth-and-capture flow
     * this obliges us to call Capture; until we do, no money has moved.
     * Mapping it to PENDING is deliberately conservative: it can never show a
     * customer a confirmation for money we have not taken.
     *
     * It is still not the right answer. PENDING means "wait and it will
     * resolve itself", and this one will not — it waits on US. Making that
     * visible needs an `authorized` member on ResolvedStatus, which is a
     * change to the status resolution the spec fixes, so it is flagged in
     * docs/juspay/integration-notes.md rather than made here.
     *
     * PARTIAL_CHARGED (37) — less was debited than the order asked for. Never
     * treat it as paid: the amount check would be the only thing standing
     * between a part-paid order and a delivered scooter.
     *
     * NOT_FOUND (40) — Juspay has no such order. Pending keeps us polling
     * rather than failing an order that may simply not have reached them yet.
     */
    case 'AUTHORIZED':
    case 'PARTIAL_CHARGED':
    case 'NOT_FOUND':
      return 'PENDING';

    case 'NEW': // 10 — created, nothing attempted
      return 'NEW';

    default:
      /* An unknown status must never read as success or failure. NEW resolves
         to pending, so a vocabulary change at Juspay degrades to polling. */
      return 'NEW';
  }
}
