import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { resetDatabase } from '../../../test/reset-db';
import { NEW_LEAD_LIMIT, allowNewLead } from './limits';

const prisma = new PrismaClient({
  datasources: { db: { url: inject('databaseUrl') } },
});

const saved = { APP_ENV: process.env.APP_ENV, OTP_ECHO_ENABLED: process.env.OTP_ECHO_ENABLED };

beforeEach(async () => {
  await resetDatabase(prisma);
  // Production limits: no OTP echo.
  delete process.env.OTP_ECHO_ENABLED;
});

afterAll(async () => {
  process.env.APP_ENV = saved.APP_ENV;
  process.env.OTP_ECHO_ENABLED = saved.OTP_ECHO_ENABLED;
  if (saved.APP_ENV === undefined) delete process.env.APP_ENV;
  if (saved.OTP_ECHO_ENABLED === undefined) delete process.env.OTP_ECHO_ENABLED;
  await resetDatabase(prisma);
  await prisma.$disconnect();
});

describe('allowNewLead (audit V-04)', () => {
  it('lets one address create up to the limit, then refuses with a wait', async () => {
    for (let i = 0; i < NEW_LEAD_LIMIT.max; i++) {
      expect(await allowNewLead(prisma, '203.0.113.9')).toEqual({ allowed: true });
    }
    const refused = await allowNewLead(prisma, '203.0.113.9');
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each address separately', async () => {
    for (let i = 0; i < NEW_LEAD_LIMIT.max; i++) await allowNewLead(prisma, '203.0.113.9');
    expect(await allowNewLead(prisma, '198.51.100.4')).toEqual({ allowed: true });
  });

  it('allows a request with no address rather than lumping them together', async () => {
    expect(await allowNewLead(prisma, null)).toEqual({ allowed: true });
  });

  it('gives UAT ten times the room', async () => {
    process.env.APP_ENV = 'uat';
    process.env.OTP_ECHO_ENABLED = 'true';
    for (let i = 0; i < NEW_LEAD_LIMIT.max + 1; i++) {
      expect((await allowNewLead(prisma, '203.0.113.9')).allowed).toBe(true);
    }
  });
});
