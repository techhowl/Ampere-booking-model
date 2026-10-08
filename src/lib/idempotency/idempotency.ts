import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Idempotency for every mutating route.
 *
 * Spec 13: "Every mutating route accepts an Idempotency-Key. Build that
 * interceptor before the order routes, not after."
 *
 * The behaviour that matters: a customer on a flaky mobile connection taps Pay,
 * sees nothing happen, and taps again. Without this, that is two orders and two
 * reserved units. With it, the second request replays the first response.
 *
 * Postgres, not Redis — there is no Redis in v1, and the unique constraint on
 * the primary key is exactly the atomic primitive this needs.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** Long enough to cover any client retry, short enough that the table stays small. */
export const IDEMPOTENCY_TTL_HOURS = 24;

/** Prisma's code for a unique constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super('This Idempotency-Key was already used with a different request body');
    this.name = 'IdempotencyKeyReusedError';
  }
}

/**
 * A request already in flight under this key. The first request has not
 * finished, so there is no stored response to replay yet.
 */
export class IdempotencyInFlightError extends Error {
  constructor() {
    super('A request with this Idempotency-Key is still in progress');
    this.name = 'IdempotencyInFlightError';
  }
}

export function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

export interface StoredResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Runs `handler` at most once per key.
 *
 * - No key supplied: runs the handler, stores nothing. The header is accepted,
 *   not demanded, so a missing key is never an error.
 * - Key seen before, same body: the stored response is replayed.
 * - Key seen before, different body: rejected. That is a client bug, and
 *   serving the cached answer for a different request would be worse.
 * - Key claimed but not yet completed: rejected as in-flight, for the caller to
 *   turn into a 409. Two concurrent identical requests must not both execute.
 */
export async function withIdempotency<T>(
  prisma: PrismaClient,
  params: {
    key: string | null;
    route: string;
    body: unknown;
    handler: () => Promise<{ statusCode: number; body: T }>;
  },
): Promise<{ statusCode: number; body: T; replayed: boolean }> {
  const { key, route, body, handler } = params;

  if (!key) {
    const result = await handler();
    return { ...result, replayed: false };
  }

  const requestHash = hashRequest(body);
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 3_600_000);

  // Claim the key first. statusCode 0 marks "in flight" — a row that exists but
  // has no response yet. Inserting before doing the work is what makes two
  // simultaneous requests resolve to one winner.
  //
  // JsonNull, not DbNull: the column is non-nullable, so this stores the JSON
  // value null rather than trying to set the column to SQL NULL.
  try {
    await prisma.idempotencyRecord.create({
      data: { key, route, requestHash, statusCode: 0, response: Prisma.JsonNull, expiresAt },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      return { ...(await replay<T>(prisma, key, route, requestHash)), replayed: true };
    }
    throw error;
  }

  try {
    const result = await handler();
    await prisma.idempotencyRecord.update({
      where: { key },
      data: {
        statusCode: result.statusCode,
        response: (result.body ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
    return { ...result, replayed: false };
  } catch (error) {
    // The handler failed, so the key must not stay claimed — otherwise a retry
    // of a request that never succeeded would be refused forever.
    await prisma.idempotencyRecord.delete({ where: { key } }).catch(() => {});
    throw error;
  }
}

async function replay<T>(
  prisma: PrismaClient,
  key: string,
  route: string,
  requestHash: string,
): Promise<{ statusCode: number; body: T }> {
  const existing = await prisma.idempotencyRecord.findUnique({ where: { key } });

  // Deleted between the failed insert and this read: treat as reusable.
  if (!existing) throw new IdempotencyInFlightError();

  if (existing.requestHash !== requestHash || existing.route !== route) {
    throw new IdempotencyKeyReusedError();
  }

  if (existing.statusCode === 0) throw new IdempotencyInFlightError();

  return { statusCode: existing.statusCode, body: existing.response as T };
}

/** Background job. Nothing references an expired record. */
export async function purgeExpired(prisma: PrismaClient): Promise<number> {
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
