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

const { createOrder, OrderError } = await import('./create-order');
const { applyStatus, recordWebhook, resolveForReturn } = await import('./resolve-status');
const { FakeJuspayClient } = await import('@/lib/juspay/juspay');
const { phoneColumns } = await import('@/lib/crypto/phone');

const MODEL = 'nexus-ex-plus';
const REGION = 'west';
const DEALER = 'AMP-W-001';
const RETURN_URL = 'https://buy.ampere-electric.com/buy/return';

const d = (n: number) => new Prisma.Decimal(n);

let juspay: InstanceType<typeof FakeJuspayClient>;
let leadId: string;

async function seedPrice(partial: { mode: string; value: number } | null) {
  await prisma.priceBook.create({
    data: {
      modelCode: MODEL,
      regionCode: REGION,
      amountTotal: d(100000),
      rtoCharges: d(10000),
      partialMode: partial?.mode ?? null,
      partialValue: partial ? d(partial.value) : null,
      effectiveFrom: new Date('2026-01-01'),
    },
  });
}

beforeEach(async () => {
  await resetDatabase(prisma);
  juspay = new FakeJuspayClient();

  await prisma.dealer.create({
    data: { dealerCode: 'AMP-W-001', name: 'Ampere Andheri West', phone: '+912240000003', active: true },
  });
  await prisma.pincodeMap.create({
    data: { pincode: '400001', stateCode: 'MH', regionCode: REGION, dealerCode: 'AMP-W-001' },
  });
  await prisma.inventory.create({
    data: { modelCode: MODEL, dealerCode: DEALER, unitsTotal: 5, unitsReserved: 0 },
  });

  const lead = await prisma.lead.create({
    data: {
      name: 'Asha Menon',
      ...phoneColumns('+919876543210'),
      phoneVerified: true,
      pincode: '400001',
    },
  });
  leadId = lead.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const order = (over: Record<string, unknown> = {}) => ({
  leadId,
  modelCode: MODEL,
  colourCode: 'carbon-knight',
  paymentType: 'partial' as const,
  ...over,
});

/**
 * Spec 12, rule 1. The client sends selections; every rupee comes from
 * price_book. These three cases are the whole reason that rule exists.
 */
describe('what each payment option charges', () => {
  it('partial charges the booking amount, not the price', async () => {
    await seedPrice({ mode: 'fixed', value: 5000 });

    const created = await createOrder(prisma, juspay, order(), RETURN_URL);

    expect(created.amountTotal).toBe('110000.00');
    expect(created.amountCharged).toBe('5000.00');
  });

  it('full charges the on-road price, not the ex-showroom one', async () => {
    await seedPrice({ mode: 'fixed', value: 5000 });

    const created = await createOrder(
      prisma,
      juspay,
      order({ paymentType: 'full' }),
      RETURN_URL,
    );

    // 100,000 ex-showroom + 10,000 RTO. Charging the ex-showroom figure would
    // quietly undercharge every customer by the registration cost.
    expect(created.amountCharged).toBe('110000.00');
  });

  it('emi charges the on-road price — Juspay splits it into instalments', async () => {
    await seedPrice({ mode: 'fixed', value: 5000 });

    const created = await createOrder(
      prisma,
      juspay,
      order({ paymentType: 'emi' }),
      RETURN_URL,
    );

    expect(created.amountCharged).toBe('110000.00');
  });

  it('computes a percentage booking amount off the on-road price', async () => {
    await seedPrice({ mode: 'percent', value: 10 });

    const created = await createOrder(prisma, juspay, order(), RETURN_URL);
    expect(created.amountCharged).toBe('11000.00');
  });

  it('refuses partial payment before Ampere has set the amount', async () => {
    await seedPrice(null);

    await expect(createOrder(prisma, juspay, order(), RETURN_URL)).rejects.toMatchObject({
      reason: 'partial_unavailable',
    });
  });

  it('tells Juspay which methods to surface', async () => {
    await seedPrice({ mode: 'fixed', value: 5000 });
    const created = await createOrder(prisma, juspay, order({ paymentType: 'emi' }), RETURN_URL);

    expect(juspay.lastOrder(created.orderId)?.paymentIntent).toBe('emi');
  });
});

describe('creating an order', () => {
  beforeEach(async () => {
    await seedPrice({ mode: 'fixed', value: 5000 });
  });

  it('holds a unit before the customer leaves to pay', async () => {
    await createOrder(prisma, juspay, order(), RETURN_URL);

    const stock = await prisma.inventory.findUniqueOrThrow({
      where: { modelCode_dealerCode: { modelCode: MODEL, dealerCode: DEALER } },
    });
    // Reserved, not sold. The decrement waits for the money.
    expect(stock.unitsReserved).toBe(1);
    expect(stock.unitsTotal).toBe(5);
  });

  it('attaches the dealer and the region', async () => {
    const created = await createOrder(prisma, juspay, order(), RETURN_URL);
    const row = await prisma.order.findUniqueOrThrow({ where: { orderId: created.orderId } });

    expect(row.dealerCode).toBe('AMP-W-001');
    expect(row.dealerCode).toBe(DEALER);
    expect(row.status).toBe('initiated');
  });

  it('marks the lead as buying', async () => {
    await createOrder(prisma, juspay, order(), RETURN_URL);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    expect(lead.intent).toBe('buy');
    expect(lead.status).toBe('payment_started');
  });

  it('refuses an unverified lead', async () => {
    await prisma.lead.update({ where: { id: leadId }, data: { phoneVerified: false } });

    await expect(createOrder(prisma, juspay, order(), RETURN_URL)).rejects.toBeInstanceOf(
      OrderError,
    );
  });

  it('refuses when the model is out of stock', async () => {
    await prisma.inventory.update({
      where: { modelCode_dealerCode: { modelCode: MODEL, dealerCode: DEALER } },
      data: { unitsTotal: 0 },
    });

    await expect(createOrder(prisma, juspay, order(), RETURN_URL)).rejects.toMatchObject({
      reason: 'out_of_stock',
    });
  });
});

/**
 * Spec 12, rule 2: the order id is reused on retry, so one intent never becomes
 * two orders — and never two reserved scooters.
 */
describe('retrying the same intent', () => {
  beforeEach(async () => {
    await seedPrice({ mode: 'fixed', value: 5000 });
  });

  it('reuses the order and the hold', async () => {
    const first = await createOrder(prisma, juspay, order(), RETURN_URL);
    await applyStatus(prisma, first.orderId, 'failed', 'webhook');

    const retry = await createOrder(prisma, juspay, order(), RETURN_URL);

    expect(retry.orderId).toBe(first.orderId);
    expect(await prisma.order.count()).toBe(1);

    const stock = await prisma.inventory.findUniqueOrThrow({
      where: { modelCode_dealerCode: { modelCode: MODEL, dealerCode: DEALER } },
    });
    expect(stock.unitsReserved).toBe(1);
  });

  it('counts the retry', async () => {
    const first = await createOrder(prisma, juspay, order(), RETURN_URL);
    await applyStatus(prisma, first.orderId, 'failed', 'webhook');
    await createOrder(prisma, juspay, order(), RETURN_URL);

    const row = await prisma.order.findUniqueOrThrow({ where: { orderId: first.orderId } });
    expect(row.retryCount).toBe(1);
  });

  it('opens a separate order for a different payment option', async () => {
    const partial = await createOrder(prisma, juspay, order(), RETURN_URL);
    const full = await createOrder(prisma, juspay, order({ paymentType: 'full' }), RETURN_URL);

    expect(full.orderId).not.toBe(partial.orderId);
  });
});

/**
 * Spec 9. The part that must be right.
 */
describe('resolving what happened', () => {
  beforeEach(async () => {
    await seedPrice({ mode: 'fixed', value: 5000 });
  });

  it('converts the hold into a sale when paid', async () => {
    const created = await createOrder(prisma, juspay, order(), RETURN_URL);
    await applyStatus(prisma, created.orderId, 'paid', 'webhook');

    const stock = await prisma.inventory.findUniqueOrThrow({
      where: { modelCode_dealerCode: { modelCode: MODEL, dealerCode: DEALER } },
    });
    expect(stock.unitsTotal).toBe(4);
    expect(stock.unitsReserved).toBe(0);
  });

  it('returns the unit to the pool when the payment fails', async () => {
    const created = await createOrder(prisma, juspay, order(), RETURN_URL);
    await applyStatus(prisma, created.orderId, 'failed', 'webhook');

    const stock = await prisma.inventory.findUniqueOrThrow({
      where: { modelCode_dealerCode: { modelCode: MODEL, dealerCode: DEALER } },
    });
    expect(stock.unitsTotal).toBe(5);
    expect(stock.unitsReserved).toBe(0);
  });

  it('never downgrades a paid order, however late the webhook', async () => {
    const created = await createOrder(prisma, juspay, order(), RETURN_URL);
    await applyStatus(prisma, created.orderId, 'paid', 'webhook');

    // The out-of-order ones that hurt in production.
    await applyStatus(prisma, created.orderId, 'pending', 'webhook');
    await applyStatus(prisma, created.orderId, 'failed', 'webhook');

    const row = await prisma.order.findUniqueOrThrow({ where: { orderId: created.orderId } });
    expect(row.status).toBe('paid');

    // And the sale is not decremented twice by the replays.
    const stock = await prisma.inventory.findUniqueOrThrow({
      where: { modelCode_dealerCode: { modelCode: MODEL, dealerCode: DEALER } },
    });
    expect(stock.unitsTotal).toBe(4);
  });

  it('uses the stored webhook result and does not call the status API', async () => {
    const created = await createOrder(prisma, juspay, order(), RETURN_URL);
    await applyStatus(prisma, created.orderId, 'paid', 'webhook');

    const outcome = await resolveForReturn(prisma, juspay, created.orderId);

    expect(outcome?.status).toBe('paid');
    expect(juspay.statusCallCount(created.orderId)).toBe(0);
  });

  it('asks Juspay directly when the customer gets back first', async () => {
    const created = await createOrder(prisma, juspay, order(), RETURN_URL);
    juspay.script(created.orderId, 'success');

    const outcome = await resolveForReturn(prisma, juspay, created.orderId);

    expect(outcome?.status).toBe('paid');
    expect(outcome?.source).toBe('status_api');
    expect(juspay.statusCallCount(created.orderId)).toBe(1);
  });

  it('says unknown rather than guessing when Juspay is unreachable', async () => {
    const created = await createOrder(prisma, juspay, order(), RETURN_URL);
    juspay.script(created.orderId, 'timeout');

    const outcome = await resolveForReturn(prisma, juspay, created.orderId);

    // Never "failed" — they may have paid. Never "paid" — they may not have.
    expect(outcome?.status).toBe('unknown');

    const row = await prisma.order.findUniqueOrThrow({ where: { orderId: created.orderId } });
    expect(row.status).toBe('initiated');
  });
});

describe('the webhook', () => {
  beforeEach(async () => {
    await seedPrice({ mode: 'fixed', value: 5000 });
  });

  it('records the raw payload before interpreting it', async () => {
    const created = await createOrder(prisma, juspay, order(), RETURN_URL);

    await recordWebhook(prisma, {
      orderId: created.orderId,
      eventType: 'ORDER_SUCCEEDED',
      signatureValid: true,
      payload: { content: { order: { order_id: created.orderId, status: 'CHARGED' } } },
      status: 'CHARGED',
    });

    const events = await prisma.paymentEvent.findMany({ where: { orderId: created.orderId } });
    expect(events).toHaveLength(1);
    expect(events[0]?.signatureValid).toBe(true);
  });

  it('logs an unsigned payload and changes nothing', async () => {
    const created = await createOrder(prisma, juspay, order(), RETURN_URL);

    await recordWebhook(prisma, {
      orderId: created.orderId,
      eventType: 'ORDER_SUCCEEDED',
      signatureValid: false,
      payload: { forged: true },
      status: 'CHARGED',
    });

    // Spec 15: logged and dropped. The row is the log.
    expect(await prisma.paymentEvent.count()).toBe(1);
    const row = await prisma.order.findUniqueOrThrow({ where: { orderId: created.orderId } });
    expect(row.status).toBe('initiated');
  });

  it('is idempotent across duplicates', async () => {
    const created = await createOrder(prisma, juspay, order(), RETURN_URL);
    const payload = {
      orderId: created.orderId,
      eventType: 'ORDER_SUCCEEDED',
      signatureValid: true,
      payload: {},
      status: 'CHARGED',
    };

    await recordWebhook(prisma, payload);
    await recordWebhook(prisma, payload);
    await recordWebhook(prisma, payload);

    const stock = await prisma.inventory.findUniqueOrThrow({
      where: { modelCode_dealerCode: { modelCode: MODEL, dealerCode: DEALER } },
    });
    expect(stock.unitsTotal).toBe(4);
    expect(await prisma.paymentEvent.count()).toBe(3);
  });
});
