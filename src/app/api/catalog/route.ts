import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { buildCatalog } from '@/lib/catalog/availability';
import { resolvePincode } from '@/lib/dealers/resolve';
import { isValidPincode } from '@/lib/phone-format';

/**
 * GET /api/catalog?pincode=560001
 *
 * Models, colours and prices. The pincode is optional: without one the line-up
 * still renders, just without prices or stock, because both are keyed on region.
 *
 * Prices come from price_book, resolved here. The client never sends an amount
 * and is never asked to compute one.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const pincode = request.nextUrl.searchParams.get('pincode')?.trim() ?? '';

  let regionCode: string | null = null;
  let dealer = null;

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
  }

  const models = await buildCatalog(prisma, regionCode);

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
