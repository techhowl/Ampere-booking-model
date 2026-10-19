import type { PrismaClient } from '@prisma/client';
import { getRegion, regionForPincodeZone } from '@/lib/catalog/catalog';

/**
 * Pincode to dealer and region.
 *
 * The region is what inventory and the price book are keyed on, so this lookup
 * gates whether a customer can buy at all. The dealer is who gets the call.
 *
 * Spec 7: "If a pincode maps to no active dealer, fall back to the nearest
 * serviceable dealer rather than dead-ending the customer."
 */

export interface ResolvedDealer {
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  homeServiceable: boolean;
}

export interface PincodeResolution {
  pincode: string;
  stateCode: string | null;
  regionCode: string | null;
  regionName: string | null;
  dealer: ResolvedDealer | null;
  /** We know the region and have a dealer for it. */
  serviceable: boolean;
  /**
   * True when the mapped dealer was missing or inactive and we substituted
   * another in the same region, or when the region itself was derived from the
   * pincode's postal zone rather than read from pincode_map. Worth showing in
   * admin — a region relying on fallbacks means the dealer master needs
   * attention.
   */
  usedFallback: boolean;
}

const UNSERVICEABLE = (pincode: string): PincodeResolution => ({
  pincode,
  stateCode: null,
  regionCode: null,
  regionName: null,
  dealer: null,
  serviceable: false,
  usedFallback: false,
});

export async function resolvePincode(
  prisma: PrismaClient,
  pincode: string,
): Promise<PincodeResolution> {
  const mapping = await prisma.pincodeMap.findUnique({
    where: { pincode },
    include: { dealer: true },
  });

  // An unmapped pincode is not a dead end. India's PIN zones tell us the region
  // from the first digit, so we can still price and still find a dealer. Only a
  // pincode outside every civilian zone (9xxxxx is Army Postal) gives up.
  if (!mapping) return resolveByZone(prisma, pincode);

  const region = getRegion(mapping.regionCode);

  const mapped = mapping.dealer;
  if (mapped?.active) {
    return {
      pincode,
      stateCode: mapping.stateCode,
      regionCode: mapping.regionCode,
      regionName: region?.name ?? null,
      dealer: toResolved(mapped),
      serviceable: true,
      usedFallback: false,
    };
  }

  // No dealer, or the mapped one is closed. Substitute another in the region
  // rather than dead-ending the customer.
  const fallback = await prisma.dealer.findFirst({
    where: {
      active: true,
      pincodeMap: { some: { regionCode: mapping.regionCode } },
    },
    orderBy: { dealerCode: 'asc' },
  });

  return {
    pincode,
    stateCode: mapping.stateCode,
    regionCode: mapping.regionCode,
    regionName: region?.name ?? null,
    dealer: fallback ? toResolved(fallback) : null,
    serviceable: fallback !== null,
    usedFallback: fallback !== null,
  };
}

/**
 * No row in pincode_map. Derive the region from the postal zone and attach any
 * active dealer serving it. Marked as a fallback so admin can see which leads
 * were resolved this way.
 */
async function resolveByZone(
  prisma: PrismaClient,
  pincode: string,
): Promise<PincodeResolution> {
  const regionCode = regionForPincodeZone(pincode);
  if (!regionCode) return UNSERVICEABLE(pincode);

  const dealer = await prisma.dealer.findFirst({
    where: { active: true, pincodeMap: { some: { regionCode } } },
    orderBy: { dealerCode: 'asc' },
  });

  return {
    pincode,
    stateCode: null,
    regionCode,
    regionName: getRegion(regionCode)?.name ?? null,
    dealer: dealer ? toResolved(dealer) : null,
    // Priced and sellable even without a dealer: the region is what the price
    // book and inventory are keyed on.
    serviceable: true,
    usedFallback: true,
  };
}

/**
 * The dealer a lead is going to.
 *
 * The lead's dealer_code is written with the pincode at save time and replaced
 * when the customer picks one at the dealer step, so it always belongs to the
 * lead's own pincode. Use it while that dealer is still trading; otherwise
 * fall back to whoever covers the pincode today.
 */
export async function dealerForLead(
  prisma: PrismaClient,
  lead: { dealerCode: string | null },
  fallback: ResolvedDealer | null,
): Promise<ResolvedDealer | null> {
  if (!lead.dealerCode) return fallback;
  const chosen = await prisma.dealer.findUnique({ where: { dealerCode: lead.dealerCode } });
  return chosen?.active ? toResolved(chosen) : fallback;
}

function toResolved(dealer: {
  dealerCode: string;
  name: string;
  phone: string | null;
  address: string | null;
  homeServiceable: boolean;
}): ResolvedDealer {
  return {
    code: dealer.dealerCode,
    name: dealer.name,
    phone: dealer.phone,
    address: dealer.address,
    homeServiceable: dealer.homeServiceable,
  };
}
