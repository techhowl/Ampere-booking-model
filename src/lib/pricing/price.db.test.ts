import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { resetDatabase } from '../../../test/reset-db';
import {
  computePartial,
  formatRupees,
  resolveIndicativePrice,
  resolvePrice,
} from './price';

const prisma = new PrismaClient({
  datasources: { db: { url: inject('databaseUrl') } },
});

const MODEL = 'nexus-ex-plus';
const REGION = 'south';

const d = (n: string | number) => new Prisma.Decimal(n);

async function addPrice(over: {
  amountTotal: number;
  rtoCharges?: number;
  partialMode?: string | null;
  partialValue?: number | null;
  effectiveFrom: Date;
}) {
  await prisma.priceBook.create({
    data: {
      modelCode: MODEL,
      regionCode: REGION,
      amountTotal: d(over.amountTotal),
      rtoCharges: d(over.rtoCharges ?? 0),
      partialMode: over.partialMode ?? null,
      partialValue: over.partialValue === undefined || over.partialValue === null
        ? null
        : d(over.partialValue),
      effectiveFrom: over.effectiveFrom,
    },
  });
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('resolvePrice', () => {
  it('returns the itemised price', async () => {
    await addPrice({
      amountTotal: 109900,
      rtoCharges: 10990,
      effectiveFrom: new Date('2026-01-01'),
    });

    const price = await resolvePrice(prisma, MODEL, REGION);

    expect(price).not.toBeNull();
    expect(price?.exShowroom.toString()).toBe('109900');
    expect(price?.rtoCharges.toString()).toBe('10990');
    expect(price?.onRoad.toString()).toBe('120890');
  });

  it('returns null for a model we do not price in this region', async () => {
    expect(await resolvePrice(prisma, MODEL, REGION)).toBeNull();
  });
});

/**
 * price_book is append-only — effective_from is part of the primary key, so a
 * price change is a new row and the old one survives for orders that used it.
 */
describe('which row is in force', () => {
  it('takes the newest row that has already taken effect', async () => {
    await addPrice({ amountTotal: 99900, effectiveFrom: new Date('2026-01-01') });
    await addPrice({ amountTotal: 104900, effectiveFrom: new Date('2026-06-01') });

    const price = await resolvePrice(prisma, MODEL, REGION, new Date('2026-09-01'));
    expect(price?.exShowroom.toString()).toBe('104900');
  });

  it('ignores a price scheduled for the future', async () => {
    await addPrice({ amountTotal: 99900, effectiveFrom: new Date('2026-01-01') });
    // Next year's price, already loaded. Charging it today would be theft.
    await addPrice({ amountTotal: 119900, effectiveFrom: new Date('2027-01-01') });

    const price = await resolvePrice(prisma, MODEL, REGION, new Date('2026-09-01'));
    expect(price?.exShowroom.toString()).toBe('99900');
  });

  it('returns null before any price has taken effect', async () => {
    await addPrice({ amountTotal: 99900, effectiveFrom: new Date('2026-06-01') });

    const price = await resolvePrice(prisma, MODEL, REGION, new Date('2026-01-01'));
    expect(price).toBeNull();
  });

  it('reports which row it used', async () => {
    const when = new Date('2026-06-01T00:00:00.000Z');
    await addPrice({ amountTotal: 104900, effectiveFrom: when });

    const price = await resolvePrice(prisma, MODEL, REGION, new Date('2026-09-01'));
    expect(price?.effectiveFrom.toISOString()).toBe(when.toISOString());
  });
});

/**
 * Spec 6: the partial payment option is hidden until configured. The amount is
 * open item #1 and arrives as a number typed into the admin page.
 */
describe('the partial payment option', () => {
  it('is hidden while unconfigured', async () => {
    await addPrice({
      amountTotal: 109900,
      rtoCharges: 10990,
      effectiveFrom: new Date('2026-01-01'),
    });

    const price = await resolvePrice(prisma, MODEL, REGION);
    expect(price?.partial).toBeNull();
  });

  it('appears as a fixed deposit once configured', async () => {
    await addPrice({
      amountTotal: 109900,
      rtoCharges: 10990,
      partialMode: 'fixed',
      partialValue: 10000,
      effectiveFrom: new Date('2026-01-01'),
    });

    const price = await resolvePrice(prisma, MODEL, REGION);
    expect(price?.partial?.amount.toString()).toBe('10000');
    expect(price?.partial?.balance.toString()).toBe('110890');
  });

  it('appears as a percentage once configured', async () => {
    await addPrice({
      amountTotal: 100000,
      rtoCharges: 20000,
      partialMode: 'percent',
      partialValue: 10,
      effectiveFrom: new Date('2026-01-01'),
    });

    const price = await resolvePrice(prisma, MODEL, REGION);
    // 10% of the on-road 120000, not of the ex-showroom 100000.
    expect(price?.partial?.amount.toString()).toBe('12000');
    expect(price?.partial?.balance.toString()).toBe('108000');
  });
});

describe('computePartial', () => {
  const onRoad = d(120890);

  it('hides the option for every half-finished configuration', () => {
    expect(computePartial(null, null, onRoad)).toBeNull();
    expect(computePartial('fixed', null, onRoad)).toBeNull();
    expect(computePartial(null, d(10000), onRoad)).toBeNull();
    expect(computePartial('nonsense', d(10000), onRoad)).toBeNull();
  });

  it('hides the option for a zero or negative amount', () => {
    expect(computePartial('fixed', d(0), onRoad)).toBeNull();
    expect(computePartial('fixed', d(-500), onRoad)).toBeNull();
    expect(computePartial('percent', d(0), onRoad)).toBeNull();
  });

  it('hides the option when the deposit is the whole price or more', () => {
    // Charging the full amount under a "partial payment" label would be a lie.
    expect(computePartial('fixed', onRoad, onRoad)).toBeNull();
    expect(computePartial('fixed', d(999999), onRoad)).toBeNull();
    expect(computePartial('percent', d(100), onRoad)).toBeNull();
    expect(computePartial('percent', d(150), onRoad)).toBeNull();
  });

  it('rounds to whole rupees', () => {
    // 17.5% of 120890 is 21155.75 — nobody wants to be charged paise.
    const partial = computePartial('percent', d(17.5), onRoad);
    expect(partial?.amount.toString()).toBe('21156');
    expect(partial?.balance.toString()).toBe('99734');
  });

  it('always leaves amount plus balance equal to the price', () => {
    for (const value of [1, 7.5, 10, 25, 33.3333, 99]) {
      const partial = computePartial('percent', d(value), onRoad);
      expect(partial, `percent ${value}`).not.toBeNull();
      expect(
        partial?.amount.add(partial.balance).toString(),
        `percent ${value}`,
      ).toBe(onRoad.toString());
    }
  });
});

describe('formatRupees', () => {
  it('groups digits the Indian way', () => {
    // 1,09,900 — not 109,900. Getting this wrong looks foreign on an Indian page.
    expect(formatRupees(109900)).toBe('₹1,09,900');
    expect(formatRupees(d(1234567))).toBe('₹12,34,567');
    expect(formatRupees(0)).toBe('₹0');
  });
});

describe('resolveIndicativePrice', () => {
  it('takes the lowest current ex-showroom across regions', async () => {
    await prisma.priceBook.createMany({
      data: [
        { modelCode: MODEL, regionCode: 'north', amountTotal: d(109900), rtoCharges: d(0), effectiveFrom: new Date('2026-01-01') },
        { modelCode: MODEL, regionCode: 'south', amountTotal: d(111900), rtoCharges: d(0), effectiveFrom: new Date('2026-01-01') },
        { modelCode: MODEL, regionCode: 'east', amountTotal: d(112900), rtoCharges: d(0), effectiveFrom: new Date('2026-01-01') },
      ],
    });

    const price = await resolveIndicativePrice(prisma, MODEL, new Date('2026-09-01'));
    expect(price?.toString()).toBe('109900');
  });

  it('uses each region\'s current row, not its oldest', async () => {
    await prisma.priceBook.createMany({
      data: [
        // North was cheapest, then went up. South has not moved.
        { modelCode: MODEL, regionCode: 'north', amountTotal: d(99900), rtoCharges: d(0), effectiveFrom: new Date('2026-01-01') },
        { modelCode: MODEL, regionCode: 'north', amountTotal: d(119900), rtoCharges: d(0), effectiveFrom: new Date('2026-06-01') },
        { modelCode: MODEL, regionCode: 'south', amountTotal: d(104900), rtoCharges: d(0), effectiveFrom: new Date('2026-01-01') },
      ],
    });

    const price = await resolveIndicativePrice(prisma, MODEL, new Date('2026-09-01'));
    expect(price?.toString()).toBe('104900');
  });

  it('ignores a price not yet in effect', async () => {
    await prisma.priceBook.createMany({
      data: [
        { modelCode: MODEL, regionCode: 'north', amountTotal: d(109900), rtoCharges: d(0), effectiveFrom: new Date('2026-01-01') },
        { modelCode: MODEL, regionCode: 'south', amountTotal: d(89900), rtoCharges: d(0), effectiveFrom: new Date('2027-01-01') },
      ],
    });

    const price = await resolveIndicativePrice(prisma, MODEL, new Date('2026-09-01'));
    expect(price?.toString()).toBe('109900');
  });

  it('is null for a model with no prices', async () => {
    expect(await resolveIndicativePrice(prisma, MODEL)).toBeNull();
  });
});
