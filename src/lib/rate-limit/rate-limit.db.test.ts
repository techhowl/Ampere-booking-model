import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { consume, purgeExpired, secondsUntilReset, type LimitRule } from './rate-limit';

const prisma = new PrismaClient({
  datasources: { db: { url: inject('databaseUrl') } },
});

const SCOPE = 'otp_request';

const phoneRule = (max: number, windowSeconds = 3600): LimitRule => ({
  kind: 'phone',
  subject: 'hash-abc',
  max,
  windowSeconds,
});

beforeEach(async () => {
  await prisma.rateLimit.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('consume', () => {
  it('allows up to the limit and refuses after it', async () => {
    const rule = phoneRule(3);

    for (let i = 0; i < 3; i++) {
      expect((await consume(prisma, SCOPE, [rule])).allowed, `call ${i + 1}`).toBe(true);
    }

    const refused = await consume(prisma, SCOPE, [rule]);
    expect(refused.allowed).toBe(false);
    expect(refused.blockedBy).toBe('phone');
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('starts a fresh window once the old one has elapsed', async () => {
    const rule = phoneRule(1, 1);

    expect((await consume(prisma, SCOPE, [rule])).allowed).toBe(true);
    expect((await consume(prisma, SCOPE, [rule])).allowed).toBe(false);

    // Wind the window into the past rather than waiting for it.
    await prisma.rateLimit.updateMany({
      data: { windowStart: new Date(Date.now() - 5000) },
    });

    expect((await consume(prisma, SCOPE, [rule])).allowed).toBe(true);
  });

  it('keeps dimensions independent', async () => {
    const phone: LimitRule = { kind: 'phone', subject: 'hash-abc', max: 1, windowSeconds: 3600 };
    const ip: LimitRule = { kind: 'ip', subject: '203.0.113.9', max: 5, windowSeconds: 3600 };

    expect((await consume(prisma, SCOPE, [phone, ip])).allowed).toBe(true);

    // This phone is done, but the IP has quota left for other numbers.
    expect((await consume(prisma, SCOPE, [phone, ip])).allowed).toBe(false);

    const otherPhone: LimitRule = { ...phone, subject: 'hash-xyz' };
    expect((await consume(prisma, SCOPE, [otherPhone, ip])).allowed).toBe(true);
  });

  it('does not burn a later dimension when an earlier one refuses', async () => {
    const phone: LimitRule = { kind: 'phone', subject: 'hash-abc', max: 0, windowSeconds: 3600 };
    const ip: LimitRule = { kind: 'ip', subject: '203.0.113.9', max: 5, windowSeconds: 3600 };

    // max 0 means the first call is already over the limit... but only once a
    // window exists. Establish one, then exhaust it.
    await consume(prisma, SCOPE, [{ ...phone, max: 1 }, ip]);
    const refused = await consume(prisma, SCOPE, [{ ...phone, max: 1 }, ip]);
    expect(refused.allowed).toBe(false);

    const ipRow = await prisma.rateLimit.findUniqueOrThrow({
      where: { scope_kind_subject: { scope: SCOPE, kind: 'ip', subject: '203.0.113.9' } },
    });
    // The IP was charged once for the allowed call, not twice.
    expect(ipRow.count).toBe(1);
  });

  it('keeps separate scopes separate', async () => {
    const rule = phoneRule(1);

    expect((await consume(prisma, SCOPE, [rule])).allowed).toBe(true);
    expect((await consume(prisma, SCOPE, [rule])).allowed).toBe(false);
    expect((await consume(prisma, 'other_scope', [rule])).allowed).toBe(true);
  });
});

/**
 * The reason the counter is read FOR UPDATE. Two requests arriving together
 * must not both read the same count and both conclude they are under it.
 */
describe('simultaneous requests', () => {
  it('never lets more than the limit through', async () => {
    const rule = phoneRule(3);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => consume(prisma, SCOPE, [rule])),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(3);

    const row = await prisma.rateLimit.findUniqueOrThrow({
      where: { scope_kind_subject: { scope: SCOPE, kind: 'phone', subject: 'hash-abc' } },
    });
    expect(row.count).toBe(3);
  });
});

describe('secondsUntilReset', () => {
  it('is zero when nothing has been counted', async () => {
    expect(await secondsUntilReset(prisma, SCOPE, 'phone', 'hash-abc', 60)).toBe(0);
  });

  it('reports the remaining window without consuming quota', async () => {
    const rule = phoneRule(1, 60);
    await consume(prisma, SCOPE, [rule]);

    const remaining = await secondsUntilReset(prisma, SCOPE, 'phone', 'hash-abc', 60);
    expect(remaining).toBeGreaterThan(50);
    expect(remaining).toBeLessThanOrEqual(60);

    const row = await prisma.rateLimit.findUniqueOrThrow({
      where: { scope_kind_subject: { scope: SCOPE, kind: 'phone', subject: 'hash-abc' } },
    });
    expect(row.count).toBe(1);
  });
});

describe('purgeExpired', () => {
  it('removes only windows older than the cutoff', async () => {
    await prisma.rateLimit.createMany({
      data: [
        {
          scope: SCOPE,
          kind: 'phone',
          subject: 'old',
          count: 1,
          windowStart: new Date(Date.now() - 200_000),
        },
        {
          scope: SCOPE,
          kind: 'phone',
          subject: 'fresh',
          count: 1,
          windowStart: new Date(),
        },
      ],
    });

    expect(await purgeExpired(prisma, 100)).toBe(1);
    expect(await prisma.rateLimit.count()).toBe(1);
  });
});
