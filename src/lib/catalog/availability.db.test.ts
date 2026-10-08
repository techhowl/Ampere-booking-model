import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { resetDatabase } from '../../../test/reset-db';
import { buildCatalog } from './availability';
import { MODELS } from './catalog';
import { STALE_AFTER_DAYS } from '@/lib/inventory/inventory';

const prisma = new PrismaClient({
  datasources: { db: { url: inject('databaseUrl') } },
});

const MODEL = 'nexus-ex-plus';
const REGION = 'south';

const d = (n: number) => new Prisma.Decimal(n);

async function priced(modelCode: string, amount = 100000, rto = 10000) {
  await prisma.priceBook.create({
    data: {
      modelCode,
      regionCode: REGION,
      amountTotal: d(amount),
      rtoCharges: d(rto),
      effectiveFrom: new Date('2026-01-01'),
    },
  });
}

async function stocked(modelCode: string, units: number, updatedAt = new Date()) {
  await prisma.inventory.create({
    data: {
      modelCode,
      regionCode: REGION,
      unitsTotal: units,
      unitsReserved: 0,
      updatedAt,
      updatedBy: 'test',
    },
  });
}

function find(catalog: Awaited<ReturnType<typeof buildCatalog>>, code: string) {
  const entry = catalog.find((m) => m.code === code);
  if (!entry) throw new Error(`${code} missing from catalog`);
  return entry;
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('without a region', () => {
  it('still lists every model, with no prices and no stock', async () => {
    const catalog = await buildCatalog(prisma, null);

    expect(catalog).toHaveLength(MODELS.length);
    for (const model of catalog) {
      expect(model.price, model.code).toBeNull();
      expect(model.purchasable, model.code).toBe(false);
      expect(model.colours.length, model.code).toBeGreaterThan(0);
    }
  });

  it('keeps the models in their configured order', async () => {
    const catalog = await buildCatalog(prisma, null);
    const expected = [...MODELS].sort((a, b) => a.sort - b.sort).map((m) => m.code);
    expect(catalog.map((m) => m.code)).toEqual(expected);
  });
});

describe('with a region', () => {
  it('prices a model and reports it purchasable when stocked', async () => {
    await priced(MODEL, 109900, 10990);
    await stocked(MODEL, 15);

    const entry = find(await buildCatalog(prisma, REGION), MODEL);

    expect(entry.price?.exShowroom.amount).toBe(109900);
    expect(entry.price?.rtoCharges.amount).toBe(10990);
    expect(entry.price?.onRoad.amount).toBe(120890);
    expect(entry.price?.onRoad.display).toBe('₹1,20,890');
    expect(entry.available).toBe(15);
    expect(entry.purchasable).toBe(true);
  });

  it('subtracts units held by in-flight payments', async () => {
    await priced(MODEL);
    await prisma.inventory.create({
      data: { modelCode: MODEL, regionCode: REGION, unitsTotal: 5, unitsReserved: 3 },
    });

    const entry = find(await buildCatalog(prisma, REGION), MODEL);
    expect(entry.available).toBe(2);
    expect(entry.purchasable).toBe(true);
  });
});

/**
 * Spec 8: "They are never allowed to pay for something we cannot deliver."
 */
describe('what blocks a sale', () => {
  it('no stock', async () => {
    await priced(MODEL);
    await stocked(MODEL, 0);

    const entry = find(await buildCatalog(prisma, REGION), MODEL);
    expect(entry.inStock).toBe(false);
    expect(entry.purchasable).toBe(false);
    // The price is still shown — the customer should know what it would cost.
    expect(entry.price).not.toBeNull();
  });

  it('every unit already reserved', async () => {
    await priced(MODEL);
    await prisma.inventory.create({
      data: { modelCode: MODEL, regionCode: REGION, unitsTotal: 2, unitsReserved: 2 },
    });

    const entry = find(await buildCatalog(prisma, REGION), MODEL);
    expect(entry.available).toBe(0);
    expect(entry.purchasable).toBe(false);
  });

  it('no inventory row at all', async () => {
    await priced(MODEL);

    const entry = find(await buildCatalog(prisma, REGION), MODEL);
    expect(entry.available).toBe(0);
    expect(entry.purchasable).toBe(false);
  });

  it('stock but no price', async () => {
    // Plenty in the warehouse and nothing to charge for it.
    await stocked(MODEL, 15);

    const entry = find(await buildCatalog(prisma, REGION), MODEL);
    expect(entry.inStock).toBe(true);
    expect(entry.price).toBeNull();
    expect(entry.purchasable).toBe(false);
  });
});

describe('stale stock', () => {
  it('is flagged once the count is older than the threshold', async () => {
    await priced(MODEL);
    await stocked(MODEL, 15, new Date(Date.now() - (STALE_AFTER_DAYS + 1) * 86_400_000));

    const entry = find(await buildCatalog(prisma, REGION), MODEL);
    expect(entry.stale).toBe(true);
    // Still sellable — stale is a prompt for ops, not a block on the customer.
    expect(entry.purchasable).toBe(true);
  });

  it('is not flagged for a freshly updated count', async () => {
    await priced(MODEL);
    await stocked(MODEL, 15);

    expect(find(await buildCatalog(prisma, REGION), MODEL).stale).toBe(false);
  });
});

describe('the partial payment option', () => {
  it('is absent while unconfigured', async () => {
    await priced(MODEL);
    await stocked(MODEL, 15);

    expect(find(await buildCatalog(prisma, REGION), MODEL).price?.partial).toBeNull();
  });

  it('appears once an amount is set', async () => {
    await prisma.priceBook.create({
      data: {
        modelCode: MODEL,
        regionCode: REGION,
        amountTotal: d(100000),
        rtoCharges: d(20000),
        partialMode: 'percent',
        partialValue: d(10),
        effectiveFrom: new Date('2026-01-01'),
      },
    });
    await stocked(MODEL, 15);

    const partial = find(await buildCatalog(prisma, REGION), MODEL).price?.partial;
    expect(partial?.amount.amount).toBe(12000);
    expect(partial?.amount.display).toBe('₹12,000');
    expect(partial?.balance.amount).toBe(108000);
  });
});
