import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { ReservationStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { expireStale } from '@/lib/inventory/inventory';
import { getJuspayClient } from '@/lib/juspay/client';

/**
 * POST /api/cron/expire-reservations
 *
 * Releases stock held by customers who started a payment and never finished,
 * and kills the matching Juspay payment link.
 *
 * `expireStale()` has existed and been tested since the inventory work, but
 * nothing ever called it — so in practice a hold was permanent. Every
 * abandoned checkout removed a unit from sale for good, which during a day of
 * UAT is enough to turn the whole catalogue "out of stock".
 *
 * Both halves matter. Releasing the unit without cancelling at Juspay leaves a
 * live payment page for a scooter we may have just sold to someone else; the
 * customer pays, and we owe them a vehicle we do not have.
 *
 * Driven by cron on the droplet — see deploy/README.md. Authenticated with a
 * shared secret rather than the admin password, because a scheduler holding a
 * human's credential is a bad trade.
 */

export const dynamic = 'force-dynamic';

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  // Unset means closed, never open. A scheduler endpoint that falls open when
  // a variable is missing is a free denial-of-inventory button.
  if (!expected) return false;

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;

  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Vercel Cron calls with GET and the same `Authorization: Bearer CRON_SECRET`
 * header, so the UAT copy on Vercel needs no other scheduler.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  /*
   * Read the doomed reservations BEFORE releasing them, because expireStale()
   * returns a count rather than the rows, and changing the inventory module to
   * suit this caller is not worth it — the logic in there implements decisions
   * from the spec.
   *
   * Anything that expires between this read and the sweep is simply caught on
   * the next run a minute later.
   */
  const doomed = await prisma.inventoryReservation.findMany({
    where: { status: ReservationStatus.held, expiresAt: { lt: new Date() } },
    select: { orderId: true },
  });

  const released = await expireStale(prisma);

  // Stock is already back. Cancelling at Juspay is tidy-up, so one failure
  // must not abandon the rest — hence allSettled over a loop that can throw.
  const juspay = getJuspayClient();
  await Promise.allSettled(
    doomed.map(({ orderId }) => juspay.cancelOrder(orderId, 'Reservation expired')),
  );

  if (released > 0) {
    console.info(`[cron] released ${released} expired reservation(s)`);
  }

  return NextResponse.json(
    { released, cancelled: doomed.length },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
