import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { resetDatabase } from '../../../test/reset-db';
import type { CrmRecord } from './types';

/**
 * The Zoho pilot (from 2026-11-23): OTP switched off while DLT registration is
 * pending, and only the pilot dealers offered (PILOT_DEALER_CRM_IDS). Everyone
 * else is served by Goal App, so the CRM must not hear of them.
 */

beforeAll(() => {
  process.env.PHONE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PHONE_HMAC_SECRET = randomBytes(32).toString('base64');
});

const prisma = new PrismaClient({ datasources: { db: { url: inject('databaseUrl') } } });

const { enqueueLeadSync, reconcileMissingJobs, runJob } = await import('./jobs');
const { FakeCrmClient } = await import('./fake');
const { phoneColumns } = await import('@/lib/crypto/phone');
const { findNearbyDealers } = await import('@/lib/dealers/nearby');
const { dealerForLead, resolvePincode } = await import('@/lib/dealers/resolve');
const { leadMayProceed } = await import('@/lib/otp/policy');

const NEXUS = '1456765000001702028';
/** Two pilot dealers in Bengaluru, and one in the same city that is not in the pilot. */
const PILOT_NEAR = '1270103000001901137';
const PILOT_FAR = '1270103000001386716';
const NOT_PILOT = '1270103000009999999';

/** Indiranagar. */
const PINCODE = '560038';
/** Mysuru: no dealer of ours within 15 km. */
const FAR_PINCODE = '570001';

let crm: InstanceType<typeof FakeCrmClient>;
const run = (id: string) => runJob(prisma, crm, id, new Date(Date.now() + 60 * 60_000));
const sentLeads = () => crm.calls.filter((c) => c.method === 'lead').map((c) => c.record as CrmRecord);

async function makeLead(over: { verified?: boolean; pincode?: string; dealerCode?: string | null } = {}) {
  const lead = await prisma.lead.create({
    data: {
      name: 'Asha Menon',
      ...phoneColumns('+919876543210'),
      phoneVerified: over.verified ?? false,
      pincode: over.pincode ?? PINCODE,
      dealerCode: over.dealerCode === undefined ? null : over.dealerCode,
      modelCode: 'nexus-ex-plus',
      colourCode: 'carbon-knight',
    },
  });
  return lead.id;
}

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.pincodeGeo.createMany({
    data: [
      { pincode: PINCODE, lat: 12.9784, lng: 77.6408 },
      { pincode: FAR_PINCODE, lat: 12.2958, lng: 76.6394 },
    ],
  });
  await prisma.dealer.createMany({
    data: [
      // The nearest of all, but not in the pilot.
      { dealerCode: `GEM-${NOT_PILOT}`, name: 'Not In Pilot', active: true, crmId: NOT_PILOT, lat: 12.9784, lng: 77.6408 },
      { dealerCode: `GEM-${PILOT_NEAR}`, name: 'Neovi Motors LLP', active: true, crmId: PILOT_NEAR, lat: 12.9352, lng: 77.6245 },
      { dealerCode: `GEM-${PILOT_FAR}`, name: 'Nidhi Ev World', active: true, crmId: PILOT_FAR, lat: 12.9299, lng: 77.5826 },
    ],
  });
  await prisma.crmVehicleModel.create({ data: { modelCode: 'nexus-ex-plus', crmId: NEXUS, crmName: 'EX+' } });
  crm = new FakeCrmClient();
  vi.stubEnv('PILOT_DEALER_CRM_IDS', `${PILOT_NEAR}, ${PILOT_FAR}`);
  vi.stubEnv('OTP_REQUIRED', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('dealers offered during the pilot', () => {
  it('offers only pilot dealers, even when another is nearer', async () => {
    const { dealers } = await findNearbyDealers(prisma, PINCODE);
    expect(dealers.map((d) => d.code)).toEqual([`GEM-${PILOT_NEAR}`, `GEM-${PILOT_FAR}`]);
  });

  it('offers every active dealer again once the setting is gone', async () => {
    vi.stubEnv('PILOT_DEALER_CRM_IDS', '');
    const { dealers } = await findNearbyDealers(prisma, PINCODE);
    expect(dealers[0]?.code).toBe(`GEM-${NOT_PILOT}`);
  });

  it('does not keep a lead on a dealer outside the pilot', async () => {
    const fallback = { code: 'X', name: 'Fallback', phone: null, address: null, homeServiceable: false };
    expect(await dealerForLead(prisma, { dealerCode: `GEM-${NOT_PILOT}` }, fallback)).toBe(fallback);
    expect((await dealerForLead(prisma, { dealerCode: `GEM-${PILOT_FAR}` }, fallback))?.code).toBe(`GEM-${PILOT_FAR}`);
  });

  it('never resolves a pincode to a dealer outside the pilot', async () => {
    await prisma.pincodeMap.create({
      data: { pincode: PINCODE, stateCode: 'KA', regionCode: 'south', dealerCode: `GEM-${NOT_PILOT}` },
    });
    const location = await resolvePincode(prisma, PINCODE);
    expect(location.dealer?.code).not.toBe(`GEM-${NOT_PILOT}`);
  });
});

describe('with the OTP switched off', () => {
  it('lets an unverified lead carry on, and says so only while it is off', async () => {
    expect(leadMayProceed({ phoneVerified: false })).toBe(true);
    vi.stubEnv('OTP_REQUIRED', '');
    expect(leadMayProceed({ phoneVerified: false })).toBe(false);
    expect(leadMayProceed({ phoneVerified: true })).toBe(true);
  });

  it('queues and sends an unverified lead', async () => {
    const leadId = await makeLead({ dealerCode: `GEM-${PILOT_FAR}` });
    const jobId = await enqueueLeadSync(prisma, leadId);
    expect(jobId).not.toBeNull();

    expect(await run(jobId!)).toMatchObject({ state: 'done', outcome: 'created' });
    expect(sentLeads()).toHaveLength(1);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).phoneVerified).toBe(false);
  });

  it('still keeps unverified numbers out with the OTP on', async () => {
    vi.stubEnv('OTP_REQUIRED', 'true');
    expect(await enqueueLeadSync(prisma, await makeLead())).toBeNull();
  });

  it('lets the sweep find an unverified lead whose request died before queueing', async () => {
    const leadId = await makeLead();
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await reconcileMissingJobs(prisma, { now: later })).toEqual({ leads: 1, testRides: 0 });
    expect(await prisma.crmJob.findFirst({ where: { leadId } })).not.toBeNull();
  });
});

