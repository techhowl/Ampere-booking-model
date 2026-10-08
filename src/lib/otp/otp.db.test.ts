import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.OTP_HASH_SECRET = randomBytes(32).toString('base64');
});

const prisma = new PrismaClient({
  datasources: { db: { url: inject('databaseUrl') } },
});

const { requestOtp, verifyOtp, MAX_VERIFY_ATTEMPTS, REQUEST_LIMITS, RESEND_COOLDOWN_SECONDS } =
  await import('./otp');
const { FakeSmsClient } = await import('@/lib/sms/sms');

const PHONE_HASH = 'a'.repeat(64);
const PHONE = '+919876543210';

let sms: InstanceType<typeof FakeSmsClient>;

const params = () => ({
  phoneHash: PHONE_HASH,
  phoneE164: PHONE,
  ip: '203.0.113.9',
  deviceId: 'lead-1',
});

/** The code the fake actually delivered — the only way to learn it. */
function deliveredCode(): string {
  const body = sms.lastTo(PHONE)?.body ?? '';
  return body.match(/\b(\d{6})\b/)?.[1] ?? '';
}

beforeEach(async () => {
  await prisma.otpAttempt.deleteMany({});
  await prisma.rateLimit.deleteMany({});
  sms = new FakeSmsClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('requesting a code', () => {
  it('sends one and stores the attempt', async () => {
    const result = await requestOtp(prisma, sms, params());

    expect(result.ok).toBe(true);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.to).toBe(PHONE);
    expect(deliveredCode()).toMatch(/^\d{6}$/);

    const attempt = await prisma.otpAttempt.findFirstOrThrow();
    expect(attempt.phoneHash).toBe(PHONE_HASH);
    expect(attempt.attempts).toBe(0);
    expect(attempt.verifiedAt).toBeNull();
  });

  it('never stores the code in a readable form', async () => {
    await requestOtp(prisma, sms, params());
    const code = deliveredCode();

    const attempt = await prisma.otpAttempt.findFirstOrThrow();
    expect(attempt.codeHash).not.toContain(code);
    expect(attempt.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a resend inside the cooldown', async () => {
    await requestOtp(prisma, sms, params());
    const second = await requestOtp(prisma, sms, params());

    expect(second.ok).toBe(false);
    if (!second.ok && second.reason === 'cooldown') {
      expect(second.retryAfterSeconds).toBeGreaterThan(0);
      expect(second.retryAfterSeconds).toBeLessThanOrEqual(RESEND_COOLDOWN_SECONDS);
    } else {
      throw new Error(`expected cooldown, got ${JSON.stringify(second)}`);
    }

    // Crucially, no second message went out — that is the SMS bill.
    expect(sms.sent).toHaveLength(1);
  });

  it('allows a resend once the cooldown has passed', async () => {
    await requestOtp(prisma, sms, params());

    await prisma.rateLimit.updateMany({
      where: { scope: 'otp_cooldown' },
      data: { windowStart: new Date(Date.now() - (RESEND_COOLDOWN_SECONDS + 5) * 1000) },
    });

    expect((await requestOtp(prisma, sms, params())).ok).toBe(true);
    expect(sms.sent).toHaveLength(2);
  });

  it('does not start the cooldown when delivery fails', async () => {
    sms.failOnce();
    const failed = await requestOtp(prisma, sms, params());

    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.reason).toBe('delivery_failed');

    // A customer whose message never sent must be able to try again at once.
    const retry = await requestOtp(prisma, sms, params());
    expect(retry.ok).toBe(true);
  });
});

/**
 * Spec 15: uncontrolled OTP endpoints in India get abused for SMS-pumping
 * within days, and the bill lands on Ampere.
 */
describe('rate limits', () => {
  async function clearCooldown() {
    await prisma.rateLimit.deleteMany({ where: { scope: 'otp_cooldown' } });
  }

  it('stops a phone after its hourly allowance', async () => {
    for (let i = 0; i < REQUEST_LIMITS.phone.max; i++) {
      await clearCooldown();
      expect((await requestOtp(prisma, sms, params())).ok, `request ${i + 1}`).toBe(true);
    }

    await clearCooldown();
    const blocked = await requestOtp(prisma, sms, params());

    expect(blocked.ok).toBe(false);
    if (!blocked.ok && blocked.reason === 'rate_limited') {
      expect(blocked.blockedBy).toBe('phone');
    } else {
      throw new Error(`expected rate_limited, got ${JSON.stringify(blocked)}`);
    }
    expect(sms.sent).toHaveLength(REQUEST_LIMITS.phone.max);
  });

  it('stops an IP cycling through many numbers', async () => {
    // The phone limit never bites here: every request uses a different number.
    for (let i = 0; i < REQUEST_LIMITS.ip.max; i++) {
      const result = await requestOtp(prisma, sms, {
        ...params(),
        phoneHash: String(i).padStart(64, 'b'),
        deviceId: `device-${i}`,
      });
      expect(result.ok, `request ${i + 1}`).toBe(true);
    }

    const blocked = await requestOtp(prisma, sms, {
      ...params(),
      phoneHash: 'c'.repeat(64),
      deviceId: 'device-last',
    });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok && blocked.reason === 'rate_limited') {
      expect(blocked.blockedBy).toBe('ip');
    } else {
      throw new Error(`expected rate_limited, got ${JSON.stringify(blocked)}`);
    }
  });

  it('stops a device cycling through numbers from many IPs', async () => {
    for (let i = 0; i < REQUEST_LIMITS.device.max; i++) {
      const result = await requestOtp(prisma, sms, {
        phoneHash: String(i).padStart(64, 'd'),
        phoneE164: PHONE,
        ip: `198.51.100.${i}`,
        deviceId: 'one-device',
      });
      expect(result.ok, `request ${i + 1}`).toBe(true);
    }

    const blocked = await requestOtp(prisma, sms, {
      phoneHash: 'e'.repeat(64),
      phoneE164: PHONE,
      ip: '198.51.100.250',
      deviceId: 'one-device',
    });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok && blocked.reason === 'rate_limited') {
      expect(blocked.blockedBy).toBe('device');
    }
  });
});

