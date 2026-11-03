/**
 * Which CRM the app talks to, read from the environment.
 *
 * Pure — no imports beyond types — so the startup check in instrumentation.ts
 * can run the very same rules before the first request.
 *
 *   CRM_PROVIDER=fake   the default: FakeCrmClient, in memory
 *   CRM_PROVIDER=zoho   Greaves CRM.Next, with the ZOHO_* variables below
 *
 * The one rule worth refusing to start over: production talks only to the
 * live CRM, and everything else talks only to the sandbox. A UAT pointed at
 * the live CRM would hand test bookings to real dealers, who would ring the
 * testers; production pointed at the sandbox would quietly lose every lead.
 */

export interface ZohoConfig {
  /** https://accounts.zoho.in — Zoho's India data centre. */
  accountsUrl: string;
  /** https://sandbox.zohoapis.in, or the production host after go-live. */
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  leadFunction: string;
  testRideFunction: string;
  /** Greaves' dealer master: every active dealer, for `pnpm crm sync-dealers`. */
  dealersFunction: string;
  /** Per request. The sandbox has taken 16 seconds to answer. */
  timeoutMs: number;
}

export type CrmSettings =
  | { provider: 'fake' }
  | { provider: 'zoho'; sandbox: boolean; zoho: ZohoConfig };

type Source = Record<string, string | undefined>;

const DEFAULT_ACCOUNTS_URL = 'https://accounts.zoho.in';
const DEFAULT_LEAD_FUNCTION = 'leadcreation_for_ampere_website';
const DEFAULT_TEST_RIDE_FUNCTION = 'test_ride_creation_for_ampere_website';
const DEFAULT_DEALERS_FUNCTION = 'get_dealers';
const DEFAULT_TIMEOUT_MS = 30_000;

function required(source: Source, name: string): string {
  const value = source[name]?.trim();
  if (!value) {
    throw new Error(`CRM_PROVIDER is zoho but ${name} is not set. See docs/greaves-crm/README.md.`);
  }
  return value;
}

function httpsUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${name} must be https`);
  return value.replace(/\/+$/, '');
}

export function isSandboxHost(apiUrl: string): boolean {
  return new URL(apiUrl).hostname.toLowerCase().startsWith('sandbox.');
}

export function crmSettings(source: Source = process.env): CrmSettings {
  const provider = source.CRM_PROVIDER?.trim() || 'fake';
  if (provider === 'fake') return { provider: 'fake' };
  if (provider !== 'zoho') {
    throw new Error(`CRM_PROVIDER must be "fake" or "zoho", not "${provider}"`);
  }

  const apiUrl = httpsUrl('ZOHO_API_URL', required(source, 'ZOHO_API_URL'));
  const timeout = Number(source.ZOHO_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  const zoho: ZohoConfig = {
    accountsUrl: httpsUrl('ZOHO_ACCOUNTS_URL', source.ZOHO_ACCOUNTS_URL?.trim() || DEFAULT_ACCOUNTS_URL),
    apiUrl,
    clientId: required(source, 'ZOHO_CLIENT_ID'),
    clientSecret: required(source, 'ZOHO_CLIENT_SECRET'),
    refreshToken: required(source, 'ZOHO_REFRESH_TOKEN'),
    leadFunction: source.ZOHO_LEAD_FUNCTION?.trim() || DEFAULT_LEAD_FUNCTION,
    testRideFunction: source.ZOHO_TEST_RIDE_FUNCTION?.trim() || DEFAULT_TEST_RIDE_FUNCTION,
    dealersFunction: source.ZOHO_DEALERS_FUNCTION?.trim() || DEFAULT_DEALERS_FUNCTION,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? timeout : DEFAULT_TIMEOUT_MS,
  };

  // Same default as env.appEnv: unset means production, so it fails closed.
  const appEnv = source.APP_ENV === 'development' || source.APP_ENV === 'uat' ? source.APP_ENV : 'production';
  const sandbox = isSandboxHost(apiUrl);

  if (appEnv === 'production' && sandbox) {
    throw new Error(
      'APP_ENV is production but ZOHO_API_URL is the Zoho sandbox. Real leads would never reach the CRM.',
    );
  }
  if (appEnv !== 'production' && !sandbox) {
    throw new Error(
      `APP_ENV is ${appEnv} but ZOHO_API_URL is the live CRM. Test bookings would reach real dealers. ` +
        'Use https://sandbox.zohoapis.in outside production.',
    );
  }

  return { provider: 'zoho', sandbox, zoho };
}
