import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCrmClient, setCrmClient } from './client';
import { FakeCrmClient } from './fake';
import { ZohoCrmClient } from './zoho';

/**
 * The fake may only "deliver" where nothing real is at stake. Anywhere else it
 * would mark real leads sent when they went nowhere, and they would never
 * reach the CRM once it was switched on.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  setCrmClient(undefined);
});

const sandbox = () => {
  vi.stubEnv('CRM_PROVIDER', 'zoho');
  vi.stubEnv('ZOHO_API_URL', 'https://sandbox.zohoapis.in');
  vi.stubEnv('ZOHO_CLIENT_ID', '1000.ID');
  vi.stubEnv('ZOHO_CLIENT_SECRET', 'secret');
  vi.stubEnv('ZOHO_REFRESH_TOKEN', '1000.refresh');
};

describe('getCrmClient', () => {
  it('uses the fake in local development', () => {
    vi.stubEnv('CRM_PROVIDER', '');
    vi.stubEnv('APP_ENV', 'development');
    expect(getCrmClient()).toBeInstanceOf(FakeCrmClient);
  });

  it('HOLDS jobs in UAT and production when the CRM is not switched on', () => {
    vi.stubEnv('CRM_PROVIDER', 'fake');
    for (const appEnv of ['uat', 'production', '']) {
      setCrmClient(undefined);
      vi.stubEnv('APP_ENV', appEnv);
      expect(getCrmClient()).toBeNull();
    }
  });

  it('talks to the sandbox when told to, outside production', () => {
    sandbox();
    vi.stubEnv('APP_ENV', 'uat');
    const client = getCrmClient();
    expect(client).toBeInstanceOf(ZohoCrmClient);
    expect(client?.name).toBe('zoho-sandbox');
  });

  it('refuses to build a client that breaks the sandbox rule', () => {
    sandbox();
    vi.stubEnv('APP_ENV', 'production');
    expect(() => getCrmClient()).toThrow(/sandbox/);
  });
});
