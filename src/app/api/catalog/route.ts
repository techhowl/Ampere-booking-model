import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { buildCatalog } from '@/lib/catalog/availability';
import { resolvePincode } from '@/lib/dealers/resolve';
import { findNearbyDealers } from '@/lib/dealers/nearby';
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

  let regionCode: string | null = null;
  let dealer = null;
  let dealerCodes: string[] = [];

  if (pincode) {
    if (!isValidPincode(pincode)) {
      return NextResponse.json(
        { error: 'invalid_pincode', message: 'Enter a valid 6-digit pincode' },
        { status: 400 },
      );
    }
    const location = await resolvePincode(prisma, pincode);
    regionCode = location.regionCode;
    dealer = location.dealer;

    // Only dealers within the radius. Nothing further away can fulfil, so
    // nothing further away may contribute stock.
    const nearby = await findNearbyDealers(prisma, pincode);
    dealerCodes = nearby.dealers.map((d) => d.code);
  }

  const models = await buildCatalog(prisma, regionCode, dealerCodes);

  return NextResponse.json(
    {
      region: regionCode,
      dealer,
      models,
      // A customer outside every region we cover can still be a lead and can
      // still book a test ride; they just cannot be sold to online.
      serviceable: regionCode !== null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
