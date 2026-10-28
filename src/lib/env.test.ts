import { afterEach, describe, expect, it } from 'vitest';
import { env } from './env';

/**
 * Launch is test rides only. Buy Now must stay off unless someone switches it
 * on deliberately — a missing or mistyped variable is off, not on.
 */
describe('BUY_NOW_ENABLED', () => {
  const saved = process.env.BUY_NOW_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.BUY_NOW_ENABLED;
    else process.env.BUY_NOW_ENABLED = saved;
  });

  it('is off when unset', () => {
    delete process.env.BUY_NOW_ENABLED;
    expect(env.buyNowEnabled).toBe(false);
  });

  it('is off for anything but "true"', () => {
    for (const value of ['false', '1', 'yes', 'TRUE', '"true"', '']) {
      process.env.BUY_NOW_ENABLED = value;
      expect(env.buyNowEnabled, value).toBe(false);
    }
  });

  it('is on only for "true"', () => {
    process.env.BUY_NOW_ENABLED = 'true';
    expect(env.buyNowEnabled).toBe(true);
  });
});
