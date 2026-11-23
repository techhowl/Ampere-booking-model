import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { resetDatabase } from '../../../test/reset-db';

beforeAll(() => {
  process.env.PHONE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PHONE_HMAC_SECRET = randomBytes(32).toString('base64');
});

const prisma = new PrismaClient({
  datasources: { db: { url: inject('databaseUrl') } },
});

const { saveLead } = await import('./save-lead');
const { markPhoneVerified } = await import('./mark-verified');
const { hashPhone } = await import('@/lib/crypto/phone');

const OWN = '9876543210';
const OTHER = '9123456780';
const CONTEXT = { existingLeadId: null, ip: null, userAgent: 'vitest' };

const identity = (phone: string) => ({
  name: 'Asha Menon',
  phone,
  pincode: '560001',
  consent: { transactional: true as const, marketing: false },
});

async function newLead(phone = OWN): Promise<string> {
  const { response } = await saveLead(prisma, identity(phone), CONTEXT);
  return response.leadId;
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await resetDatabase(prisma);
  await prisma.$disconnect();
});

describe('markPhoneVerified', () => {
  it('marks the lead while it still carries the proven number', async () => {
    const id = await newLead();
    expect(await markPhoneVerified(prisma, id, hashPhone(`+91${OWN}`))).toBe(true);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id } })).phoneVerified).toBe(true);
  });

  it('refuses once the number changed after the code was checked (audit V-02)', async () => {
    const id = await newLead();
    const proven = (await prisma.lead.findUniqueOrThrow({ where: { id } })).phoneHash;

    // Step one saved again, same session, someone else's number, between the
    // OTP check and the write.
    await saveLead(prisma, identity(OTHER), { ...CONTEXT, existingLeadId: id });

    expect(await markPhoneVerified(prisma, id, proven)).toBe(false);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.phoneHash).toBe(hashPhone(`+91${OTHER}`));
    expect(lead.phoneVerified).toBe(false);
  });

  it('never leaves the other number verified when the two race', async () => {
    for (let i = 0; i < 25; i++) {
      const id = await newLead();
      const proven = (await prisma.lead.findUniqueOrThrow({ where: { id } })).phoneHash;

      await Promise.all([
        markPhoneVerified(prisma, id, proven),
        saveLead(prisma, identity(OTHER), { ...CONTEXT, existingLeadId: id }),
      ]);

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
      const otherVerified = lead.phoneVerified && lead.phoneHash === hashPhone(`+91${OTHER}`);
      expect(otherVerified).toBe(false);
    }
  });

  it('matches nothing for a lead that does not exist', async () => {
    expect(await markPhoneVerified(prisma, '00000000-0000-4000-8000-000000000000', 'x'.repeat(64))).toBe(false);
  });
});
