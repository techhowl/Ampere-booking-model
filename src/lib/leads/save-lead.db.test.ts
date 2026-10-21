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

const { saveLead, TRANSACTIONAL, MARKETING } = await import('./save-lead');
const { decryptPhone, hashPhone } = await import('@/lib/crypto/phone');

const CONTEXT = { existingLeadId: null, ip: '203.0.113.9', userAgent: 'vitest' };

const identity = (over: Record<string, unknown> = {}) => ({
  name: 'Asha Menon',
  phone: '9876543210',
  pincode: '560001',
  consent: { transactional: true as const, marketing: false },
  ...over,
});

beforeEach(async () => {
  await resetDatabase(prisma);

  await prisma.dealer.create({
    data: {
      dealerCode: 'AMP-S-001',
      name: 'Ampere Indiranagar',
      phone: '+918040000005',
      homeServiceable: true,
      active: true,
    },
  });
  await prisma.pincodeMap.create({
    data: {
      pincode: '560001',
      stateCode: 'KA',
      regionCode: 'south',
      dealerCode: 'AMP-S-001',
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * The single most valuable behaviour in the specification.
 */
describe('the lead is saved before OTP', () => {
  it('writes the record with phoneVerified false', async () => {
    const { created, response } = await saveLead(prisma, identity(), CONTEXT);

    expect(created).toBe(true);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.leadId } });
    expect(lead.phoneVerified).toBe(false);
    expect(lead.name).toBe('Asha Menon');
    expect(lead.pincode).toBe('560001');
  });

  it('attaches the dealer and region so the lead is callable immediately', async () => {
    const { response } = await saveLead(prisma, identity(), CONTEXT);

    expect(response.serviceable).toBe(true);
    expect(response.dealer?.code).toBe('AMP-S-001');
    expect(response.region?.code).toBe('south');

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.leadId } });
    expect(lead.dealerCode).toBe('AMP-S-001');
    expect(lead.regionCode).toBe('south');
    expect(lead.stateCode).toBe('KA');
  });

  it('still saves a lead for a pincode we do not cover', async () => {
    // No dealer, no region — but a real person who typed their details in.
    const { response } = await saveLead(prisma, identity({ pincode: '999999' }), CONTEXT);

    expect(response.serviceable).toBe(false);
    expect(response.dealer).toBeNull();
    expect(response.region).toBeNull();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.leadId } });
    expect(lead.pincode).toBe('999999');
    expect(lead.regionCode).toBeNull();
  });
});

describe('the phone number', () => {
  it('is stored encrypted, hashed, and never in plaintext', async () => {
    const { response } = await saveLead(prisma, identity(), CONTEXT);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.leadId } });

    expect(decryptPhone(lead.phoneEnc)).toBe('+919876543210');
    expect(lead.phoneHash).toBe(hashPhone('+919876543210'));
    expect(lead.phoneLast4).toBe('3210');

    // Nothing anywhere in the row may be the readable number.
    const serialised = JSON.stringify({ ...lead, phoneEnc: undefined });
    expect(serialised).not.toContain('9876543210');
  });

  it('normalises before hashing, so one customer is never two leads', async () => {
    const a = await saveLead(prisma, identity({ phone: '9876543210' }), CONTEXT);
    const b = await saveLead(prisma, identity({ phone: '+91 98765-43210' }), CONTEXT);

    const leadA = await prisma.lead.findUniqueOrThrow({ where: { id: a.response.leadId } });
    const leadB = await prisma.lead.findUniqueOrThrow({ where: { id: b.response.leadId } });

    expect(leadA.phoneHash).toBe(leadB.phoneHash);
  });

  it('is never returned by the save — only the last four digits', async () => {
    const { response } = await saveLead(prisma, identity(), CONTEXT);

    expect(response.phoneLast4).toBe('3210');
    expect(JSON.stringify(response)).not.toContain('9876543210');
  });
});

describe('consent', () => {
  it('records both purposes separately on a first save', async () => {
    const { response } = await saveLead(
      prisma,
      identity({ consent: { transactional: true, marketing: true } }),
      CONTEXT,
    );

    const consents = await prisma.consent.findMany({ where: { leadId: response.leadId } });
    expect(consents).toHaveLength(2);

    const byPurpose = Object.fromEntries(consents.map((c) => [c.purpose, c]));
    expect(byPurpose[TRANSACTIONAL]?.granted).toBe(true);
    expect(byPurpose[MARKETING]?.granted).toBe(true);
  });

  it('records a declined marketing consent rather than omitting it', async () => {
    // "No" is an answer we must be able to prove we were given.
    const { response } = await saveLead(prisma, identity(), CONTEXT);

    const marketing = await prisma.consent.findFirstOrThrow({
      where: { leadId: response.leadId, purpose: MARKETING },
    });
    expect(marketing.granted).toBe(false);
  });

  it('stamps notice version, IP and user agent', async () => {
    const { response } = await saveLead(prisma, identity(), CONTEXT);

    const consent = await prisma.consent.findFirstOrThrow({
      where: { leadId: response.leadId, purpose: TRANSACTIONAL },
    });
    expect(consent.noticeVersion).toBe('v1');
    expect(consent.ip).toBe('203.0.113.9');
    expect(consent.userAgent).toBe('vitest');
  });
});

