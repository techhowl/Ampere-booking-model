import { describe, expect, it } from 'vitest';
import { crmSettings } from './config';

const ZOHO = {
  CRM_PROVIDER: 'zoho',
  ZOHO_API_URL: 'https://sandbox.zohoapis.in',
  ZOHO_CLIENT_ID: '1000.ID',
  ZOHO_CLIENT_SECRET: 'secret',
  ZOHO_REFRESH_TOKEN: '1000.refresh',
};

describe('crmSettings', () => {
  it('is the fake unless told otherwise', () => {
    expect(crmSettings({})).toEqual({ provider: 'fake' });
    expect(crmSettings({ CRM_PROVIDER: '  ' })).toEqual({ provider: 'fake' });
  });

  it('refuses a provider it does not know', () => {
    expect(() => crmSettings({ CRM_PROVIDER: 'zoho-live' })).toThrow(/fake.*zoho/);
  });

  it('names the variable that is missing', () => {
    for (const name of ['ZOHO_API_URL', 'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) {
      expect(() => crmSettings({ ...ZOHO, APP_ENV: 'uat', [name]: '' })).toThrow(name);
    }
  });

  it('fills the defaults Greaves gave us', () => {
    const settings = crmSettings({ ...ZOHO, APP_ENV: 'development' });
    expect(settings).toMatchObject({
      provider: 'zoho',
      sandbox: true,
      zoho: {
        accountsUrl: 'https://accounts.zoho.in',
        apiUrl: 'https://sandbox.zohoapis.in',
        leadFunction: 'leadcreation_for_ampere_website',
        testRideFunction: 'test_ride_creation_for_ampere_website',
        dealersFunction: 'get_dealers',
        timeoutMs: 30_000,
      },
    });
  });

  it('refuses production pointed at the sandbox — real leads would be lost', () => {
    expect(() => crmSettings({ ...ZOHO, APP_ENV: 'production' })).toThrow(/sandbox/);
    // Unset APP_ENV means production, so it fails closed.
    expect(() => crmSettings({ ...ZOHO })).toThrow(/sandbox/);
  });

  it('refuses UAT or development pointed at the live CRM — dealers would ring testers', () => {
    for (const appEnv of ['uat', 'development']) {
      expect(() => crmSettings({ ...ZOHO, APP_ENV: appEnv, ZOHO_API_URL: 'https://www.zohoapis.in' })).toThrow(
        /live CRM/,
      );
    }
  });

  it('allows production on the live CRM', () => {
    expect(crmSettings({ ...ZOHO, APP_ENV: 'production', ZOHO_API_URL: 'https://www.zohoapis.in/' })).toMatchObject({
      provider: 'zoho',
      sandbox: false,
      zoho: { apiUrl: 'https://www.zohoapis.in' },
    });
  });

  it('insists on https', () => {
    expect(() => crmSettings({ ...ZOHO, APP_ENV: 'uat', ZOHO_API_URL: 'http://sandbox.zohoapis.in' })).toThrow(/https/);
    expect(() => crmSettings({ ...ZOHO, APP_ENV: 'uat', ZOHO_ACCOUNTS_URL: 'not a url' })).toThrow(/URL/);
  });

  it('ignores a nonsense timeout', () => {
    expect(crmSettings({ ...ZOHO, APP_ENV: 'uat', ZOHO_TIMEOUT_MS: 'soon' })).toMatchObject({ zoho: { timeoutMs: 30_000 } });
    expect(crmSettings({ ...ZOHO, APP_ENV: 'uat', ZOHO_TIMEOUT_MS: '45000' })).toMatchObject({ zoho: { timeoutMs: 45_000 } });
  });
});
