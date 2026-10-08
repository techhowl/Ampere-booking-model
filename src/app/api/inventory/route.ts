import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getAvailable } from '@/lib/inventory/inventory';
import { resolvePincode } from '@/lib/dealers/resolve';
import { isValidModelCode } from '@/lib/catalog/catalog';
import { isValidPincode } from '@/lib/phone-format';

/**
 * GET /api/inventory?model=nexus-ex-plus&pincode=560001
 *
 * Availability for one model in the region covering that pincode. Polled by the
 * buy step so a customer who lingers sees stock disappear rather than
 * discovering it at the payment screen.
 *
 * Reports units deliberately: "2 left" converts, and it is also simply true.
 * The staleness flag is NOT exposed — that is an operational signal for admin,
 * not something to worry a customer with.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const modelCode = params.get('model')?.trim() ?? '';
  const pincode = params.get('pincode')?.trim() ?? '';

  if (!isValidModelCode(modelCode)) {
    return NextResponse.json(
      { error: 'invalid_model', message: 'Unknown model' },
      { status: 400 },
    );
  }
  if (!isValidPincode(pincode)) {
    return NextResponse.json(
      { error: 'invalid_pincode', message: 'Enter a valid 6-digit pincode' },
      { status: 400 },
    );
  }

  const location = await resolvePincode(prisma, pincode);
  if (!location.regionCode) {
    return NextResponse.json(
      { modelCode, region: null, available: 0, inStock: false, serviceable: false },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const stock = await getAvailable(prisma, modelCode, location.regionCode);

  return NextResponse.json(
    {
      modelCode,
      region: location.regionCode,
      available: stock.available,
      inStock: stock.available > 0,
      serviceable: true,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
