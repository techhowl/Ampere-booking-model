import { Prisma, type PaymentType, type PrismaClient } from '@prisma/client';
import { resolvePrice } from '@/lib/pricing/price';
import { resolvePincode } from '@/lib/dealers/resolve';
import { getModel } from '@/lib/catalog/catalog';
import { OutOfStockError, reserve } from '@/lib/inventory/inventory';
import type { JuspayClient } from '@/lib/juspay/juspay';
import { decryptPhone } from '@/lib/crypto/phone';

/**
 * Creating an order and handing the customer to Juspay.
 *
 * Spec 12, rule 1: "Amounts are computed server-side from price_book. The
 * client sends selections, never money." The request carries a model, a colour
 * and which of the three payment options they chose. Every rupee below is read
 * from the database.
 *
 * Spec 12, rule 2: `order_id` is reused on retry, so one intent never becomes
 * two orders — and `reserve()` is idempotent on it, so a retry never takes a
 * second unit.
 */

export type { PaymentType };

export class OrderError extends Error {
  constructor(
    readonly reason:
      | 'lead_not_found'
      | 'not_verified'
      | 'unknown_model'
      | 'no_price'
      | 'partial_unavailable'
      | 'out_of_stock',
    message: string,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

export interface CreateOrderInput {
  leadId: string;
  modelCode: string;
  colourCode?: string | null;
  paymentType: PaymentType;
  /** What the EMI widget displayed, stored for disputes. */
  emiContext?: Record<string, unknown> | null;
}

export interface CreatedOrder {
  orderId: string;
  redirectUrl: string;
  /** The vehicle's on-road price. */
  amountTotal: string;
  /** What Juspay collects now — the deposit for `partial`, the lot otherwise. */
  amountCharged: string;
  paymentType: PaymentType;
  reservationExpiresAt: string;
}

/** Short, readable, and unmistakably ours in Juspay's dashboard. */
function newOrderId(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `AMP-${stamp}-${noise}`;
}

export async function createOrder(
  prisma: PrismaClient,
  juspay: JuspayClient,
  input: CreateOrderInput,
  returnUrl: string,
): Promise<CreatedOrder> {
  const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) throw new OrderError('lead_not_found', 'Enter your details before paying.');

  // Spec 4: OTP gates progress. Money is firmly past that gate.
  if (!lead.phoneVerified) {
    throw new OrderError('not_verified', 'Please verify your mobile number first.');
  }

  const model = getModel(input.modelCode);
  if (!model) throw new OrderError('unknown_model', 'We could not find that model.');

  const location = await resolvePincode(prisma, lead.pincode);
  if (!location.regionCode) {
    throw new OrderError('no_price', 'We do not sell online in your area yet.');
  }

  const price = await resolvePrice(prisma, model.code, location.regionCode);
  if (!price) {
    throw new OrderError('no_price', 'We do not have a price for that model in your area.');
  }

  /*
   * The three options differ only in what Juspay collects now.
   *
   *   full     the on-road price
   *   emi      the on-road price, financed — Juspay surfaces the plans
   *   partial  the booking amount, balance settled at the dealer
   */
  let amountCharged: Prisma.Decimal;
  if (input.paymentType === 'partial') {
    if (!price.partial) {
      throw new OrderError(
        'partial_unavailable',
        'The booking amount has not been set yet.',
      );
    }
    amountCharged = price.partial.amount;
  } else {
    amountCharged = price.onRoad;
  }

  const colourCode =
    input.colourCode && model.colours.some((c) => c.code === input.colourCode)
      ? input.colourCode
      : null;

  // Reuse the order for a retry of the same intent rather than opening another.
  const existing = await prisma.order.findFirst({
    where: {
      leadId: lead.id,
      modelCode: model.code,
      paymentType: input.paymentType,
      status: { in: ['initiated', 'pending', 'failed'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  const orderId = existing?.orderId ?? newOrderId();

  // Hold a unit BEFORE the customer leaves to pay. Idempotent on orderId, so a
  // retry re-arms the same hold rather than taking a second scooter.
  let reservation: { expiresAt: Date };
  try {
    reservation = await reserve(prisma, {
      orderId,
      modelCode: model.code,
      regionCode: location.regionCode,
    });
  } catch (error) {
    if (error instanceof OutOfStockError) {
      throw new OrderError('out_of_stock', `${model.name} is out of stock in your area.`);
    }
    throw error;
  }

  const common = {
    leadId: lead.id,
    dealerCode: location.dealer?.code ?? null,
    modelCode: model.code,
    colourCode,
    regionCode: location.regionCode,
    paymentType: input.paymentType,
    amountTotal: price.onRoad,
    amountCharged,
    emiContext: (input.emiContext ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  };

  if (existing) {
    await prisma.order.update({
      where: { orderId },
      data: { ...common, status: 'initiated', retryCount: { increment: 1 } },
    });
  } else {
    await prisma.order.create({ data: { orderId, ...common } });
  }

  const session = await juspay.createOrder({
    orderId,
    amount: amountCharged.toNumber(),
    // Decrypted here and nowhere else — Juspay needs somewhere to send the
    // payment link. It is never logged and never returned to the browser.
    customerPhone: decryptPhone(lead.phoneEnc),
    returnUrl,
    paymentIntent: input.paymentType,
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      intent: 'buy',
      modelCode: model.code,
      colourCode,
      dealerCode: location.dealer?.code ?? null,
      status: 'payment_started',
    },
  });

  return {
    orderId,
    redirectUrl: session.redirectUrl,
    amountTotal: price.onRoad.toFixed(2),
    amountCharged: amountCharged.toFixed(2),
    paymentType: input.paymentType,
    reservationExpiresAt: reservation.expiresAt.toISOString(),
  };
}
