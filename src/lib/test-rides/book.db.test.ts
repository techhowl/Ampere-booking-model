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

const { bookTestRide } = await import('./book');
const { FakeDealerNotifier } = await import('@/lib/notifications/dealer');
const { phoneColumns } = await import('@/lib/crypto/phone');

/** 2026-10-05 02:00 UTC = 07:30 IST. Everything today is still open. */
const NOW = new Date('2026-10-05T02:00:00.000Z');
const TOMORROW = '2026-10-06';

let notifier: InstanceType<typeof FakeDealerNotifier>;
let leadId: string;

async function makeLead(over: { pincode?: string; verified?: boolean } = {}) {
  const lead = await prisma.lead.create({
    data: {
      name: 'Asha Menon',
      ...phoneColumns('+919876543210'),
      phoneVerified: over.verified ?? true,
      pincode: over.pincode ?? '560001',
    },
  });
  return lead.id;
}

const input = (over: Record<string, unknown> = {}) => ({
  leadId,
  modelCode: 'nexus-ex-plus',
  colourCode: 'carbon-knight',
  mode: 'dealer' as const,
  slotDate: TOMORROW,
  slotWindow: 'w2',
  ...over,
});

beforeEach(async () => {
  await resetDatabase(prisma);

  await prisma.dealer.create({
    data: {
      dealerCode: 'AMP-S-001',
      name: 'Ampere Indiranagar',
      phone: '+918040000005',
      address: '100 Feet Road, Bengaluru',
      homeServiceable: true,
      active: true,
    },
  });
  await prisma.pincodeMap.create({
    data: { pincode: '560001', stateCode: 'KA', regionCode: 'south', dealerCode: 'AMP-S-001' },
  });

  notifier = new FakeDealerNotifier();
  leadId = await makeLead();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('booking a ride', () => {
  it('stores the booking and tells the dealer', async () => {
    const result = await bookTestRide(prisma, notifier, input(), NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.booking.slot).toBe('Tomorrow, 1:00 PM – 3:00 PM');
    expect(result.booking.dealer.name).toBe('Ampere Indiranagar');
    expect(result.booking.dealerNotified).toBe(true);

    const row = await prisma.testRide.findUniqueOrThrow({
      where: { id: result.booking.bookingId },
    });
    expect(row.mode).toBe('dealer');
    expect(row.slotWindow).toBe('w2');
    expect(row.status).toBe('booked');
    expect(row.colourCode).toBe('carbon-knight');
  });

  it('records the slot date without sliding a day', async () => {
    const result = await bookTestRide(prisma, notifier, input(), NOW);
    if (!result.ok) throw new Error('expected success');

    const row = await prisma.testRide.findUniqueOrThrow({
      where: { id: result.booking.bookingId },
    });
    expect(row.slotDate.toISOString().slice(0, 10)).toBe(TOMORROW);
  });

  it('marks the lead as a test ride and attaches the dealer', async () => {
    await bookTestRide(prisma, notifier, input(), NOW);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.intent).toBe('testride');
    expect(lead.dealerCode).toBe('AMP-S-001');
    expect(lead.modelCode).toBe('nexus-ex-plus');
    expect(lead.status).toBe('test_ride_booked');
  });

  it('sends the dealer the slot and the model, but not the phone number', async () => {
    await bookTestRide(prisma, notifier, input(), NOW);

    const sent = notifier.lastFor('AMP-S-001');
    expect(sent?.customerName).toBe('Asha Menon');
    expect(sent?.modelName).toBe('Nexus EX+');
    expect(sent?.colourName).toBe('Carbon Knight');
    expect(sent?.slot).toBe('Tomorrow, 1:00 PM – 3:00 PM');

    expect(sent?.customerPhoneLast4).toBe('3210');
    expect(JSON.stringify(sent)).not.toContain('9876543210');
  });

  it('drops a colour the model does not come in', async () => {
    const result = await bookTestRide(
      prisma,
      notifier,
      input({ colourCode: 'ocean-blue' }),
      NOW,
    );
    if (!result.ok) throw new Error('expected success');

    expect(result.booking.colourCode).toBeNull();
  });
});

/**
 * Spec 7: "Inventory is not decremented by a test ride booking. Test rides use
 * demo stock, which is a different thing from sale stock."
 */
describe('inventory', () => {
  it('is untouched by a booking', async () => {
    await prisma.inventory.create({
      data: {
        modelCode: 'nexus-ex-plus',
        dealerCode: 'AMP-S-001',
        unitsTotal: 15,
        unitsReserved: 0,
      },
    });

    await bookTestRide(prisma, notifier, input(), NOW);

    const stock = await prisma.inventory.findUniqueOrThrow({
      where: {
        modelCode_dealerCode: { modelCode: 'nexus-ex-plus', dealerCode: 'AMP-S-001' },
      },
    });
    expect(stock.unitsTotal).toBe(15);
    expect(stock.unitsReserved).toBe(0);
  });
});

/**
 * Spec 7: "Home requires a serviceable pincode; if not serviceable, fall back
 * to dealership with an explanation rather than a dead end."
 */
describe('home mode', () => {
  it('is honoured where the dealer offers it', async () => {
    const result = await bookTestRide(prisma, notifier, input({ mode: 'home' }), NOW);
    if (!result.ok) throw new Error('expected success');

    expect(result.booking.mode).toBe('home');
    expect(result.booking.modeChangedReason).toBeNull();
  });

  it('falls back to the showroom with an explanation, not a refusal', async () => {
    await prisma.dealer.update({
      where: { dealerCode: 'AMP-S-001' },
      data: { homeServiceable: false },
    });

    const result = await bookTestRide(prisma, notifier, input({ mode: 'home' }), NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.booking.mode).toBe('dealer');
    expect(result.booking.modeChangedReason).toContain('showroom');

    // The dealer must be told where the ride actually is.
    expect(notifier.lastFor('AMP-S-001')?.mode).toBe('dealer');
  });
});

describe('dealer resolution', () => {
  it('substitutes another dealer in the region when the mapped one closes', async () => {
    await prisma.dealer.create({
      data: { dealerCode: 'AMP-S-002', name: 'Ampere Chennai', active: true },
    });
    await prisma.pincodeMap.create({
      data: {
        pincode: '600001',
        stateCode: 'TN',
        regionCode: 'south',
        dealerCode: 'AMP-S-002',
      },
    });
    await prisma.dealer.update({
      where: { dealerCode: 'AMP-S-001' },
      data: { active: false },
    });

    const result = await bookTestRide(prisma, notifier, input(), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.booking.dealer.code).toBe('AMP-S-002');
  });

  it('refuses when no dealer covers the customer at all', async () => {
    leadId = await makeLead({ pincode: '999999' });

    const result = await bookTestRide(prisma, notifier, input(), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_dealer');
  });
});

describe('what is refused', () => {
  it('an unverified lead', async () => {
    leadId = await makeLead({ verified: false });

    const result = await bookTestRide(prisma, notifier, input(), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_verified');
  });

  it('a lead that does not exist', async () => {
    const result = await bookTestRide(
      prisma,
      notifier,
      input({ leadId: '0f8fad5b-d9cb-469f-a165-70867728950e' }),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('lead_not_found');
  });

  it('a model we do not sell', async () => {
    const result = await bookTestRide(prisma, notifier, input({ modelCode: 'foo' }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_model');
  });

  it('a slot outside the seven-day window', async () => {
    const result = await bookTestRide(prisma, notifier, input({ slotDate: '2026-11-20' }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'bad_slot') {
      expect(result.detail).toBe('out_of_range');
    } else {
      throw new Error('expected bad_slot');
    }
  });

  it('a slot in the past', async () => {
    const result = await bookTestRide(prisma, notifier, input({ slotDate: '2026-10-01' }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'bad_slot') expect(result.detail).toBe('out_of_range');
  });

  it('a window code we never offered', async () => {
    const result = await bookTestRide(prisma, notifier, input({ slotWindow: 'w9' }), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'bad_slot') expect(result.detail).toBe('unknown_window');
  });
});

describe('when the dealer cannot be reached', () => {
  it('keeps the booking and says the notification failed', async () => {
    notifier.failOnce();

    const result = await bookTestRide(prisma, notifier, input(), NOW);

    // Losing a confirmed ride over a flaky message would be the worse outcome.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.dealerNotified).toBe(false);

    expect(await prisma.testRide.count()).toBe(1);
  });
});

describe('a repeated booking of the same slot', () => {
  it('returns the existing one rather than a duplicate', async () => {
    const first = await bookTestRide(prisma, notifier, input(), NOW);
    const second = await bookTestRide(prisma, notifier, input(), NOW);

    if (!first.ok || !second.ok) throw new Error('expected success');
    expect(second.booking.bookingId).toBe(first.booking.bookingId);
    expect(await prisma.testRide.count()).toBe(1);
  });

  it('allows a genuinely different slot', async () => {
    await bookTestRide(prisma, notifier, input(), NOW);
    const second = await bookTestRide(prisma, notifier, input({ slotWindow: 'w3' }), NOW);

    expect(second.ok).toBe(true);
    expect(await prisma.testRide.count()).toBe(2);
  });
});
