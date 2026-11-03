import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { resetDatabase } from '../../../test/reset-db';
import type { ZohoConfig } from './config';
import { PrismaTokenProvider } from './token-store';
import { ZohoTokenError } from './zoho';

/**
 * The token cache, against real Postgres — the advisory lock is the thing
 * under test, and a mock of it would prove nothing.
 */

const prisma = new PrismaClient({ datasources: { db: { url: inject('databaseUrl') } } });

const SANDBOX: ZohoConfig = {
  accountsUrl: 'https://accounts.zoho.in',
  apiUrl: 'https://sandbox.zohoapis.in',
  clientId: '1000.CLIENT',
  clientSecret: 'secret-one',
  refreshToken: '1000.refresh',
  leadFunction: 'lead',
  testRideFunction: 'ride',
  dealersFunction: 'dealers',
  timeoutMs: 1000,
};

/** Zoho's token endpoint: hands out tok-1, tok-2, ... and counts the calls. Slow, to widen any race. */
function tokenEndpoint(reply?: () => Response) {
  let calls = 0;
  const fn = (async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 40));
    return reply ? reply() : new Response(JSON.stringify({ access_token: `tok-${calls}`, expires_in: 3600 }));
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaTokenProvider', () => {
  it('mints once, then serves from memory', async () => {
    const zoho = tokenEndpoint();
    const tokens = new PrismaTokenProvider(prisma, SANDBOX, zoho.fn);

    expect(await tokens.get()).toBe('tok-1');
    expect(await tokens.get()).toBe('tok-1');
    expect(zoho.calls()).toBe(1);
  });

  it('lets a second server reuse the stored token instead of minting', async () => {
    const zoho = tokenEndpoint();
    await new PrismaTokenProvider(prisma, SANDBOX, zoho.fn).get();

    expect(await new PrismaTokenProvider(prisma, SANDBOX, zoho.fn).get()).toBe('tok-1');
    expect(zoho.calls()).toBe(1);
  });

  it('stores it encrypted', async () => {
    const zoho = tokenEndpoint();
    await new PrismaTokenProvider(prisma, SANDBOX, zoho.fn).get();

    const row = await prisma.crmToken.findFirstOrThrow();
    expect(Buffer.from(row.tokenEnc).toString('utf8')).not.toContain('tok-1');
  });

  it('mints ONE token when ten requests on three servers all find it expired', async () => {
    const zoho = tokenEndpoint();
    const servers = [1, 2, 3].map(() => new PrismaTokenProvider(prisma, SANDBOX, zoho.fn));

    const tokens = await Promise.all(Array.from({ length: 10 }, (_, i) => servers[i % 3]!.get()));

    expect(zoho.calls()).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(['tok-1']));
  });

  it('renews five minutes before Zoho’s hour is up, as Greaves ask', async () => {
    let now = Date.UTC(2026, 10, 2, 6, 0, 0);
    const zoho = tokenEndpoint();
    const tokens = new PrismaTokenProvider(prisma, SANDBOX, zoho.fn, () => now);

    expect(await tokens.get()).toBe('tok-1');
    now += 54 * 60_000;
    expect(await tokens.get()).toBe('tok-1');
    now += 61_000; // 55 minutes and a second
    expect(await tokens.get()).toBe('tok-2');
    expect(zoho.calls()).toBe(2);
  });

  it('mints a new one when the CRM refuses the current one', async () => {
    const zoho = tokenEndpoint();
    const tokens = new PrismaTokenProvider(prisma, SANDBOX, zoho.fn);

    await tokens.get();
    expect(await tokens.refresh('tok-1')).toBe('tok-2');
    expect(await tokens.get()).toBe('tok-2');
  });

  it('does not mint again if another server already replaced the refused token', async () => {
    const zoho = tokenEndpoint();
    const a = new PrismaTokenProvider(prisma, SANDBOX, zoho.fn);
    const b = new PrismaTokenProvider(prisma, SANDBOX, zoho.fn);

    await a.get();
    expect(await b.refresh('tok-1')).toBe('tok-2');
    expect(await a.refresh('tok-1')).toBe('tok-2');
    expect(zoho.calls()).toBe(2);
  });

  it('replaces a row it cannot decrypt — say, after the client secret was rotated', async () => {
    const zoho = tokenEndpoint();
    await new PrismaTokenProvider(prisma, SANDBOX, zoho.fn).get();

    const rotated = new PrismaTokenProvider(prisma, { ...SANDBOX, clientSecret: 'secret-two' }, zoho.fn);
    expect(await rotated.get()).toBe('tok-2');
  });

  it('stores nothing when Zoho refuses, and says why', async () => {
    const zoho = tokenEndpoint(() => new Response('{"error":"invalid_code"}'));
    const tokens = new PrismaTokenProvider(prisma, SANDBOX, zoho.fn);

    const error = await tokens.get().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ZohoTokenError);
    expect((error as ZohoTokenError).code).toBe('invalid_code');
    expect(await prisma.crmToken.count()).toBe(0);
  });

  it('remembers a refusal for a minute instead of asking Zoho again for every job', async () => {
    let now = Date.UTC(2026, 10, 2, 6, 0, 0);
    const zoho = tokenEndpoint(() => new Response('{"error":"Access Denied"}', { status: 400 }));
    const tokens = new PrismaTokenProvider(prisma, SANDBOX, zoho.fn, () => now);

    for (let i = 0; i < 5; i += 1) await expect(tokens.get()).rejects.toBeInstanceOf(ZohoTokenError);
    expect(zoho.calls()).toBe(1);

    now += 61_000;
    await expect(tokens.get()).rejects.toBeInstanceOf(ZohoTokenError);
    expect(zoho.calls()).toBe(2);
  });

  it('shares one renewal between requests in the same server', async () => {
    const zoho = tokenEndpoint();
    const tokens = new PrismaTokenProvider(prisma, SANDBOX, zoho.fn);

    const all = await Promise.all(Array.from({ length: 8 }, () => tokens.get()));

    expect(new Set(all)).toEqual(new Set(['tok-1']));
    expect(zoho.calls()).toBe(1);
  });

  it('never mixes sandbox and production tokens', async () => {
    const zoho = tokenEndpoint();
    await new PrismaTokenProvider(prisma, SANDBOX, zoho.fn).get();
    const live = new PrismaTokenProvider(prisma, { ...SANDBOX, apiUrl: 'https://www.zohoapis.in' }, zoho.fn);

    expect(await live.get()).toBe('tok-2');
    expect(await prisma.crmToken.count()).toBe(2);
  });
});
