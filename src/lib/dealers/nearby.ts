import { Prisma, type PrismaClient } from '@prisma/client';
import { resolvePincode, type ResolvedDealer } from './resolve';

/**
 * The dealers a customer can choose between, for one pincode.
 *
 * Up to three, nearest first, within DEALER_RADIUS_KM of the pincode's centre.
 * Never padded: two dealers in range means two cards, not two plus a stranger.
 *
 * NOTHING OUTSIDE THE RADIUS IS EVER OFFERED. An earlier version fell back to
 * "the closest three at any distance" when nothing was in range, on the theory
 * that some answer beats none. It does not: for a Mumbai pincode that shows an
 * Ahmedabad showroom, which reads as a mistake, and a customer who books
 * against it has to be rung up and told no.
 *
 * So an empty list is a real answer. The journey treats it as "we cannot sell
 * here yet" and offers a test ride instead, with the lead already captured for
 * someone to follow up.
 *
 * Distance is straight-line (haversine), not driving distance. Good enough to
 * rank three showrooms; not something to quote as a journey.
 */

/**
 * One setting. Change it here and the step's copy follows.
 *
 * 25km is a city-scale radius: it covers Mumbai end to end and Bengaluru's
 * ring, without reaching the next city. Above about 30 the nearest "local"
 * dealer stops being local.
 */
export const DEALER_RADIUS_KM = 25;

export const MAX_DEALER_CHOICES = 3;

export interface NearbyDealer extends ResolvedDealer {
  /** Kilometres from the pincode's centre, one decimal. Null when unknown. */
  distanceKm: number | null;
}

/**
 *   radius   every dealer listed is within radiusKm. An empty list here means
 *            we genuinely do not serve this pincode yet.
 *   region   no coordinates for this pincode, so distance could not be
 *            computed; the region's dealers instead, without distances.
 *
 * 'nearest' is gone on purpose. It existed to avoid an empty list and bought
 * that with dealers in other cities.
 */
export type NearbyBasis = 'radius' | 'region';

export interface NearbyDealers {
  pincode: string;
  radiusKm: number;
  basis: NearbyBasis;
  dealers: NearbyDealer[];
}

interface DistanceRow {
  dealer_code: string;
  name: string;
  phone: string | null;
  address: string | null;
  home_serviceable: boolean;
  distance_km: number;
}

export async function findNearbyDealers(
  prisma: PrismaClient,
  pincode: string,
  radiusKm: number = DEALER_RADIUS_KM,
): Promise<NearbyDealers> {
  const geo = await prisma.pincodeGeo.findUnique({ where: { pincode } });

  if (geo) {
    const closest = await closestDealers(prisma, geo.lat, geo.lng);
    if (closest.length > 0) {
      /* Hard cut. Out of range is out of range — see the note above about
         offering Ahmedabad to a Mumbai customer. */
      const inRange = closest.filter((d) => d.distance_km <= radiusKm);
      return { pincode, radiusKm, basis: 'radius', dealers: inRange.map(fromRow) };
    }
    // No dealer has coordinates yet. The region still knows who serves it.
  }

  return { pincode, radiusKm, basis: 'region', dealers: await regionDealers(prisma, pincode) };
}

/** Whether this dealer is one we would offer for this pincode right now. */
export async function findOfferedDealer(
  prisma: PrismaClient,
  pincode: string,
  dealerCode: string,
): Promise<NearbyDealer | null> {
  const { dealers } = await findNearbyDealers(prisma, pincode);
  return dealers.find((d) => d.code === dealerCode) ?? null;
}

/* ------------------------------------------------------------------ */

/**
 * The three closest active dealers, at any distance. The caller filters to the
 * radius; this is deliberately unfiltered so the ordering is done once in SQL.
 *
 * Computed in Postgres over the whole dealer table. That is a few hundred rows
 * at most; a bounding-box prefilter would be premature.
 */
function closestDealers(prisma: PrismaClient, lat: number, lng: number) {
  return prisma.$queryRaw<DistanceRow[]>(Prisma.sql`
    SELECT dealer_code, name, phone, address, home_serviceable, distance_km
    FROM (
      SELECT d.*,
        2 * 6371 * asin(least(1, sqrt(
          power(sin(radians(d.lat - ${lat}) / 2), 2) +
          cos(radians(${lat})) * cos(radians(d.lat)) *
          power(sin(radians(d.lng - ${lng}) / 2), 2)
        ))) AS distance_km
      FROM dealers d
      WHERE d.active AND d.lat IS NOT NULL AND d.lng IS NOT NULL
    ) ranked
    ORDER BY distance_km, dealer_code
    LIMIT ${MAX_DEALER_CHOICES}
  `);
}

/**
 * No coordinates for this pincode, so distance is not available. Fall back to
 * dealers serving the same POSTAL DISTRICT — the first three digits.
 *
 * Not the region. A region is enormous: "west" holds Mumbai and Ahmedabad, so
 * a region fallback offered an Ahmedabad showroom to a customer in Andheri.
 * The first three digits of an Indian pincode are a sorting district — 400xxx
 * is Mumbai, 380xxx is Ahmedabad — which is roughly city-sized and separates
 * exactly the cases that embarrassed us.
 *
 * This is a stopgap. The real fix is coordinates for every pincode, which
 * `pnpm db:import-pincodes` loads; with those, this branch stops being
 * reached at all.
 */
async function regionDealers(prisma: PrismaClient, pincode: string): Promise<NearbyDealer[]> {
  const location = await resolvePincode(prisma, pincode);
  if (!location.regionCode) return [];

  const district = pincode.slice(0, 3);
  const first = location.dealer ? [{ ...location.dealer, distanceKm: null }] : [];

  const others = await prisma.dealer.findMany({
    where: {
      active: true,
      // Serves at least one pincode in the same sorting district.
      pincodeMap: { some: { pincode: { startsWith: district } } },
      ...(location.dealer ? { dealerCode: { not: location.dealer.code } } : {}),
    },
    orderBy: { dealerCode: 'asc' },
    take: MAX_DEALER_CHOICES - first.length,
  });

  return [
    ...first,
    ...others.map((d) => ({
      code: d.dealerCode,
      name: d.name,
      phone: d.phone,
      address: d.address,
      homeServiceable: d.homeServiceable,
      distanceKm: null,
    })),
  ];
}

function fromRow(row: DistanceRow): NearbyDealer {
  return {
    code: row.dealer_code,
    name: row.name,
    phone: row.phone,
    address: row.address,
    homeServiceable: row.home_serviceable,
    distanceKm: Math.round(row.distance_km * 10) / 10,
  };
}
