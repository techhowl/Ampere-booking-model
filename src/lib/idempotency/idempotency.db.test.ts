import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import {
  IdempotencyInFlightError,
  IdempotencyKeyReusedError,
  purgeExpired,
  withIdempotency,
} from './idempotency';

const prisma = new PrismaClient({
  datasources: { db: { url: inject('databaseUrl') } },
});

const ROUTE = 'POST /api/leads';

beforeEach(async () => {
  await prisma.idempotencyRecord.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('without a key', () => {
  it('runs the handler and stores nothing', async () => {
    const handler = vi.fn(async () => ({ statusCode: 201, body: { id: 'lead-1' } }));

    const result = await withIdempotency(prisma, {
      key: null,
      route: ROUTE,
      body: { name: 'Asha' },
      handler,
    });

    expect(result).toEqual({ statusCode: 201, body: { id: 'lead-1' }, replayed: false });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
  });
});

describe('with a key', () => {
  it('runs the handler once and replays the response afterwards', async () => {
    const handler = vi.fn(async () => ({ statusCode: 201, body: { id: 'lead-1' } }));
    const call = () =>
      withIdempotency(prisma, { key: 'k1', route: ROUTE, body: { name: 'Asha' }, handler });

    const first = await call();
    const second = await call();
    const third = await call();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(third.replayed).toBe(true);
    expect(second.body).toEqual({ id: 'lead-1' });
    expect(second.statusCode).toBe(201);
  });

  it('rejects the same key used for a different body', async () => {
    const handler = vi.fn(async () => ({ statusCode: 201, body: { id: 'lead-1' } }));

    await withIdempotency(prisma, { key: 'k1', route: ROUTE, body: { name: 'Asha' }, handler });

    await expect(
      withIdempotency(prisma, { key: 'k1', route: ROUTE, body: { name: 'Different' }, handler }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects the same key reused on a different route', async () => {
    const handler = vi.fn(async () => ({ statusCode: 201, body: { ok: true } }));
    const body = { name: 'Asha' };

    await withIdempotency(prisma, { key: 'k1', route: ROUTE, body, handler });

    await expect(
      withIdempotency(prisma, { key: 'k1', route: 'POST /api/orders', body, handler }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it('replays a stored 4xx as faithfully as a success', async () => {
    const handler = vi.fn(async () => ({ statusCode: 422, body: { error: 'bad pincode' } }));
    const call = () =>
      withIdempotency(prisma, { key: 'k1', route: ROUTE, body: { p: 1 }, handler });

    await call();
    const replayed = await call();

    expect(replayed.statusCode).toBe(422);
    expect(replayed.body).toEqual({ error: 'bad pincode' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

/**
 * The case this exists for: one customer, one flaky connection, two taps.
 */
describe('two simultaneous requests with the same key', () => {
  it('executes the handler exactly once', async () => {
    let running = 0;
    let maxConcurrent = 0;

    const handler = vi.fn(async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 50));
      running--;
      return { statusCode: 201, body: { id: 'lead-1' } };
    });

    const results = await Promise.allSettled([
      withIdempotency(prisma, { key: 'k1', route: ROUTE, body: { n: 1 }, handler }),
      withIdempotency(prisma, { key: 'k1', route: ROUTE, body: { n: 1 }, handler }),
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(maxConcurrent).toBe(1);

    // One wins; the other is told the first is still in flight, which the route
    // turns into a 409 for the client to retry.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      IdempotencyInFlightError,
    );
  });
});

describe('when the handler throws', () => {
  it('releases the key so a genuine retry can succeed', async () => {
    const failing = vi.fn(async (): Promise<{ statusCode: number; body: unknown }> => {
      throw new Error('database blew up');
    });

    await expect(
      withIdempotency(prisma, { key: 'k1', route: ROUTE, body: { n: 1 }, handler: failing }),
    ).rejects.toThrow(/blew up/);

    expect(await prisma.idempotencyRecord.count()).toBe(0);

    // The retry must not be refused because of the failed attempt.
    const succeeding = vi.fn(async () => ({ statusCode: 201, body: { id: 'lead-1' } }));
    const retry = await withIdempotency(prisma, {
      key: 'k1',
      route: ROUTE,
      body: { n: 1 },
      handler: succeeding,
    });

    expect(retry.statusCode).toBe(201);
    expect(retry.replayed).toBe(false);
  });
});

describe('purgeExpired', () => {
  it('removes only records past their expiry', async () => {
    await prisma.idempotencyRecord.createMany({
      data: [
        {
          key: 'old',
          route: ROUTE,
          requestHash: 'a'.repeat(64),
          statusCode: 201,
          response: {},
          expiresAt: new Date(Date.now() - 1000),
        },
        {
          key: 'fresh',
          route: ROUTE,
          requestHash: 'b'.repeat(64),
          statusCode: 201,
          response: {},
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      ],
    });

    expect(await purgeExpired(prisma)).toBe(1);
    expect(await prisma.idempotencyRecord.findUnique({ where: { key: 'fresh' } })).not.toBeNull();
  });
});
