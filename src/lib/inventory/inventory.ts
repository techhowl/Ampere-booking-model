import { Prisma, PrismaClient, ReservationStatus } from '@prisma/client';

/**
 * Inventory: manual stock per model per DEALER.
 *
 * Keyed on the dealer rather than the region because that is the unit a
 * customer collects from. A scooter sitting at a showroom in another city is
 * not stock this customer can buy, and treating it as such is how a confirmed
 * order becomes a phone call apologising.
 *
 * The only rule that matters: two customers must never both succeed in buying
 * the last unit. Everything here exists to make that impossible.
 *
 * We take a row lock (SELECT ... FOR UPDATE) on the inventory row inside a
 * transaction. The second concurrent request blocks until the first commits,
 * then re-reads the true count. This is the reason this project uses Postgres.
 */

export const RESERVATION_MINUTES = 15;
export const STALE_AFTER_DAYS = 15;

export class OutOfStockError extends Error {
  constructor(modelCode: string, dealerCode: string) {
    super(`No units available for ${modelCode} at ${dealerCode}`);
    this.name = 'OutOfStockError';
  }
}

type Tx = Prisma.TransactionClient;

interface InventoryRow {
  units_total: number;
  units_reserved: number;
  updated_at: Date;
}

async function lockRow(
  tx: Tx,
  modelCode: string,
  dealerCode: string,
): Promise<InventoryRow | null> {
  const rows = await tx.$queryRaw<InventoryRow[]>`
    SELECT units_total, units_reserved, updated_at
    FROM inventory
    WHERE model_code = ${modelCode} AND dealer_code = ${dealerCode}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/** Units a customer can actually buy right now. */
export async function getAvailable(
  prisma: PrismaClient,
  modelCode: string,
  dealerCode: string,
): Promise<{ available: number; stale: boolean; updatedAt: Date | null }> {
  const row = await prisma.inventory.findUnique({
    where: { modelCode_dealerCode: { modelCode, dealerCode } },
  });
  if (!row) return { available: 0, stale: false, updatedAt: null };

  const ageMs = Date.now() - row.updatedAt.getTime();
  return {
    available: Math.max(0, row.unitsTotal - row.unitsReserved),
    stale: ageMs > STALE_AFTER_DAYS * 86_400_000,
    updatedAt: row.updatedAt,
  };
}

/**
 * Hold one unit for this order. Call this BEFORE handing the customer to Juspay.
 *
 * Idempotent by orderId: a retry of the same order reuses its existing hold
 * rather than taking a second unit.
 *
 * A retry after a failed payment is the harder case. `release()` leaves the
 * reservation row behind as `released`, and `order_id` is UNIQUE, so inserting
 * a fresh row for the same order would violate the constraint. We revive the
 * existing row instead — one reservation per order, for the life of the order,
 * which is what the unique constraint is there to guarantee.
 */
export async function reserve(
  prisma: PrismaClient,
  params: { orderId: string; modelCode: string; dealerCode: string },
): Promise<{ reservationId: string; expiresAt: Date }> {
  const { orderId, modelCode, dealerCode } = params;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.inventoryReservation.findUnique({ where: { orderId } });
    if (existing && existing.status === ReservationStatus.held && existing.expiresAt > new Date()) {
      return { reservationId: existing.id, expiresAt: existing.expiresAt };
    }

    const row = await lockRow(tx, modelCode, dealerCode);
    if (!row) throw new OutOfStockError(modelCode, dealerCode);
    if (row.units_total - row.units_reserved < 1) {
      throw new OutOfStockError(modelCode, dealerCode);
    }

    await tx.$executeRaw`
      UPDATE inventory SET units_reserved = units_reserved + 1
      WHERE model_code = ${modelCode} AND dealer_code = ${dealerCode}
    `;

    const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60_000);
    const reservation = await tx.inventoryReservation.upsert({
      where: { orderId },
      create: { orderId, modelCode, dealerCode, expiresAt, status: ReservationStatus.held },
      // Reached when the previous hold was released or expired and the customer
      // is retrying. Re-arm the same row rather than inserting a duplicate.
      update: { modelCode, dealerCode, expiresAt, status: ReservationStatus.held },
    });

    return { reservationId: reservation.id, expiresAt };
  });
}

/**
 * Payment confirmed. The held unit becomes a sale.
 * Idempotent: replaying a webhook must not decrement twice.
 */
export async function convert(prisma: PrismaClient, orderId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const res = await tx.inventoryReservation.findUnique({ where: { orderId } });
    if (!res || res.status !== ReservationStatus.held) return; // already handled

    await lockRow(tx, res.modelCode, res.dealerCode);
    await tx.$executeRaw`
      UPDATE inventory
      SET units_total = GREATEST(units_total - 1, 0),
          units_reserved = GREATEST(units_reserved - 1, 0)
      WHERE model_code = ${res.modelCode} AND dealer_code = ${res.dealerCode}
    `;
    await tx.inventoryReservation.update({
      where: { orderId },
      data: { status: ReservationStatus.converted },
    });
  });
}

/** Payment failed or was abandoned. Put the unit back. Idempotent. */
export async function release(prisma: PrismaClient, orderId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const res = await tx.inventoryReservation.findUnique({ where: { orderId } });
    if (!res || res.status !== ReservationStatus.held) return;

    await lockRow(tx, res.modelCode, res.dealerCode);
    await tx.$executeRaw`
      UPDATE inventory SET units_reserved = GREATEST(units_reserved - 1, 0)
      WHERE model_code = ${res.modelCode} AND dealer_code = ${res.dealerCode}
    `;
    await tx.inventoryReservation.update({
      where: { orderId },
      data: { status: ReservationStatus.released },
    });
  });
}

/**
 * Background job, every minute. Releases holds whose window has passed.
 * Without this, abandoned checkouts leak stock until someone notices.
 */
export async function expireStale(prisma: PrismaClient): Promise<number> {
  const expired = await prisma.inventoryReservation.findMany({
    where: { status: ReservationStatus.held, expiresAt: { lt: new Date() } },
    select: { orderId: true },
    take: 500,
  });
  for (const { orderId } of expired) await release(prisma, orderId);
  return expired.length;
}

/** Admin grid write. Always records who changed what. */
export async function setUnits(
  prisma: PrismaClient,
  params: { modelCode: string; dealerCode: string; units: number; changedBy: string },
): Promise<void> {
  const { modelCode, dealerCode, units, changedBy } = params;
  if (!Number.isInteger(units) || units < 0) {
    throw new Error('units must be a non-negative integer');
  }

  await prisma.$transaction(async (tx) => {
    const row = await lockRow(tx, modelCode, dealerCode);
    const before = row?.units_total ?? 0;

    await tx.inventory.upsert({
      where: { modelCode_dealerCode: { modelCode, dealerCode } },
      create: { modelCode, dealerCode, unitsTotal: units, updatedBy: changedBy },
      update: { unitsTotal: units, updatedAt: new Date(), updatedBy: changedBy },
    });

    await tx.inventoryAudit.create({
      data: { modelCode, dealerCode, unitsBefore: before, unitsAfter: units, changedBy },
    });
  });
}

/**
 * Stock for one model across several dealers, in the order given.
 *
 * One query rather than one per dealer, because the buy page asks this for
 * every model on every pincode change.
 */
export async function availabilityAcross(
  prisma: PrismaClient,
  modelCode: string,
  dealerCodes: string[],
): Promise<{ byDealer: Map<string, number>; total: number; stale: boolean }> {
  if (dealerCodes.length === 0) {
    return { byDealer: new Map(), total: 0, stale: false };
  }

  const rows = await prisma.inventory.findMany({
    where: { modelCode, dealerCode: { in: dealerCodes } },
    select: { dealerCode: true, unitsTotal: true, unitsReserved: true, updatedAt: true },
  });

  const byDealer = new Map<string, number>();
  let total = 0;
  // Spec 8: stale inventory announces itself. The OLDEST row decides — one
  // dealer who has not updated in a month makes the picture untrustworthy even
  // if their neighbour updated this morning.
  let oldest: Date | null = null;

  for (const row of rows) {
    const units = Math.max(0, row.unitsTotal - row.unitsReserved);
    byDealer.set(row.dealerCode, units);
    total += units;
    if (!oldest || row.updatedAt < oldest) oldest = row.updatedAt;
  }

  // A dealer with no row has no stock, not unknown stock.
  for (const code of dealerCodes) if (!byDealer.has(code)) byDealer.set(code, 0);

  return {
    byDealer,
    total,
    stale: oldest !== null && Date.now() - oldest.getTime() > STALE_AFTER_DAYS * 86_400_000,
  };
}

/**
 * The first dealer in this list with a unit of this model to sell.
 *
 * `dealerCodes` arrives nearest-first, so "first with stock" means "nearest
 * with stock" — the customer's preferred showroom when it can serve them, the
 * next one along when it cannot. Null when none of them can.
 *
 * Advisory only. It reads without locking, so between this answering and
 * reserve() running, the unit can go. reserve() takes the row lock and is the
 * one that decides; this exists so the page can show the right dealer and hide
 * the buy button when nobody in range can fulfil.
 */
export async function firstDealerWithStock(
  prisma: PrismaClient,
  modelCode: string,
  dealerCodes: string[],
): Promise<string | null> {
  const { byDealer } = await availabilityAcross(prisma, modelCode, dealerCodes);
  return dealerCodes.find((code) => (byDealer.get(code) ?? 0) > 0) ?? null;
}
