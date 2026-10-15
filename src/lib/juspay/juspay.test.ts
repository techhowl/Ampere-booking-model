import { describe, expect, it } from 'vitest';
import {
  FakeJuspayClient,
  nextStatus,
  resolveOnReturn,
  type StoredOrder,
} from './juspay';
import { RealJuspayClient } from './real-client';

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
  it('rejects an unauthenticated payload', () => {
    const client = new FakeJuspayClient();
    expect(client.verifyWebhook('{}', 'nonsense')).toBe(false);
    expect(client.verifyWebhook('{}', 'valid-signature')).toBe(true);
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
