import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { recordWebhook } from '@/lib/orders/resolve-status';
import { getJuspayClient } from '@/lib/juspay/client';

/**
 * POST /api/webhooks/juspay — the source of truth.
 *
 * Spec 9: this survives the customer closing the browser, which matters
 * because UPI switches them into another app and EMI routes through their
 * bank. Both drop browser sessions routinely.
 *
 * Always returns 200. Juspay re-sends until it gets one, and retrying a
 * payload we have already stored helps nobody — delivery is at-least-once, so
 * recordWebhook is idempotent. Unverified payloads are recorded and dropped
 * per spec 15: the row in payment_events IS the log.
 *
 * Authenticity is HTTP Basic auth, not a signature — Juspay replays the
 * username and password we set on their dashboard. That credential is
 * replayable by anyone who sees it, which is why this endpoint is HTTPS-only.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const authHeader = request.headers.get('authorization') ?? '';

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Juspay nests the order under `content`; accept either shape so a change in
  // their envelope does not silently drop every event.
  const content = (payload.content ?? payload) as Record<string, unknown>;
  const order = (content.order ?? content) as Record<string, unknown>;
  const orderId = typeof order.order_id === 'string' ? order.order_id : null;
  const status = typeof order.status === 'string' ? order.status : null;

  if (!orderId || !status) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const signatureValid = getJuspayClient().verifyWebhook(rawBody, authHeader);
  const amount = order.amount;

  await recordWebhook(prisma, {
    orderId,
    eventType: typeof payload.event_name === 'string' ? payload.event_name : null,
    signatureValid,
    payload,
    status,
    amountPaid: typeof amount === 'number' ? amount : null,
  });

  return NextResponse.json({ received: true }, { status: 200 });
}
