import { Prisma, PrismaClient } from '@prisma/client';
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

const { chooseDealer } = await import('./choose-dealer');
const { bookTestRide } = await import('@/lib/test-rides/book');
const { createOrder } = await import('@/lib/orders/create-order');
const { FakeDealerNotifier } = await import('@/lib/notifications/dealer');
const { FakeJuspayClient } = await import('@/lib/juspay/juspay');
const { phoneColumns } = await import('@/lib/crypto/phone');

const PINCODE = '560038';
const MODEL = 'nexus-ex-plus';

/** 2026-10-05 07:30 IST, so tomorrow's slots are all open. */
const NOW = new Date('2026-10-05T02:00:00.000Z');

let leadId: string;

async function makeLead(verified = true) {
  const lead = await prisma.lead.create({
    data: {
      name: 'Asha Menon',
      ...phoneColumns('+919876543210'),
      phoneVerified: verified,
      pincode: PINCODE,
      regionCode: 'south',
      // What saveLead writes: the pincode's own dealer.
      dealerCode: 'AMP-S-001',
    },
  });
  return lead.id;
}

beforeEach(async () => {
  await resetDatabase(prisma);

  await prisma.dealer.createMany({
    data: [
      { dealerCode: 'AMP-S-001', name: 'Ampere Indiranagar', lat: 12.9784, lng: 77.6408 },
      { dealerCode: 'AMP-S-003', name: 'Ampere Koramangala', lat: 12.9352, lng: 77.6245 },
      { dealerCode: 'AMP-S-009', name: 'Ampere Mysuru', lat: 12.2958, lng: 76.6394 },
    ],
  });
  await prisma.pincodeMap.create({
    data: { pincode: PINCODE, stateCode: 'KA', regionCode: 'south', dealerCode: 'AMP-S-001' },
  });
  await prisma.pincodeGeo.create({ data: { pincode: PINCODE, lat: 12.9784, lng: 77.6408 } });

  leadId = await makeLead();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('choosing a dealer', () => {
  it('records the choice on the lead', async () => {
    const result = await chooseDealer(prisma, leadId, 'AMP-S-003');

    expect(result.ok).toBe(true);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.dealerCode).toBe('AMP-S-003');
  });

  it('refuses a dealer we would not offer for this pincode', async () => {
    const result = await chooseDealer(prisma, leadId, 'AMP-S-009');

    expect(result).toEqual({ ok: false, reason: 'not_offered' });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.dealerCode).toBe('AMP-S-001');
  });

  it('waits for the OTP, like every step after the first', async () => {
    const unverified = await makeLead(false);
    expect(await chooseDealer(prisma, unverified, 'AMP-S-003')).toEqual({
      ok: false,
      reason: 'not_verified',
    });
  });
});

/** The point of the step: the choice reaches the booking. */
describe('after choosing', () => {
  beforeEach(async () => {
    await chooseDealer(prisma, leadId, 'AMP-S-003');
  });

  it('books the test ride with the chosen dealer', async () => {
    const result = await bookTestRide(
      prisma,
      new FakeDealerNotifier(),
      {
        leadId,
        modelCode: MODEL,
        mode: 'dealer',
        slotDate: '2026-10-06',
        slotWindow: 'w2',
      },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.dealer.code).toBe('AMP-S-003');
  });

  it('attaches the chosen dealer to the order', async () => {
    await prisma.priceBook.create({
      data: {
        modelCode: MODEL,
        regionCode: 'south',
        amountTotal: new Prisma.Decimal(100000),
        rtoCharges: new Prisma.Decimal(10000),
        effectiveFrom: new Date('2026-01-01'),
      },
    });
    // Stock at the dealer they actually chose. Without this the fallback
    // correctly moves the order elsewhere — which is a different test.
    await prisma.inventory.create({
      data: { modelCode: MODEL, dealerCode: 'AMP-S-003', unitsTotal: 5 },
    });

    const order = await createOrder(
      prisma,
      new FakeJuspayClient(),
      { leadId, modelCode: MODEL, paymentType: 'full' },
      'https://buy.ampere-electric.com/buy/return',
    );

    const row = await prisma.order.findUniqueOrThrow({ where: { orderId: order.orderId } });
    expect(row.dealerCode).toBe('AMP-S-003');
  });

  it("falls back to the pincode's dealer if the chosen one closes", async () => {
    await prisma.dealer.update({
      where: { dealerCode: 'AMP-S-003' },
      data: { active: false },
    });

    const result = await bookTestRide(
      prisma,
      new FakeDealerNotifier(),
      { leadId, modelCode: MODEL, mode: 'dealer', slotDate: '2026-10-06', slotWindow: 'w2' },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.booking.dealer.code).toBe('AMP-S-001');
  });
});
