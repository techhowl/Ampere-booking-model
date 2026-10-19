import { PrismaClient, ReservationStatus } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  OutOfStockError,
  RESERVATION_MINUTES,
  availabilityAcross,
  firstDealerWithStock,
  convert,
  expireStale,
  getAvailable,
  release,
  reserve,
  setUnits,
} from './inventory';

/**
 * Inventory against real Postgres.
 *
 * Mocking here would be worse than no test at all: the behaviour under test is
 * Postgres' own — a row lock serialising two transactions, and a UNIQUE
 * constraint rejecting a duplicate order_id. A fake passes while production
 * sells the same scooter twice.
 */

const prisma = new PrismaClient({
  datasources: { db: { url: inject('databaseUrl') } },
});

const MODEL = 'nexus-ex-plus';
const DEALER = 'AMP-TEST-1';

async function stock(units: number, reserved = 0) {
  await prisma.inventory.upsert({
    where: { modelCode_dealerCode: { modelCode: MODEL, dealerCode: DEALER } },
    create: {
      modelCode: MODEL,
      dealerCode: DEALER,
      unitsTotal: units,
      unitsReserved: reserved,
      updatedBy: 'test',
    },
    update: { unitsTotal: units, unitsReserved: reserved, updatedBy: 'test' },
  });
}

async function unitsRow() {
  const row = await prisma.inventory.findUniqueOrThrow({
    where: { modelCode_dealerCode: { modelCode: MODEL, dealerCode: DEALER } },
  });
  return { total: row.unitsTotal, reserved: row.unitsReserved };
}

