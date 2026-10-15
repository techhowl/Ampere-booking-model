import { prisma } from '@/lib/db';
import { getModel } from '@/lib/catalog/catalog';
import { FakeJuspayClient, type JuspayClient } from './juspay';
import { RealJuspayClient, type JuspayConfig, type OrderContext } from './real-client';

/**
 * Which Juspay client the app uses.
 *
 * Flip `JUSPAY_ENABLED` to "true" once the credentials arrive and the real
 * client takes over. Nothing else in the application changes: the order route
 * already redirects the customer to whatever URL the client returns, and that
 * URL becomes Juspay's hosted page.
 *
 * Until then the fake drives development, the test suite and the demo —
 * including the full status-resolution and reconciliation path.
 */

let client: JuspayClient | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `JUSPAY_ENABLED is true but ${name} is not set. ` +
        'See docs/juspay/integration-notes.md for what Juspay still owe us.',
    );
  }
  return value;
}

/**
 * The order detail Juspay wants in its session metadata — the basket line, the
 * dealer, the delivery pincode. Read fresh from our own records, never from
 * anything the browser sent.
 */
async function contextFor(orderId: string): Promise<OrderContext> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { orderId },
    include: { dealer: true, lead: true },
  });

  const model = getModel(order.modelCode);

  // amountTotal is the on-road figure. Juspay wants product_price and
  // rto_charges separately in the basket line, so read them back from the
  // price row that was in force when the order was created.
  const price = await prisma.priceBook.findFirst({
    where: {
      modelCode: order.modelCode,
      regionCode: order.regionCode,
      effectiveFrom: { lte: order.createdAt },
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  return {
    customerId: order.leadId,
    /*
     * Juspay requires customer_email and our form does not ask for one. A
     * per-order synthetic address keeps it unique and inert — it must never
     * collide with a real mailbox, so the domain is one we control and the
     * local part is the order id.
     *
     * JUSPAY_RECEIPT_DOMAIN exists so this can be pointed at a real inbox if
     * Ampere decides it wants Juspay's receipts.
     */
    customerEmail: `order-${order.orderId.toLowerCase()}@${
      process.env.JUSPAY_RECEIPT_DOMAIN ?? 'orders.ampere-electric.com'
    }`,
    modelName: model?.name ?? order.modelCode,
    productPrice: price ? price.amountTotal.toNumber() : order.amountTotal.toNumber(),
    rtoCharges: price ? price.rtoCharges.toNumber() : 0,
    totalAmount: order.amountTotal.toNumber(),
    dealerCode: order.dealer?.dealerCode ?? '',
    dealerName: order.dealer?.name ?? '',
    pincode: order.lead.pincode,
    city: null,
    state: order.lead.stateCode,
  };
}

export function getJuspayClient(): JuspayClient {
  if (client) return client;

  if (process.env.JUSPAY_ENABLED === 'true') {
    const config: JuspayConfig = {
      apiKey: required('JUSPAY_API_KEY'),
      merchantId: required('JUSPAY_MERCHANT_ID'),
      paymentPageClientId: required('JUSPAY_PAYMENT_PAGE_CLIENT_ID'),
      baseUrl: (process.env.JUSPAY_BASE_URL ?? 'https://sandbox.juspay.in').replace(/\/$/, ''),
      webhookUrl: required('JUSPAY_WEBHOOK_URL'),
      webhookUsername: required('JUSPAY_WEBHOOK_USERNAME'),
      webhookPassword: required('JUSPAY_WEBHOOK_PASSWORD'),
    };
    client = new RealJuspayClient(config, contextFor);
    return client;
  }

  client = new FakeJuspayClient();
  return client;
}

/** Tests and the stand-in checkout swap the client here. */
export function setJuspayClient(next: JuspayClient): void {
  client = next;
}

/** The fake, when a caller needs to script an outcome. Null in production. */
export function getFakeJuspayClient(): FakeJuspayClient | null {
  const current = getJuspayClient();
  return current instanceof FakeJuspayClient ? current : null;
}
