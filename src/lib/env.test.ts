import { afterEach, describe, expect, it } from 'vitest';
import { env, parseGoalAppUrl, parsePilotDealerIds } from './env';

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

/**
 * The Zoho pilot's settings. A typo must stop the app at startup rather than
 * quietly offer every dealer, or hand customers to a broken address.
 */
describe('PILOT_DEALER_CRM_IDS', () => {
  it('means every dealer when unset or blank', () => {
    expect(parsePilotDealerIds(undefined)).toBeNull();
    expect(parsePilotDealerIds(' , ')).toBeNull();
  });

  it('reads ids separated by commas, spaces or new lines, once each', () => {
    expect(parsePilotDealerIds('1270103000002556463, 1270103000001386762\n1270103000002556463')).toEqual([
      '1270103000002556463',
      '1270103000001386762',
    ]);
  });

  it('refuses anything that is not a CRM id', () => {
    expect(() => parsePilotDealerIds('1270103000002556463,Rohan Automobiles')).toThrow(/Not: Rohan/);
  });
});

describe('GOAL_APP_URL', () => {
  it('is off when unset', () => {
    expect(parseGoalAppUrl(undefined)).toBeNull();
    expect(parseGoalAppUrl('  ')).toBeNull();
  });

  it('takes an https address', () => {
    expect(parseGoalAppUrl('https://enquiry.ampere-electric.com/testride')).toBe(
      'https://enquiry.ampere-electric.com/testride',
    );
  });

  it('refuses plain http and non-URLs', () => {
    expect(() => parseGoalAppUrl('http://enquiry.ampere-electric.com/testride')).toThrow(/https/);
    expect(() => parseGoalAppUrl('enquiry.ampere-electric.com')).toThrow(/not a URL/);
  });
});

describe('OTP_REQUIRED', () => {
  const saved = process.env.OTP_REQUIRED;
  afterEach(() => {
    if (saved === undefined) delete process.env.OTP_REQUIRED;
    else process.env.OTP_REQUIRED = saved;
  });

  it('is on unless set to exactly "false"', () => {
    delete process.env.OTP_REQUIRED;
    expect(env.otpRequired).toBe(true);
    process.env.OTP_REQUIRED = 'no';
    expect(env.otpRequired).toBe(true);
    process.env.OTP_REQUIRED = 'false';
    expect(env.otpRequired).toBe(false);
  });
});
