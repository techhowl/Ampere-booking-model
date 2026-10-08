import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { resetDatabase } from '../../../test/reset-db';
import { resolvePincode } from './resolve';

const prisma = new PrismaClient({
  datasources: { db: { url: inject('databaseUrl') } },
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.dealer.create({
    data: { dealerCode: 'AMP-W-001', name: 'Ampere Andheri West', active: true },
  });
  await prisma.pincodeMap.create({
    data: {
      pincode: '400001',
      stateCode: 'MH',
      regionCode: 'west',
      dealerCode: 'AMP-W-001',
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('a pincode we have mapped', () => {
  it('uses the mapping, not the zone', async () => {
    const result = await resolvePincode(prisma, '400001');

    expect(result.regionCode).toBe('west');
    expect(result.stateCode).toBe('MH');
    expect(result.dealer?.code).toBe('AMP-W-001');
    expect(result.usedFallback).toBe(false);
  });
});

/**
 * The dealer master covers a fraction of India's pincodes and always will.
 * A customer in an unmapped one must still be able to see a price.
 */
describe('a pincode we have not mapped', () => {
  it('derives the region from the postal zone', async () => {
    // 400101 is Mumbai, Borivali East — zone 4, so west.
    const result = await resolvePincode(prisma, '400101');

    expect(result.regionCode).toBe('west');
    expect(result.serviceable).toBe(true);
    expect(result.usedFallback).toBe(true);
  });

  it('attaches a dealer serving that region', async () => {
    const result = await resolvePincode(prisma, '400101');
    expect(result.dealer?.code).toBe('AMP-W-001');
  });

  it('maps each civilian zone to a region', async () => {
    const expected: Record<string, string> = {
      '110099': 'north',
      '226099': 'north',
      '302099': 'west',
      '400101': 'west',
      '560099': 'south',
      '600099': 'south',
      '700099': 'east',
      '800099': 'east',
    };

    for (const [pincode, region] of Object.entries(expected)) {
      const result = await resolvePincode(prisma, pincode);
      expect(result.regionCode, pincode).toBe(region);
    }
  });

  it('gives up on Army Postal Service codes', async () => {
    // 9xxxxx is APS — no civilian delivery, so no region and no sale.
    const result = await resolvePincode(prisma, '900001');

    expect(result.regionCode).toBeNull();
    expect(result.serviceable).toBe(false);
  });

  it('is still priced when no dealer serves the region yet', async () => {
    await prisma.dealer.updateMany({ data: { active: false } });

    const result = await resolvePincode(prisma, '400101');

    // The region is what price_book and inventory are keyed on; a missing
    // dealer is a callback problem, not a pricing one.
    expect(result.regionCode).toBe('west');
    expect(result.serviceable).toBe(true);
    expect(result.dealer).toBeNull();
  });
});
