import { Prisma, PrismaClient, ReservationStatus } from '@prisma/client';

/**
 * Inventory: manual stock per model per region.
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
  constructor(modelCode: string, regionCode: string) {
    super(`No units available for ${modelCode} in ${regionCode}`);
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
  regionCode: string,
): Promise<InventoryRow | null> {
  const rows = await tx.$queryRaw<InventoryRow[]>`
    SELECT units_total, units_reserved, updated_at
    FROM inventory
    WHERE model_code = ${modelCode} AND region_code = ${regionCode}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/** Units a customer can actually buy right now. */
export async function getAvailable(
  prisma: PrismaClient,
  modelCode: string,
  regionCode: string,
): Promise<{ available: number; stale: boolean; updatedAt: Date | null }> {
  const row = await prisma.inventory.findUnique({
    where: { modelCode_regionCode: { modelCode, regionCode } },
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
  params: { orderId: string; modelCode: string; regionCode: string },
): Promise<{ reservationId: string; expiresAt: Date }> {
  const { orderId, modelCode, regionCode } = params;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.inventoryReservation.findUnique({ where: { orderId } });
    if (existing && existing.status === ReservationStatus.held && existing.expiresAt > new Date()) {
      return { reservationId: existing.id, expiresAt: existing.expiresAt };
    }

    const row = await lockRow(tx, modelCode, regionCode);
    if (!row) throw new OutOfStockError(modelCode, regionCode);
    if (row.units_total - row.units_reserved < 1) {
      throw new OutOfStockError(modelCode, regionCode);
    }

    await tx.$executeRaw`
      UPDATE inventory SET units_reserved = units_reserved + 1
      WHERE model_code = ${modelCode} AND region_code = ${regionCode}
    `;

    const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60_000);
    const reservation = await tx.inventoryReservation.upsert({
      where: { orderId },
      create: { orderId, modelCode, regionCode, expiresAt, status: ReservationStatus.held },
      // Reached when the previous hold was released or expired and the customer
      // is retrying. Re-arm the same row rather than inserting a duplicate.
      update: { modelCode, regionCode, expiresAt, status: ReservationStatus.held },
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

    await lockRow(tx, res.modelCode, res.regionCode);
    await tx.$executeRaw`
      UPDATE inventory
      SET units_total = GREATEST(units_total - 1, 0),
          units_reserved = GREATEST(units_reserved - 1, 0)
      WHERE model_code = ${res.modelCode} AND region_code = ${res.regionCode}
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

    await lockRow(tx, res.modelCode, res.regionCode);
    await tx.$executeRaw`
      UPDATE inventory SET units_reserved = GREATEST(units_reserved - 1, 0)
      WHERE model_code = ${res.modelCode} AND region_code = ${res.regionCode}
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
  params: { modelCode: string; regionCode: string; units: number; changedBy: string },
): Promise<void> {
  const { modelCode, regionCode, units, changedBy } = params;
  if (!Number.isInteger(units) || units < 0) {
    throw new Error('units must be a non-negative integer');
  }

  await prisma.$transaction(async (tx) => {
    const row = await lockRow(tx, modelCode, regionCode);
    const before = row?.units_total ?? 0;

    await tx.inventory.upsert({
      where: { modelCode_regionCode: { modelCode, regionCode } },
      create: { modelCode, regionCode, unitsTotal: units, updatedBy: changedBy },
      update: { unitsTotal: units, updatedAt: new Date(), updatedBy: changedBy },
    });

    await tx.inventoryAudit.create({
      data: { modelCode, regionCode, unitsBefore: before, unitsAfter: units, changedBy },
    });
  });
}
