import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePincode } from '@/lib/dealers/resolve';
import { isValidPincode } from '@/lib/phone-format';

/**
 * GET /api/dealers/resolve?pincode=560001
 *
 * Which dealer covers this pincode, and which region it sits in. The region is
 * what inventory and pricing are keyed on, so the buy journey needs this before
 * it can show anything.
 *
 * Read-only and cheap; the page calls it as the customer types.
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

  const resolution = await resolvePincode(prisma, pincode);

  return NextResponse.json(
    {
      pincode: resolution.pincode,
      region: resolution.regionCode
        ? { code: resolution.regionCode, name: resolution.regionName }
        : null,
      dealer: resolution.dealer,
      serviceable: resolution.serviceable,
    },
    // Pincode mappings change rarely, but a dealer going inactive should show
    // up quickly. A minute is a reasonable compromise.
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
