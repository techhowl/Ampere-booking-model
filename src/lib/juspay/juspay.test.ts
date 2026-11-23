import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FakeJuspayClient,
  UnconfiguredJuspayClient,
  fakeWebhookAuthorization,
  nextStatus,
  resolveOnReturn,
  type StoredOrder,
} from './juspay';
import { RealJuspayClient, normaliseStatus } from './real-client';

beforeAll(() => {
  // The fake's webhook credential is keyed by the session secret.
  process.env.SESSION_SECRET = randomBytes(32).toString('base64');
});

/**
 * These five cases are the ones that hurt in production. Each is cheap to
 * write now and miserable to debug later against live money.
 */

const order = (over: Partial<StoredOrder> = {}): StoredOrder => ({
  orderId: 'AMP-TEST-1',
  status: 'pending',
  ...over,
});

describe('1. webhook arrives before the customer returns', () => {
  it('uses the stored status and does not call the status API', async () => {
    const client = new FakeJuspayClient();
    const result = await resolveOnReturn(client, order({ status: 'paid', statusSource: 'webhook' }));

    expect(result.status).toBe('paid');
    expect(result.source).toBe('webhook');
    expect(client.statusCallCount('AMP-TEST-1')).toBe(0);
  });
});

describe('2. customer returns before the webhook lands', () => {
  it('falls back to the status API', async () => {
    const client = new FakeJuspayClient();
    client.script('AMP-TEST-1', 'success');

    const result = await resolveOnReturn(client, order());

    expect(result.status).toBe('paid');
    expect(result.source).toBe('status_api');
  });

  it('reports failure honestly rather than guessing', async () => {
    const client = new FakeJuspayClient();
    client.script('AMP-TEST-1', 'failure');

    const result = await resolveOnReturn(client, order());

    expect(result.status).toBe('failed');
  });
});

describe('3. the webhook never arrives and the status API is down', () => {
  it('returns unknown so the UI shows "confirming your payment"', async () => {
    const client = new FakeJuspayClient();
    client.script('AMP-TEST-1', 'timeout');

    const result = await resolveOnReturn(client, order());

    // Never "failed". The customer may have paid. Never "paid". They may not have.
    expect(result.status).toBe('unknown');
    expect(result.source).toBe('none');
  });
});

describe('4. duplicate webhook', () => {
  it('is idempotent — paid stays paid', () => {
    expect(nextStatus('paid', 'paid')).toBe('paid');
  });
});

describe('5. out-of-order webhook', () => {
  it('never downgrades a paid order to pending', () => {
    expect(nextStatus('paid', 'pending')).toBe('paid');
  });

  it('never downgrades a paid order to failed', () => {
    expect(nextStatus('paid', 'failed')).toBe('paid');
  });

  it('still promotes pending to paid', () => {
    expect(nextStatus('pending', 'paid')).toBe('paid');
  });

  it('ignores a late pending after a failure', () => {
    expect(nextStatus('failed', 'pending')).toBe('failed');
  });
});

describe('webhook authenticity', () => {
  const body = (orderId: string) => JSON.stringify({ content: { order: { order_id: orderId, status: 'CHARGED' } } });

  it('rejects an unauthenticated payload', () => {
    const client = new FakeJuspayClient();
    expect(client.verifyWebhook(body('AMP-TEST-1'), 'nonsense')).toBe(false);
    expect(client.verifyWebhook(body('AMP-TEST-1'), '')).toBe(false);
  });

  it('no longer accepts the old constant credential (audit V-01)', () => {
    const client = new FakeJuspayClient();
    expect(client.verifyWebhook(body('AMP-TEST-1'), 'valid-signature')).toBe(false);
  });

  it("accepts the stand-in checkout's credential for its own order", () => {
    const client = new FakeJuspayClient();
    const auth = fakeWebhookAuthorization('AMP-TEST-1');
    expect(client.verifyWebhook(body('AMP-TEST-1'), auth)).toBe(true);
    // Either envelope the route accepts.
    expect(client.verifyWebhook(JSON.stringify({ order_id: 'AMP-TEST-1', status: 'CHARGED' }), auth)).toBe(true);
  });

  it("refuses one order's credential on another order", () => {
    const client = new FakeJuspayClient();
    expect(client.verifyWebhook(body('AMP-TEST-2'), fakeWebhookAuthorization('AMP-TEST-1'))).toBe(false);
  });

  it('refuses a body it cannot read', () => {
    const client = new FakeJuspayClient();
    expect(client.verifyWebhook('not json', fakeWebhookAuthorization('AMP-TEST-1'))).toBe(false);
  });
});

describe('UnconfiguredJuspayClient (live deployment without Juspay)', () => {
  const client = new UnconfiguredJuspayClient();

  it('verifies no webhook, whatever it carries', () => {
    expect(client.verifyWebhook()).toBe(false);
  });

  it('starts no payment', async () => {
    await expect(client.createOrder()).rejects.toThrow(/not configured/);
  });

  it('resolves a return as unknown, never paid', async () => {
    const result = await resolveOnReturn(client, order());
    expect(result).toEqual({ status: 'unknown', source: 'none' });
  });
});

describe('normaliseStatus (webhook and status API share it)', () => {
  it('maps the statuses Juspay really sends', () => {
    expect(normaliseStatus('CHARGED')).toBe('CHARGED');
    expect(normaliseStatus('charged')).toBe('CHARGED');
    expect(normaliseStatus('AUTHENTICATION_FAILED')).toBe('AUTHORIZATION_FAILED');
    expect(normaliseStatus('AUTHORIZED')).toBe('PENDING');
    expect(normaliseStatus('SOMETHING_NEW')).toBe('NEW');
  });
});

describe('RealJuspayClient webhook auth', () => {
  const config = {
    apiKey: 'test-key',
    merchantId: 'ampere',
    paymentPageClientId: 'ampere',
    baseUrl: 'https://sandbox.juspay.in',
    webhookUrl: 'https://example.com/api/webhooks/juspay',
    webhookUsername: 'ampere_hook',
    webhookPassword: 'a-long-random-password',
  };

  const client = new RealJuspayClient(config, async () => {
    throw new Error('context not needed');
  });

  const valid = `Basic ${Buffer.from('ampere_hook:a-long-random-password').toString('base64')}`;

  it('accepts the configured basic credential', () => {
    expect(client.verifyWebhook('{}', valid)).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(client.verifyWebhook('{}', `  ${valid}  `)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const wrong = `Basic ${Buffer.from('ampere_hook:guess').toString('base64')}`;
    expect(client.verifyWebhook('{}', wrong)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(client.verifyWebhook('{}', '')).toBe(false);
  });

  it('rejects the credential unencoded', () => {
    expect(client.verifyWebhook('{}', 'Basic ampere_hook:a-long-random-password')).toBe(false);
  });

  it('refuses to authenticate when no password is configured', () => {
    const unconfigured = new RealJuspayClient(
      { ...config, webhookUsername: '', webhookPassword: '' },
      async () => {
        throw new Error('context not needed');
      },
    );
    // An empty config must never accept an empty header as a match.
    expect(unconfigured.verifyWebhook('{}', `Basic ${Buffer.from(':').toString('base64')}`)).toBe(
      false,
    );
  });
});

describe('FakeJuspayClient cancel', () => {
  it('records the cancellation so an expiry sweep can be asserted', async () => {
    const client = new FakeJuspayClient();
    await client.cancelOrder('AMP-TEST-1', 'Reservation expired');
    expect(client.cancelled.get('AMP-TEST-1')).toBe('Reservation expired');
  });
});