describe('returning to a half-finished attempt', () => {
  it('patches the same record instead of creating a second one', async () => {
    const first = await saveLead(prisma, identity(), CONTEXT);

    const second = await saveLead(
      prisma,
      identity({ name: 'Asha M Menon', pincode: '560001' }),
      { ...CONTEXT, existingLeadId: first.response.leadId },
    );

    expect(second.created).toBe(false);
    expect(second.response.leadId).toBe(first.response.leadId);
    expect(await prisma.lead.count()).toBe(1);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: first.response.leadId } });
    expect(lead.name).toBe('Asha M Menon');
  });

  it('does not manufacture a consent event when the answers are unchanged', async () => {
    const first = await saveLead(prisma, identity(), CONTEXT);
    await saveLead(prisma, identity(), { ...CONTEXT, existingLeadId: first.response.leadId });

    expect(await prisma.consent.count({ where: { leadId: first.response.leadId } })).toBe(2);
  });

  it('appends a new consent row when an answer changes', async () => {
    const first = await saveLead(prisma, identity(), CONTEXT);

    await saveLead(
      prisma,
      identity({ consent: { transactional: true, marketing: true } }),
      { ...CONTEXT, existingLeadId: first.response.leadId },
    );

    const marketing = await prisma.consent.findMany({
      where: { leadId: first.response.leadId, purpose: MARKETING },
      orderBy: { grantedAt: 'asc' },
    });

    // Both the original refusal and the later opt-in survive.
    expect(marketing).toHaveLength(2);
    expect(marketing[0]?.granted).toBe(false);
    expect(marketing[1]?.granted).toBe(true);
  });

  it('never resets phoneVerified on a re-save', async () => {
    const first = await saveLead(prisma, identity(), CONTEXT);
    await prisma.lead.update({
      where: { id: first.response.leadId },
      data: { phoneVerified: true },
    });

    await saveLead(prisma, identity({ name: 'Asha Renamed' }), {
      ...CONTEXT,
      existingLeadId: first.response.leadId,
    });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: first.response.leadId } });
    expect(lead.phoneVerified).toBe(true);
  });

  it('un-verifies the lead when the number changes', async () => {
    // Otherwise: verify your own phone, swap in someone else's, book against
    // it with no OTP.
    const first = await saveLead(prisma, identity(), CONTEXT);
    await prisma.lead.update({
      where: { id: first.response.leadId },
      data: { phoneVerified: true },
    });

    await saveLead(prisma, identity({ phone: '9123456780' }), {
      ...CONTEXT,
      existingLeadId: first.response.leadId,
    });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: first.response.leadId } });
    expect(lead.phoneVerified).toBe(false);
    expect(lead.phoneLast4).toBe('6780');
  });

  it('starts a fresh lead when the cookie points at a row that is gone', async () => {
    const { created } = await saveLead(prisma, identity(), {
      ...CONTEXT,
      existingLeadId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    });

    expect(created).toBe(true);
  });
});

describe('prefill', () => {
  it('keeps a model and colour that belong together', async () => {
    const { response } = await saveLead(
      prisma,
      identity({ modelCode: 'nexus-ex-plus', colourCode: 'carbon-knight', intent: 'buy' }),
      CONTEXT,
    );

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.leadId } });
    expect(lead.modelCode).toBe('nexus-ex-plus');
    expect(lead.colourCode).toBe('carbon-knight');
    expect(lead.intent).toBe('buy');
  });

  it('drops a colour the chosen model does not come in', async () => {
    const { response } = await saveLead(
      prisma,
      identity({ modelCode: 'nexus-ex-plus', colourCode: 'ocean-blue' }),
      CONTEXT,
    );

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.leadId } });
    expect(lead.modelCode).toBe('nexus-ex-plus');
    expect(lead.colourCode).toBeNull();
  });

  it('stores attribution as given, for questions asked later', async () => {
    const { response } = await saveLead(
      prisma,
      identity({
        attribution: {
          src: 'product_hero',
          utm: { utm_source: 'google', utm_campaign: 'nexus-launch' },
          gclid: 'abc123',
          sourceRaw: { model: 'nexus-ex-plus', src: 'product_hero', unknown_param: 'kept' },
        },
      }),
      CONTEXT,
    );

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: response.leadId } });
    expect(lead.src).toBe('product_hero');
    expect(lead.gclid).toBe('abc123');
    expect(lead.utm).toEqual({ utm_source: 'google', utm_campaign: 'nexus-launch' });
    expect(lead.sourceRaw).toMatchObject({ unknown_param: 'kept' });
  });
});

describe('dealer fallback', () => {
  it('substitutes another dealer in the region when the mapped one is closed', async () => {
    await prisma.dealer.create({
      data: {
        dealerCode: 'AMP-S-002',
        name: 'Ampere Chennai',
        homeServiceable: false,
        active: true,
      },
    });
    await prisma.dealer.update({
      where: { dealerCode: 'AMP-S-001' },
      data: { active: false },
    });
    await prisma.pincodeMap.create({
      data: {
        pincode: '600001',
        stateCode: 'TN',
        regionCode: 'south',
        dealerCode: 'AMP-S-002',
      },
    });

    const { response } = await saveLead(prisma, identity({ pincode: '560001' }), CONTEXT);

    // Never a dead end: the region is known, so somebody can serve them.
    expect(response.serviceable).toBe(true);
    expect(response.dealer?.code).toBe('AMP-S-002');
  });
});
