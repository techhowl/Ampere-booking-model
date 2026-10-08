import type { PrismaClient } from '@prisma/client';

/**
 * Empty the database between tests, children before parents.
 *
 * Every db test file shares one container and, under `singleFork`, one process.
 * A file that cleaned up only the tables it knew about left rows pointing at
 * another file's leads, and the next `lead.deleteMany()` hit a foreign key.
 *
 * Order matters here. Keep new tables in dependency order, not alphabetical.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.testRide.deleteMany({});
  await prisma.paymentEvent.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.consent.deleteMany({});

  await prisma.inventoryReservation.deleteMany({});
  await prisma.inventoryAudit.deleteMany({});
  await prisma.inventory.deleteMany({});
  await prisma.priceBook.deleteMany({});

  await prisma.otpAttempt.deleteMany({});
  await prisma.idempotencyRecord.deleteMany({});
  await prisma.rateLimit.deleteMany({});

  await prisma.lead.deleteMany({});
  await prisma.pincodeMap.deleteMany({});
  await prisma.dealer.deleteMany({});
}
