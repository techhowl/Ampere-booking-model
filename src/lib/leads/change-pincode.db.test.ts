import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { resetDatabase } from '../../../test/reset-db';

beforeAll(() => {
  process.env.PHONE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PHONE_HMAC_SECRET = randomBytes(32).toString('base64');
});

const prisma = new PrismaClient({ datasources: { db: { url: inject('databaseUrl') } } });

const { changePincode } = await import('./change-pincode');
const { phoneColumns } = await import('@/lib/crypto/phone');

async function makeLead(verified = true) {
  const lead = await prisma.lead.create({
    data: {
      name: 'Asha Menon',
      ...phoneColumns('+919876543210'),
      phoneVerified: verified,
      pincode: '400001',
      stateCode: 'MH',
      regionCode: 'west',
      dealerCode: 'AMP-W-001',
      crmLeadId: '1456765000001735362',
    },
  });
  return lead.id;
}

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.dealer.createMany({
    data: [
      { dealerCode: 'AMP-W-001', name: 'Ampere Andheri West', active: true },
      { dealerCode: 'AMP-S-001', name: 'Ampere Indiranagar', active: true },
    ],
  });
  await prisma.pincodeMap.createMany({
    data: [
      { pincode: '400053', stateCode: 'MH', regionCode: 'west', dealerCode: 'AMP-W-001' },
      { pincode: '560038', stateCode: 'KA', regionCode: 'south', dealerCode: 'AMP-S-001' },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('changePincode', () => {
  it('moves the lead to the new pincode, with its region and dealer', async () => {
    const leadId = await makeLead();

    const result = await changePincode(prisma, leadId, '560038');

    expect(result).toMatchObject({
      ok: true,
      lead: { leadId, pincode: '560038', phoneLast4: '3210', region: { code: 'south' }, dealer: { code: 'AMP-S-001' } },
    });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).toMatchObject({
      pincode: '560038',
      stateCode: 'KA',
      regionCode: 'south',
      dealerCode: 'AMP-S-001',
    });
  });

  it('keeps the customer verified and the CRM link — the number has not changed', async () => {
    const leadId = await makeLead();
    await changePincode(prisma, leadId, '560038');
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).toMatchObject({
      phoneVerified: true,
      crmLeadId: '1456765000001735362',
    });
  });

  it('lets go of a dealer chosen for the old pincode when the new one has none', async () => {
    const leadId = await makeLead();
    await changePincode(prisma, leadId, '751024');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).dealerCode).not.toBe('AMP-W-001');
  });

  it('refuses an unverified lead, and one that does not exist', async () => {
    expect(await changePincode(prisma, await makeLead(false), '560038')).toEqual({ ok: false, reason: 'not_verified' });
    expect(await changePincode(prisma, '00000000-0000-4000-8000-000000000000', '560038')).toEqual({
      ok: false,
      reason: 'lead_not_found',
    });
  });
});
