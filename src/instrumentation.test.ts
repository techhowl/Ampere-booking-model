import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

const KEYS = ['NODE_ENV', 'APP_ENV', 'BUY_NOW_ENABLED', 'JUSPAY_ENABLED', 'OTP_ECHO_ENABLED', 'OTP_REQUIRED', 'CRM_PROVIDER'];
const saved: Record<string, string | undefined> = {};
const env = process.env as Record<string, string | undefined>;

function set(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

beforeEach(() => {
  for (const key of KEYS) saved[key] = env[key];
  set({ BUY_NOW_ENABLED: undefined, JUSPAY_ENABLED: undefined, OTP_ECHO_ENABLED: undefined, OTP_REQUIRED: undefined, CRM_PROVIDER: undefined });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  set(saved);
  vi.restoreAllMocks();
});

describe('startup: Buy Now and the payment client (audit V-01)', () => {
  it('refuses Buy Now in production without the real Juspay client', async () => {
    set({ NODE_ENV: 'production', APP_ENV: 'production', BUY_NOW_ENABLED: 'true' });
    await expect(register()).rejects.toThrow(/needs the real Juspay client/);
  });

  it('treats an unset APP_ENV as production', async () => {
    set({ NODE_ENV: 'production', APP_ENV: undefined, BUY_NOW_ENABLED: 'true', JUSPAY_ENABLED: 'false' });
    await expect(register()).rejects.toThrow(/needs the real Juspay client/);
  });

  it('starts production with Buy Now when the real client is on', async () => {
    set({ NODE_ENV: 'production', APP_ENV: 'production', BUY_NOW_ENABLED: 'true', JUSPAY_ENABLED: 'true' });
    await expect(register()).resolves.toBeUndefined();
  });

  it('starts production as it runs today: Buy Now off, Juspay off', async () => {
    set({ NODE_ENV: 'production', APP_ENV: 'production' });
    await expect(register()).resolves.toBeUndefined();
  });

  it('starts UAT with Buy Now on the stand-in checkout', async () => {
    set({ NODE_ENV: 'production', APP_ENV: 'uat', BUY_NOW_ENABLED: 'true' });
    await expect(register()).resolves.toBeUndefined();
  });

  it('starts local development with Buy Now on the stand-in checkout', async () => {
    set({ NODE_ENV: 'development', APP_ENV: undefined, BUY_NOW_ENABLED: 'true' });
    await expect(register()).resolves.toBeUndefined();
  });
});
