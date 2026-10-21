import type { PrismaClient, OrderStatus } from '@prisma/client';
import { convert, release } from '@/lib/inventory/inventory';
import {
  mapJuspayStatus,
  nextStatus,
  resolveOnReturn,
  type JuspayClient,
  type ResolvedStatus,
} from '@/lib/juspay/juspay';

/**
 * Turning a Juspay signal into our order status, and acting on it.
 *
 * The rules this enforces, all from spec 9:
 *
 *   - the webhook is the source of truth; the status API reconciles; the
 *     return URL is navigation and nothing more
 *   - `paid` is TERMINAL. No webhook, however late or out of order, downgrades
 *     a paid order
 *   - we never guess. An unresolved status is `unknown`, and the UI says
 *     "confirming your payment" and polls
 *
 * Inventory moves with the status, once: `convert()` on paid, `release()` on
 * failed. Both are idempotent, because webhooks arrive more than once.
 */

/** Our stored enum and the resolver's vocabulary are not quite the same. */
function toResolved(status: OrderStatus): ResolvedStatus {
  if (status === 'paid') return 'paid';
  if (status === 'failed' || status === 'expired') return 'failed';
  if (status === 'pending' || status === 'initiated') return 'pending';
  return 'pending';
}

function toStored(status: ResolvedStatus): OrderStatus | null {
  if (status === 'paid') return 'paid';
  if (status === 'failed') return 'failed';
  if (status === 'pending') return 'pending';
  return null; // `unknown` is not a state we persist.
}

export interface StatusOutcome {
  orderId: string;
  status: ResolvedStatus;
  source: 'webhook' | 'status_api' | 'none';
  amountCharged: string;
  amountPaid: string | null;
  /** The on-road price. */
  amountTotal: string;
  /** What is left to pay at the dealer after a partial payment; null otherwise. */
  balanceDue: string | null;
  paymentType: string;
  modelCode: string;
  colourCode: string | null;
  dealer: { code: string; name: string; phone: string | null } | null;
}

/**
 * Apply an incoming status to an order and move stock accordingly.
 *
 * Returns the status actually stored, which may not be the one supplied — a
 * late `pending` after a `paid` changes nothing.
 */
export async function applyStatus(
  prisma: PrismaClient,
  orderId: string,
  incoming: ResolvedStatus,
  source: 'webhook' | 'status_api',
  detail?: { amountPaid?: number | null; raw?: string | null },
): Promise<ResolvedStatus> {
  const order = await prisma.order.findUnique({ where: { orderId } });
  if (!order) return 'unknown';

  const current = toResolved(order.status);
  const settled = nextStatus(current, incoming);

  // Nothing changed — a duplicate webhook, or one that arrived out of order.
  if (settled === current && order.status !== 'initiated') return settled;

  const stored = toStored(settled);
  if (!stored) return settled;

  await prisma.order.update({
    where: { orderId },
    data: {
      status: stored,
      statusSource: source,
      juspayStatusRaw: detail?.raw ?? order.juspayStatusRaw,
      amountPaid:
        settled === 'paid' && detail?.amountPaid != null
          ? detail.amountPaid
          : order.amountPaid,
      paidAt: settled === 'paid' ? (order.paidAt ?? new Date()) : order.paidAt,
    },
  });

  // Stock follows the money, once. Both calls are idempotent.
  if (settled === 'paid' && current !== 'paid') await convert(prisma, orderId);
  if (settled === 'failed' && current !== 'failed') await release(prisma, orderId);

  return settled;
}

/**
 * The customer has landed back on our return URL.
 *
 * Every field in that query string except the order id is ignored — they are
 * attacker-controlled, and the amount on a confirmation screen must never come
 * from them.
 */
export async function resolveForReturn(
  prisma: PrismaClient,
  juspay: JuspayClient,
  orderId: string,
): Promise<StatusOutcome | null> {
  const order = await prisma.order.findUnique({
    where: { orderId },
    include: { dealer: true },
  });
  if (!order) return null;

  const stored = toResolved(order.status);

  const resolution = await resolveOnReturn(juspay, {
    orderId,
    status: stored,
    statusSource: order.statusSource === 'status_api' ? 'status_api' : 'webhook',
  });

  // Only persist something the status API actually told us. `unknown` means we
  // could not reach Juspay, and guessing is the one thing we must not do.
  let settled = resolution.status;
  if (resolution.source === 'status_api' && settled !== 'unknown') {
    settled = await applyStatus(prisma, orderId, settled, 'status_api');
  }

  const fresh = await prisma.order.findUniqueOrThrow({
    where: { orderId },
    include: { dealer: true },
  });

  return {
    orderId,
    status: settled,
    source: resolution.source,
    amountCharged: fresh.amountCharged.toFixed(2),
    amountPaid: fresh.amountPaid?.toFixed(2) ?? null,
    amountTotal: fresh.amountTotal.toFixed(2),
    balanceDue:
      fresh.paymentType === 'partial'
        ? fresh.amountTotal.minus(fresh.amountCharged).toFixed(2)
        : null,
    paymentType: fresh.paymentType,
    modelCode: fresh.modelCode,
    colourCode: fresh.colourCode,
    dealer: fresh.dealer
      ? { code: fresh.dealer.dealerCode, name: fresh.dealer.name, phone: fresh.dealer.phone }
      : null,
  };
}

/**
 * The webhook path. Signature is verified by the caller; this records the raw
 * payload before interpreting it, so a dispute in month four has an answer.
 */
export async function recordWebhook(
  prisma: PrismaClient,
  params: {
    orderId: string;
    eventType: string | null;
    signatureValid: boolean;
    payload: unknown;
    status: string;
    amountPaid?: number | null;
  },
): Promise<ResolvedStatus> {
  await prisma.paymentEvent.create({
    data: {
      orderId: params.orderId,
      eventType: params.eventType,
      signatureValid: params.signatureValid,
      rawPayload: params.payload as never,
    },
  });

  // Spec 15: unsigned payloads are logged and dropped. The row above is the log.
  if (!params.signatureValid) return 'unknown';

  const incoming = mapJuspayStatus(params.status as never);
  return applyStatus(prisma, params.orderId, incoming, 'webhook', {
    amountPaid: params.amountPaid ?? null,
    raw: params.status,
  });
}
