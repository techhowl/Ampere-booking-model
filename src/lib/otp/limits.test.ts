import { afterEach, describe, expect, it } from 'vitest';
import { REQUEST_LIMITS, UAT_REQUEST_LIMITS, requestLimits } from './otp';

/**
 * The looser limits exist for UAT, where the code is shown on screen and no
 * SMS is sent. They must never reach production, where the limits are what
 * stands between an open OTP endpoint and an SMS-pumping bill.
 */
describe('OTP request limits', () => {
  const saved = { APP_ENV: process.env.APP_ENV, OTP_ECHO_ENABLED: process.env.OTP_ECHO_ENABLED };
  afterEach(() => {
    process.env.APP_ENV = saved.APP_ENV;
    process.env.OTP_ECHO_ENABLED = saved.OTP_ECHO_ENABLED;
  });

  it('are the strict ones by default', () => {
    delete process.env.APP_ENV;
    delete process.env.OTP_ECHO_ENABLED;
    expect(requestLimits()).toBe(REQUEST_LIMITS);
  });

  it('loosen only in UAT test mode', () => {
    process.env.APP_ENV = 'uat';
    process.env.OTP_ECHO_ENABLED = 'true';
    expect(requestLimits()).toBe(UAT_REQUEST_LIMITS);
  });

  it('stay strict in production even if test mode is asked for', () => {
    process.env.APP_ENV = 'production';
    process.env.OTP_ECHO_ENABLED = 'true';
    expect(requestLimits()).toBe(REQUEST_LIMITS);
  });

  it('stay strict in UAT without test mode', () => {
    process.env.APP_ENV = 'uat';
    delete process.env.OTP_ECHO_ENABLED;
    expect(requestLimits()).toBe(REQUEST_LIMITS);
  });
});
