import { NextResponse, type NextRequest } from 'next/server';
import { isActive } from '@/lib/crypto/session';
import { clearSession, readSession, writeSession } from '@/lib/http/session';
import { JOURNEY_COOKIE } from '@/app/buy/journey-state';

/**
 * POST   /api/session — "still here". Moving between steps is activity even
 *                       when no step saves anything, so the page calls this on
 *                       each step and when the tab comes back into view. A
 *                       journey that has already timed out is NOT revived:
 *                       the answer is { active: false } and the page asks
 *                       for the OTP again.
 * DELETE /api/session — "Not you? Start over". Forgets this browser's lead and
 *                       journey, for a shared phone.
 *
 * Both are idempotent by nature, so neither needs an Idempotency-Key.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = readSession(request);
  if (!session || !isActive(session)) {
    return NextResponse.json({ active: false, verified: false }, { headers: noStore });
  }
  return writeSession(
    NextResponse.json({ active: true, verified: session.verified }, { headers: noStore }),
    session,
  );
}

export async function DELETE() {
  const response = clearSession(NextResponse.json({ ended: true }, { headers: noStore }));
  response.cookies.set(JOURNEY_COOKIE, '', { path: '/buy', maxAge: 0 });
  return response;
}

const noStore = { 'Cache-Control': 'no-store' };
