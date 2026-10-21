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

const { loadResume } = await import('./resume');
const { encodeJourney, prefillSignature } = await import('./journey-state');
const { parsePrefill } = await import('./prefill');
const { phoneColumns } = await import('@/lib/crypto/phone');

const PINCODE = '560038';
const NOW = new Date('2026-10-05T02:00:00.000Z');
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

let leadId: string;

const prefill = parsePrefill({ model: 'nexus-ex-plus' });

function session(over: { verified?: boolean; idleMinutes?: number } = {}) {
  return {
    leadId,
    verified: over.verified ?? true,
    seenAt: seconds(NOW) - (over.idleMinutes ?? 5) * 60,
  };
}

function journey(over: Record<string, unknown> = {}) {
  return encodeJourney({
    step: 'journey',
    model: 'nexus-ex-plus',
    colour: 'steel-grey',
    dealer: 'AMP-S-003',
    intent: 'testride',
    booking: null,
    from: prefillSignature(prefill),
    ...over,
  });
}

const resume = (opts: { session?: ReturnType<typeof session> | null; journeyRaw?: string | null; p?: typeof prefill }) =>
  loadResume(prisma, {
    session: opts.session === undefined ? session() : opts.session,
    journeyRaw: opts.journeyRaw === undefined ? journey() : opts.journeyRaw,
    prefill: opts.p ?? prefill,
    now: NOW,
  });

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.dealer.createMany({
    data: [
      { dealerCode: 'AMP-S-001', name: 'Ampere Indiranagar', lat: 12.9784, lng: 77.6408 },
      { dealerCode: 'AMP-S-003', name: 'Ampere Koramangala', lat: 12.9352, lng: 77.6245 },
    ],
  });
  await prisma.pincodeMap.create({
    data: { pincode: PINCODE, stateCode: 'KA', regionCode: 'south', dealerCode: 'AMP-S-001' },
  });
  await prisma.pincodeGeo.create({ data: { pincode: PINCODE, lat: 12.9784, lng: 77.6408 } });

  const lead = await prisma.lead.create({
    data: {
      name: 'Asha Menon',
      ...phoneColumns('+919876543210'),
      phoneVerified: true,
      pincode: PINCODE,
      regionCode: 'south',
      // Chosen at the dealer step.
      dealerCode: 'AMP-S-003',
    },
  });
  leadId = lead.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('a refresh within the hour', () => {
  it('lands on the same step with the same choices', async () => {
    const r = await resume({});

    expect(r).toMatchObject({
      verified: true,
      step: 'journey',
      modelCode: 'nexus-ex-plus',
      colourCode: 'steel-grey',
      intent: 'testride',
      name: 'Asha Menon',
    });
    expect(r?.dealer?.code).toBe('AMP-S-003');
    expect(r?.catalog?.length).toBeGreaterThan(0);
  });

  it('gives the browser the last four digits of the number and nothing more', async () => {
    const r = await resume({});
    expect(r?.lead.phoneLast4).toBe('3210');
    expect(JSON.stringify(r)).not.toContain('9876543210');
  });
});

describe('after the idle limit', () => {
  it('resumes nothing', async () => {
    expect(await resume({ session: session({ idleMinutes: 61 }) })).toBeNull();
  });

  it('resumes nothing without a session, whatever the bookmark says', async () => {
    expect(await resume({ session: null })).toBeNull();
  });
});

describe('a number not verified in this browser', () => {
  it('goes back to the OTP, with no catalog, dealer or booking', async () => {
    const r = await resume({ session: session({ verified: false }) });
    expect(r).toMatchObject({ verified: false, step: 'details', dealer: null, catalog: null });
  });

  it('goes back to the OTP when the lead lost its verification — a changed number', async () => {
    await prisma.lead.update({ where: { id: leadId }, data: { phoneVerified: false } });
    expect((await resume({}))?.verified).toBe(false);
  });
});

describe('the bookmark is only a hint', () => {
  it('ignores a dealer that is not the one recorded on the lead', async () => {
    const r = await resume({ journeyRaw: journey({ dealer: 'AMP-S-001' }) });
    expect(r?.dealer).toBeNull();
  });

  it("will not show someone else's test ride", async () => {
    const other = await prisma.lead.create({
      data: { name: 'Someone Else', ...phoneColumns('+919123456780'), pincode: PINCODE },
    });
    const ride = await prisma.testRide.create({
      data: {
        leadId: other.id,
        dealerCode: 'AMP-S-001',
        modelCode: 'nexus-ex-plus',
        mode: 'dealer',
        slotDate: new Date('2026-10-06'),
        slotWindow: 'w2',
      },
    });

    const r = await resume({ journeyRaw: journey({ step: 'finish', booking: ride.id }) });
    expect(r?.booking).toBeNull();
  });

  it('shows their own test ride again after a refresh on the confirmation', async () => {
    const ride = await prisma.testRide.create({
      data: {
        leadId,
        dealerCode: 'AMP-S-003',
        modelCode: 'nexus-ex-plus',
        mode: 'dealer',
        slotDate: new Date('2026-10-06'),
        slotWindow: 'w2',
      },
    });

    const r = await resume({ journeyRaw: journey({ step: 'finish', booking: ride.id }) });
    expect(r?.booking).toMatchObject({
      bookingId: ride.id,
      dealer: { name: 'Ampere Koramangala' },
      slot: 'Tomorrow, 13:00 – 15:00',
    });
  });

  it('survives a bookmark that is garbage', async () => {
    const r = await resume({ journeyRaw: 'garbage' });
    expect(r).toMatchObject({ verified: true, step: 'scooter', modelCode: 'nexus-ex-plus' });
  });
});

describe('arriving again from a different product page', () => {
  it('opens that product, still signed in, at the scooter step', async () => {
    const r = await resume({ p: parsePrefill({ model: 'reovyb' }) });
    expect(r).toMatchObject({ verified: true, step: 'scooter', modelCode: 'reo-vyb', dealer: null });
  });
});
