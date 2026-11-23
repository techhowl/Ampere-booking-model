import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { resetDatabase } from '../../../test/reset-db';
import { carriedParams, decideGate, pincodeGateActive } from './gate';
import { parsePrefill, type RawSearchParams } from './prefill';

/**
 * The pincode popup during the Zoho pilot: a pilot dealer within reach opens
 * the journey, anything else goes to Goal App.
 */

const prisma = new PrismaClient({ datasources: { db: { url: inject('databaseUrl') } } });

const GOAL_APP = 'https://enquiry.ampere-electric.com/testride';
const PILOT = '1270103000001901137';
const NOT_PILOT = '1270103000009999999';

/** Koramangala: Neovi Motors, a pilot dealer, is a few km away. */
const PILOT_PINCODE = '560034';
/** Andheri: only a dealer outside the pilot is near. */
const OTHER_PINCODE = '400053';
/** Mysuru: no dealer at all within 15 km. */
const FAR_PINCODE = '570001';

const decide = (params: RawSearchParams, referer?: string) =>
  decideGate(prisma, params, parsePrefill(params, { referer }));

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.pincodeGeo.createMany({
    data: [
      { pincode: PILOT_PINCODE, lat: 12.9352, lng: 77.6245 },
      { pincode: OTHER_PINCODE, lat: 19.1197, lng: 72.8468 },
      { pincode: FAR_PINCODE, lat: 12.2958, lng: 76.6394 },
    ],
  });
  await prisma.dealer.createMany({
    data: [
      { dealerCode: `GEM-${PILOT}`, name: 'Neovi Motors LLP', active: true, crmId: PILOT, lat: 12.9279, lng: 77.6271 },
      { dealerCode: `GEM-${NOT_PILOT}`, name: 'Andheri Ampere', active: true, crmId: NOT_PILOT, lat: 19.1136, lng: 72.8697 },
    ],
  });
  vi.stubEnv('PILOT_DEALER_CRM_IDS', PILOT);
  vi.stubEnv('GOAL_APP_URL', GOAL_APP);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('the pincode popup', () => {
  it('is only on while the pilot and the Goal App hand-off are both set', () => {
    expect(pincodeGateActive()).toBe(true);
    vi.stubEnv('GOAL_APP_URL', '');
    expect(pincodeGateActive()).toBe(false);
    vi.stubEnv('GOAL_APP_URL', GOAL_APP);
    vi.stubEnv('PILOT_DEALER_CRM_IDS', '');
    expect(pincodeGateActive()).toBe(false);
  });

  it('asks first, keeping everything the link carried', async () => {
    const decision = await decide({ model: 'nexus-ex-plus', utm_source: 'meta', gclid: 'abc' });
    expect(decision).toEqual({
      kind: 'ask',
      error: null,
      carried: [
        ['model', 'nexus-ex-plus'],
        ['utm_source', 'meta'],
        ['gclid', 'abc'],
      ],
    });
  });

  it('asks again, with the reason, for a pincode it cannot use', async () => {
    for (const pincode of ['56003', 'abcdef', '960001', '012345']) {
      const decision = await decide({ pincode, utm_source: 'meta' });
      expect(decision.kind).toBe('ask');
      if (decision.kind !== 'ask') continue;
      expect(decision.error).toMatch(/pincode/i);
      // The bad pincode is not carried back; the field asks for it.
      expect(decision.carried).toEqual([['utm_source', 'meta']]);
    }
  });

  it('opens the journey when a pilot dealer serves the pincode', async () => {
    expect(await decide({ pincode: PILOT_PINCODE, model: 'nexus-ex-plus' })).toEqual({ kind: 'journey' });
  });

  it('sends everyone else to Goal App, with the campaign but nothing about the customer', async () => {
    for (const pincode of [OTHER_PINCODE, FAR_PINCODE]) {
      const decision = await decide({ pincode, model: 'nexus-ex-plus', utm_source: 'meta', utm_campaign: 'nov' });
      expect(decision.kind).toBe('goal-app');
      if (decision.kind !== 'goal-app') continue;
      const url = new URL(decision.href);
      expect(`${url.origin}${url.pathname}`).toBe(GOAL_APP);
      expect(Object.fromEntries(url.searchParams)).toEqual({ utm_source: 'meta', utm_campaign: 'nov' });
    }
  });

  it('sends a pincode we hold no location for to Goal App, not into the journey', async () => {
    const decision = await decide({ pincode: '110001' });
    expect(decision.kind).toBe('goal-app');
  });

  it('leaves the page alone once the pilot is over', async () => {
    vi.stubEnv('PILOT_DEALER_CRM_IDS', '');
    expect(await decide({})).toEqual({ kind: 'journey' });
    expect(await decide({ pincode: FAR_PINCODE })).toEqual({ kind: 'journey' });
  });
});

describe('carriedParams', () => {
  it('keeps the scooter a product page implied, which the popup would otherwise lose', () => {
    const params = { utm_source: 'meta' };
    const prefill = parsePrefill(params, { referer: 'https://ampere-electric.com/nexus' });
    expect(prefill.modelFrom).toBe('referrer');
    expect(carriedParams(params, prefill)).toEqual([
      ['utm_source', 'meta'],
      ['model', prefill.modelCode],
    ]);
  });

  it('takes the first of a repeated parameter, and skips empty ones', () => {
    const params = { utm_source: ['meta', 'google'], src: '  ', pincode: '560034' };
    expect(carriedParams(params, parsePrefill(params))).toEqual([['utm_source', 'meta']]);
  });
});
