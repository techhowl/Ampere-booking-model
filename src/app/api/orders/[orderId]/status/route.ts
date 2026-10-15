import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveForReturn } from '@/lib/orders/resolve-status';
import { getJuspayClient } from '@/lib/juspay/client';
import { SESSION_COOKIE, parseSession } from '@/lib/crypto/session';

/**
 * GET /api/orders/[orderId]/status — the resolved status.
 *
 * Spec 9: the browser is never trusted for this. The stored webhook result is
 * checked first, then Juspay's own servers. If neither answers, the response is
 * `unknown`, and the UI shows "confirming your payment" and polls rather than
 * guessing at someone's money.
 *
 * The order must belong to the caller.
 *
 * Juspay puts order_id in the return URL, so it is visible to the customer and
 * to anything that sees the URL. Without this check, that id alone would
 * return what was paid, for which scooter, and which dealer is holding it —
 * for ANY order, to anyone who had an id or guessed one. Order ids are
 * timestamp-plus-five-characters, which is not a secret worth resting a
 * payment record on.
 *
 * The continuity cookie is SameSite=Lax, so it survives the top-level
 * navigation back from Juspay, and this route is called same-origin from our
 * own return page. A mismatch returns 404 rather than 403: whether an order
 * exists is itself worth not confirming.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  const session = parseSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const owner = await prisma.order.findUnique({
    where: { orderId },
    select: { leadId: true },
  });
  if (!owner || owner.leadId !== session.leadId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const outcome = await resolveForReturn(prisma, getJuspayClient(), orderId);
  if (!outcome) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json(outcome, { headers: { 'Cache-Control': 'no-store' } });
}