describe('the dealer a lead goes to the CRM with', () => {
  it('is the one the customer chose', async () => {
    const jobId = await enqueueLeadSync(prisma, await makeLead({ dealerCode: `GEM-${PILOT_FAR}` }));
    await run(jobId!);
    expect(sentLeads()[0]).toMatchObject({ Dealer_ID: PILOT_FAR, Dealer_Name: 'Nidhi Ev World' });
  });

  it('is the nearest pilot dealer when they stopped before choosing — never none', async () => {
    const jobId = await enqueueLeadSync(prisma, await makeLead({ dealerCode: null }));
    await run(jobId!);
    expect(sentLeads()[0]).toMatchObject({ Dealer_ID: PILOT_NEAR, Dealer_Name: 'Neovi Motors LLP' });
  });

  it('is never a dealer outside the pilot', async () => {
    const jobId = await enqueueLeadSync(prisma, await makeLead({ dealerCode: `GEM-${NOT_PILOT}` }));
    await run(jobId!);
    expect(sentLeads()[0]).toMatchObject({ Dealer_ID: PILOT_NEAR });
  });
});

describe('a customer no pilot dealer serves', () => {
  it('is not sent to the CRM: Goal App serves them', async () => {
    const jobId = await enqueueLeadSync(prisma, await makeLead({ pincode: FAR_PINCODE }));
    expect(await run(jobId!)).toMatchObject({ state: 'done', outcome: 'outside_pilot' });
    expect(sentLeads()).toHaveLength(0);
  });

  it('is sent after all once they move to a pincode a pilot dealer serves', async () => {
    const leadId = await makeLead({ pincode: FAR_PINCODE });
    const jobId = (await enqueueLeadSync(prisma, leadId))!;
    await run(jobId);

    await prisma.lead.update({ where: { id: leadId }, data: { pincode: PINCODE } });
    expect(await enqueueLeadSync(prisma, leadId)).toBe(jobId);
    expect(await run(jobId)).toMatchObject({ state: 'done', outcome: 'created' });
    expect(sentLeads()[0]).toMatchObject({ Pincode: PINCODE, Dealer_ID: PILOT_NEAR });
  });
});