describe('verifying a code', () => {
  async function issue() {
    const result = await requestOtp(prisma, sms, params());
    if (!result.ok) throw new Error('could not issue a code');
    return { otpRef: result.otpRef, code: deliveredCode() };
  }

  it('accepts the right code', async () => {
    const { otpRef, code } = await issue();

    const result = await verifyOtp(prisma, {
      otpRef,
      code,
      expectedPhoneHash: PHONE_HASH,
    });

    expect(result.ok).toBe(true);
    const attempt = await prisma.otpAttempt.findUniqueOrThrow({ where: { otpRef } });
    expect(attempt.verifiedAt).not.toBeNull();
  });

  it('rejects the wrong code and counts the attempt', async () => {
    const { otpRef, code } = await issue();
    const wrong = code === '000000' ? '111111' : '000000';

    const result = await verifyOtp(prisma, {
      otpRef,
      code: wrong,
      expectedPhoneHash: PHONE_HASH,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('incorrect');
      expect(result.attemptsRemaining).toBe(MAX_VERIFY_ATTEMPTS - 1);
    }
  });

  it('locks the code out after too many wrong guesses', async () => {
    const { otpRef, code } = await issue();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await verifyOtp(prisma, { otpRef, code: wrong, expectedPhoneHash: PHONE_HASH });
    }

    // Even the correct code no longer works — brute force must not be rewarded
    // by eventually landing on the right answer.
    const result = await verifyOtp(prisma, { otpRef, code, expectedPhoneHash: PHONE_HASH });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_many_attempts');
  });

  it('rejects an expired code', async () => {
    const { otpRef, code } = await issue();
    await prisma.otpAttempt.update({
      where: { otpRef },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await verifyOtp(prisma, { otpRef, code, expectedPhoneHash: PHONE_HASH });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('will not let one code be used twice', async () => {
    const { otpRef, code } = await issue();

    expect((await verifyOtp(prisma, { otpRef, code, expectedPhoneHash: PHONE_HASH })).ok).toBe(
      true,
    );

    const replay = await verifyOtp(prisma, { otpRef, code, expectedPhoneHash: PHONE_HASH });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe('already_used');
  });

  it('will not verify a lead with someone else\'s code', async () => {
    const { otpRef, code } = await issue();

    // Correct code, wrong owner. Reported as not found, so the response does
    // not confirm that the reference is real.
    const result = await verifyOtp(prisma, {
      otpRef,
      code,
      expectedPhoneHash: 'f'.repeat(64),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('rejects an unknown reference', async () => {
    const result = await verifyOtp(prisma, {
      otpRef: 'does-not-exist',
      code: '123456',
      expectedPhoneHash: PHONE_HASH,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('binds the code to its own reference', async () => {
    const first = await issue();
    await prisma.rateLimit.deleteMany({ where: { scope: 'otp_cooldown' } });
    const second = await issue();

    // The hash mixes in the otpRef, so a code is worthless against another ref
    // even in the astronomically unlikely case that both codes match.
    if (first.code === second.code) return;

    const result = await verifyOtp(prisma, {
      otpRef: second.otpRef,
      code: first.code,
      expectedPhoneHash: PHONE_HASH,
    });
    expect(result.ok).toBe(false);
  });
});
