import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { findNearbyDealers } from '@/lib/dealers/nearby';
import { isValidPincode } from '@/lib/phone-format';
import type { NearbyDealersResponse } from '@/lib/schemas/dealer';

/**
 * GET /api/dealers/nearby?pincode=560038
 *
 * Up to three dealers for the dealer step, nearest first. Read-only, and the
 * same answer for everyone with that pincode, so it caches like the resolver.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const pincode = request.nextUrl.searchParams.get('pincode')?.trim() ?? '';

  if (!isValidPincode(pincode)) {
    return NextResponse.json(
      { error: 'invalid_pincode', message: 'Enter a valid 6-digit pincode' },
      { status: 400 },
    );
  }

  const body: NearbyDealersResponse = await findNearbyDealers(prisma, pincode);

  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=60' } });
}
