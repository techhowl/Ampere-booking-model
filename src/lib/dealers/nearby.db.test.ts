import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { resetDatabase } from '../../../test/reset-db';
import { findNearbyDealers, findOfferedDealer } from './nearby';

const prisma = new PrismaClient({
  datasources: { db: { url: inject('databaseUrl') } },
});

/** Indiranagar, Bengaluru. Every distance below is measured from here. */
const PINCODE = '560038';
const CENTRE = { lat: 12.9784, lng: 77.6408 };

const DEALERS = {
  indiranagar: { lat: 12.9784, lng: 77.6408 }, // 0 km
  koramangala: { lat: 12.9352, lng: 77.6245 }, // ~5.1 km
  jayanagar: { lat: 12.9299, lng: 77.5826 }, // ~8.3 km
  whitefield: { lat: 12.9698, lng: 77.75 }, // ~11.9 km
  mysuru: { lat: 12.2958, lng: 76.6394 }, // ~130 km
  hosur: { lat: 12.7409, lng: 77.8253 }, // ~33 km
} as const;

type DealerKey = keyof typeof DEALERS;

async function dealer(
  key: DealerKey | 'nowhere',
  over: { active?: boolean; region?: string } = {},
) {
  const where = key === 'nowhere' ? null : DEALERS[key];
  await prisma.dealer.create({
    data: {
      dealerCode: key,
      name: `Ampere ${key}`,
      lat: where?.lat ?? null,
      lng: where?.lng ?? null,
      active: over.active ?? true,
    },
  });
}

const codes = (result: { dealers: { code: string }[] }) => result.dealers.map((d) => d.code);

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.pincodeGeo.create({ data: { pincode: PINCODE, ...CENTRE } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('dealers within the radius', () => {
  it('offers the three nearest, closest first', async () => {
    for (const key of ['whitefield', 'jayanagar', 'indiranagar', 'koramangala'] as const) {
      await dealer(key);
    }

    const result = await findNearbyDealers(prisma, PINCODE);

    expect(result.basis).toBe('radius');
    expect(codes(result)).toEqual(['indiranagar', 'koramangala', 'jayanagar']);
    expect(result.dealers[0]?.distanceKm).toBe(0);
    expect(result.dealers[1]?.distanceKm).toBeGreaterThan(4.5);
    expect(result.dealers[1]?.distanceKm).toBeLessThan(5.5);
  });

  it('never pads the list with a dealer outside the radius', async () => {
    await dealer('koramangala');
    await dealer('mysuru');
    await dealer('hosur');

    const result = await findNearbyDealers(prisma, PINCODE);

    expect(result.basis).toBe('radius');
    expect(codes(result)).toEqual(['koramangala']);
  });

  it('takes the radius as a setting', async () => {
    await dealer('indiranagar');
    await dealer('koramangala');
    await dealer('jayanagar');

    const result = await findNearbyDealers(prisma, PINCODE, 6);
    expect(codes(result)).toEqual(['indiranagar', 'koramangala']);
  });

  it('skips closed dealers and dealers we cannot place', async () => {
    await dealer('indiranagar', { active: false });
    await dealer('nowhere');
    await dealer('jayanagar');

    const result = await findNearbyDealers(prisma, PINCODE);
    expect(codes(result)).toEqual(['jayanagar']);
  });
});

/**
 * Out of range means out of range.
 *
 * This used to fall back to "the closest at any distance", which for a
 * Bengaluru pincode offered Mysuru. It reads as a bug to the customer, and
 * anyone who booked against it had to be rung up and told no. An empty list is
 * the honest answer; the journey turns it into a test ride rather than a sale.
 */
describe('nothing within the radius', () => {
  it('offers nobody rather than a dealer in another city', async () => {
    await dealer('mysuru');
    await dealer('hosur');

    const result = await findNearbyDealers(prisma, PINCODE);

    expect(result.basis).toBe('radius');
    expect(result.dealers).toEqual([]);
  });
});

describe('a pincode we have no coordinates for', () => {
  beforeEach(async () => {
    await dealer('indiranagar');
    await dealer('koramangala');
    await dealer('jayanagar');
    await dealer('mysuru');
    // Region membership comes from pincode_map, as in resolvePincode.
    await prisma.pincodeMap.createMany({
      data: [
        { pincode: '560001', stateCode: 'KA', regionCode: 'south', dealerCode: 'koramangala' },
        { pincode: '560011', stateCode: 'KA', regionCode: 'south', dealerCode: 'jayanagar' },
        { pincode: '570001', stateCode: 'KA', regionCode: 'south', dealerCode: 'mysuru' },
      ],
    });
  });

  it('offers dealers in the same postal district, its own dealer first', async () => {
    const result = await findNearbyDealers(prisma, '560001');

    expect(result.basis).toBe('region');
    expect(result.dealers.every((d) => d.distanceKm === null)).toBe(true);

    /*
     * Mysuru is in the same REGION ("south") and is deliberately absent: it
     * serves 570xxx, a different sorting district, and is 140km away. The
     * region is too coarse to fall back on — the same reasoning keeps an
     * Ahmedabad showroom (380xxx) away from a Mumbai customer (400xxx), both
     * of which are "west".
     */
    expect(codes(result)).toEqual(['koramangala', 'jayanagar']);
  });

  it('offers nothing where there is no region at all', async () => {
    // 9xxxxx is the Army Postal Service — no civilian delivery.
    const result = await findNearbyDealers(prisma, '900001');
    expect(result.dealers).toEqual([]);
  });
});

describe('findOfferedDealer', () => {
  it('accepts a dealer from the list and refuses one that is not', async () => {
    await dealer('indiranagar');
    await dealer('mysuru');

    expect((await findOfferedDealer(prisma, PINCODE, 'indiranagar'))?.code).toBe('indiranagar');
    // Mysuru exists and is active, but is not offered while Indiranagar is in range.
    expect(await findOfferedDealer(prisma, PINCODE, 'mysuru')).toBeNull();
    expect(await findOfferedDealer(prisma, PINCODE, 'no-such-dealer')).toBeNull();
  });
});
