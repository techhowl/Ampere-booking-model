import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveForReturn } from '@/lib/orders/resolve-status';
import { getJuspayClient } from '@/lib/juspay/client';

/**
 * GET /api/orders/[orderId]/status — the resolved status.
 *
 * Spec 9: the browser is never trusted for this. The stored webhook result is
 * checked first, then Juspay's own servers. If neither answers, the response is
 * `unknown`, and the UI shows "confirming your payment" and polls rather than
 * guessing at someone's money.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  const outcome = await resolveForReturn(prisma, getJuspayClient(), orderId);
  if (!outcome) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json(outcome, { headers: { 'Cache-Control': 'no-store' } });
}