beforeEach(async () => {
  await prisma.inventoryReservation.deleteMany({});
  await prisma.inventoryAudit.deleteMany({});
  await prisma.inventory.deleteMany({});

  // Stock now hangs off a dealer by foreign key, so one has to exist.
  await prisma.dealer.upsert({
    where: { dealerCode: DEALER },
    create: { dealerCode: DEALER, name: 'Test Motors', active: true },
    update: {},
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('reserve', () => {
  it('holds one unit and leaves the total alone until the payment lands', async () => {
    await stock(15);

    const { expiresAt } = await reserve(prisma, {
      orderId: 'AMP-1',
      modelCode: MODEL,
      dealerCode: DEALER,
    });

    expect(await unitsRow()).toEqual({ total: 15, reserved: 1 });
    expect((await getAvailable(prisma, MODEL, DEALER)).available).toBe(14);

    const heldForMinutes = (expiresAt.getTime() - Date.now()) / 60_000;
    expect(heldForMinutes).toBeGreaterThan(RESERVATION_MINUTES - 1);
    expect(heldForMinutes).toBeLessThanOrEqual(RESERVATION_MINUTES);
  });

  it('reuses a live hold instead of taking a second unit', async () => {
    await stock(15);

    const first = await reserve(prisma, { orderId: 'AMP-1', modelCode: MODEL, dealerCode: DEALER });
    const second = await reserve(prisma, { orderId: 'AMP-1', modelCode: MODEL, dealerCode: DEALER });

    expect(second.reservationId).toBe(first.reservationId);
    expect(await unitsRow()).toEqual({ total: 15, reserved: 1 });
  });

  it('refuses when nothing is available', async () => {
    await stock(1, 1);

    await expect(
      reserve(prisma, { orderId: 'AMP-1', modelCode: MODEL, dealerCode: DEALER }),
    ).rejects.toBeInstanceOf(OutOfStockError);
  });

  it('refuses a model that has no row in this region', async () => {
    await expect(
      reserve(prisma, { orderId: 'AMP-1', modelCode: MODEL, dealerCode: 'AMP-NOWHERE' }),
    ).rejects.toBeInstanceOf(OutOfStockError);
  });
});

/**
 * Regression. order_id is UNIQUE, so a second reservation row for the same
 * order is impossible — and the retry path asks for exactly that. The spec
 * requires a retry to reuse the same order_id, so `reserve()` has to revive the
 * dead row rather than insert a new one.
 */
describe('reserve on retry — the same order_id, a second time', () => {
  it('re-holds a unit after the first payment failed and the hold was released', async () => {
    await stock(15);

    await reserve(prisma, { orderId: 'AMP-RETRY', modelCode: MODEL, dealerCode: DEALER });
    await release(prisma, 'AMP-RETRY');
    expect(await unitsRow()).toEqual({ total: 15, reserved: 0 });

    // The customer taps Retry. Same order, per spec 12 rule 2.
    await expect(
      reserve(prisma, { orderId: 'AMP-RETRY', modelCode: MODEL, dealerCode: DEALER }),
    ).resolves.toMatchObject({ reservationId: expect.any(String) });

    expect(await unitsRow()).toEqual({ total: 15, reserved: 1 });

    // Still exactly one reservation row for this order.
    const rows = await prisma.inventoryReservation.findMany({
      where: { orderId: 'AMP-RETRY' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe(ReservationStatus.held);
  });

  it('re-holds a unit after the 15-minute window expired', async () => {
    await stock(15);

    await reserve(prisma, { orderId: 'AMP-SLOW', modelCode: MODEL, dealerCode: DEALER });

    // Wind the hold into the past, then let the expiry job do its work.
    await prisma.inventoryReservation.update({
      where: { orderId: 'AMP-SLOW' },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await expireStale(prisma)).toBe(1);
    expect(await unitsRow()).toEqual({ total: 15, reserved: 0 });

    await expect(
      reserve(prisma, { orderId: 'AMP-SLOW', modelCode: MODEL, dealerCode: DEALER }),
    ).resolves.toMatchObject({ reservationId: expect.any(String) });

    expect(await unitsRow()).toEqual({ total: 15, reserved: 1 });
  });
});

describe('convert', () => {
  it('turns the hold into a sale', async () => {
    await stock(15);
    await reserve(prisma, { orderId: 'AMP-1', modelCode: MODEL, dealerCode: DEALER });

    await convert(prisma, 'AMP-1');

    expect(await unitsRow()).toEqual({ total: 14, reserved: 0 });
  });

  it('does not decrement twice when the webhook is replayed', async () => {
    await stock(15);
    await reserve(prisma, { orderId: 'AMP-1', modelCode: MODEL, dealerCode: DEALER });

    await convert(prisma, 'AMP-1');
    await convert(prisma, 'AMP-1');
    await convert(prisma, 'AMP-1');

    expect(await unitsRow()).toEqual({ total: 14, reserved: 0 });
  });

  it('ignores an order it has never seen', async () => {
    await stock(15);
    await convert(prisma, 'AMP-GHOST');
    expect(await unitsRow()).toEqual({ total: 15, reserved: 0 });
  });
});

describe('release', () => {
  it('returns the unit to the pool', async () => {
    await stock(15);
    await reserve(prisma, { orderId: 'AMP-1', modelCode: MODEL, dealerCode: DEALER });

    await release(prisma, 'AMP-1');

    expect(await unitsRow()).toEqual({ total: 15, reserved: 0 });
  });

  it('will not release a hold that already became a sale', async () => {
    await stock(15);
    await reserve(prisma, { orderId: 'AMP-1', modelCode: MODEL, dealerCode: DEALER });
    await convert(prisma, 'AMP-1');

    await release(prisma, 'AMP-1');

    // A late failure webhook must not hand back a unit that was sold.
    expect(await unitsRow()).toEqual({ total: 14, reserved: 0 });
  });
});

/**
 * The reason this project uses Postgres. Two customers, one unit, same instant.
 */
describe('the last unit', () => {
  it('is sold to exactly one of two simultaneous buyers', async () => {
    await stock(1);

    const results = await Promise.allSettled([
      reserve(prisma, { orderId: 'AMP-A', modelCode: MODEL, dealerCode: DEALER }),
      reserve(prisma, { orderId: 'AMP-B', modelCode: MODEL, dealerCode: DEALER }),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(await unitsRow()).toEqual({ total: 1, reserved: 1 });
  });

  it('holds under a wider stampede — ten buyers, three units', async () => {
    await stock(3);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        reserve(prisma, { orderId: `AMP-${i}`, modelCode: MODEL, dealerCode: DEALER }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(await unitsRow()).toEqual({ total: 3, reserved: 3 });
  });
});

describe('expireStale', () => {
  it('leaves holds that are still inside their window', async () => {
    await stock(15);
    await reserve(prisma, { orderId: 'AMP-1', modelCode: MODEL, dealerCode: DEALER });

    expect(await expireStale(prisma)).toBe(0);
    expect(await unitsRow()).toEqual({ total: 15, reserved: 1 });
  });
});

describe('setUnits', () => {
  it('writes the number and an audit row saying who changed it', async () => {
    await stock(15);

    await setUnits(prisma, {
      modelCode: MODEL,
      dealerCode: DEALER,
      units: 7,
      changedBy: 'ops@ampere',
    });

    expect(await unitsRow()).toEqual({ total: 7, reserved: 0 });

    const audit = await prisma.inventoryAudit.findMany({ where: { modelCode: MODEL } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      unitsBefore: 15,
      unitsAfter: 7,
      changedBy: 'ops@ampere',
    });
  });

  it('rejects a negative count', async () => {
    await stock(15);
    await expect(
      setUnits(prisma, { modelCode: MODEL, dealerCode: DEALER, units: -1, changedBy: 'ops' }),
    ).rejects.toThrow(/non-negative/);
  });
});

/**
 * The dealer fallback.
 *
 * A customer wants a scooter, not a particular building. When the nearest
 * showroom is out of the model they chose, we move to the next one in range
 * rather than refusing a sale over stock sitting twenty minutes away.
 *
 * The order of `dealerCodes` carries the meaning: it arrives nearest-first, so
 * "first with stock" is "nearest with stock".
 */
describe('choosing which dealer fulfils', () => {
  const NEAR = 'AMP-NEAR';
  const MID = 'AMP-MID';
  const FAR = 'AMP-FAR';
  const ORDER = [NEAR, MID, FAR];

  beforeEach(async () => {
    for (const [code, name] of [
      [NEAR, 'Nearest Motors'],
      [MID, 'Middle Motors'],
      [FAR, 'Far Motors'],
    ]) {
      await prisma.dealer.upsert({
        where: { dealerCode: code as string },
        create: { dealerCode: code as string, name: name as string, active: true },
        update: {},
      });
    }
  });

  async function stockAt(dealerCode: string, units: number, reserved = 0) {
    await prisma.inventory.upsert({
      where: { modelCode_dealerCode: { modelCode: MODEL, dealerCode } },
      create: { modelCode: MODEL, dealerCode, unitsTotal: units, unitsReserved: reserved },
      update: { unitsTotal: units, unitsReserved: reserved },
    });
  }

  it('prefers the nearest dealer that has one', async () => {
    await stockAt(NEAR, 3);
    await stockAt(MID, 3);
    expect(await firstDealerWithStock(prisma, MODEL, ORDER)).toBe(NEAR);
  });

  it('falls through to the next when the nearest is out', async () => {
    await stockAt(NEAR, 0);
    await stockAt(MID, 2);
    expect(await firstDealerWithStock(prisma, MODEL, ORDER)).toBe(MID);
  });

  it('skips a dealer whose last unit is already held by someone mid-payment', async () => {
    await stockAt(NEAR, 1, 1);
    await stockAt(FAR, 1);
    expect(await firstDealerWithStock(prisma, MODEL, ORDER)).toBe(FAR);
  });

  it('treats a dealer with no inventory row as having none, not unknown', async () => {
    await stockAt(FAR, 1);
    expect(await firstDealerWithStock(prisma, MODEL, ORDER)).toBe(FAR);
  });

  /* This is what takes the buy button down and leaves the test ride up. */
  it('returns null when nobody in range can fulfil', async () => {
    await stockAt(NEAR, 0);
    await stockAt(MID, 0);
    await stockAt(FAR, 0);
    expect(await firstDealerWithStock(prisma, MODEL, ORDER)).toBeNull();
  });

  it('returns null when there are no dealers in range at all', async () => {
    expect(await firstDealerWithStock(prisma, MODEL, [])).toBeNull();
  });

  it('sums stock across dealers, because any of them can fulfil', async () => {
    await stockAt(NEAR, 2);
    await stockAt(MID, 0);
    await stockAt(FAR, 4);

    const stock = await availabilityAcross(prisma, MODEL, ORDER);
    expect(stock.total).toBe(6);
    expect(stock.byDealer.get(MID)).toBe(0);
  });

  it('never counts a dealer outside the list', async () => {
    await stockAt(NEAR, 2);
    await stockAt(FAR, 99);

    const stock = await availabilityAcross(prisma, MODEL, [NEAR]);
    expect(stock.total).toBe(2);
  });
});
