import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { catalogForPincode } from '@/lib/catalog/availability';
import { isValidPincode } from '@/lib/phone-format';

/**
 * GET /api/catalog?pincode=560001
 *
 * Models, colours and prices. The pincode is optional: without one the line-up
 * still renders, just without prices or stock.
 *
 * Price is keyed on region; stock is keyed on DEALER, so the pincode also
 * decides which showrooms count. A model is purchasable while any dealer in
 * range still has a unit, and stops being purchasable the moment none does —
 * which is what takes the buy button down and leaves the test ride up.
 *
 * Prices come from price_book, resolved here. The client never sends an amount
 * and is never asked to compute one.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const pincode = request.nextUrl.searchParams.get('pincode')?.trim() ?? '';

  if (pincode && !isValidPincode(pincode)) {
    return NextResponse.json(
      { error: 'invalid_pincode', message: 'Enter a valid 6-digit pincode' },
      { status: 400 },
    );
  }

  const catalog = await catalogForPincode(prisma, pincode || null);

  return NextResponse.json(catalog, { headers: { 'Cache-Control': 'no-store' } });
}
