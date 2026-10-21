import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';
import { otpMessage, type SmsClient } from '@/lib/sms/sms';
import { consume, secondsUntilReset, type LimitRule } from '@/lib/rate-limit/rate-limit';

/**
 * OTP request and verification.
 *
 * Spec 4: "OTP gates progress, not capture." The lead is already saved by the
 * time anything here runs, and failing or abandoning verification deletes
 * nothing. All this decides is whether the customer may move past step one.
 *
 * The code is never stored in plaintext and never logged. The phone number is
 * decrypted only to hand it to the SMS provider.
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_SECONDS = 10 * 60;
export const MAX_VERIFY_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 60;

const SCOPE = 'otp_request';
const COOLDOWN_SCOPE = 'otp_cooldown';

/**
 * Per phone, per IP, per device. Sized to be invisible to a real customer —
 * who needs one code, maybe two — and expensive for anyone farming messages.
 */
export const REQUEST_LIMITS = {
  phone: { max: 5, windowSeconds: 3600 },
  ip: { max: 20, windowSeconds: 3600 },
  device: { max: 10, windowSeconds: 3600 },
} as const;

/**
 * UAT test mode only (env.otpEchoEnabled — never true in production). The
 * code is shown on screen and no SMS is sent, so there is no bill to protect,
 * and a team testing from one office IP would otherwise lock itself out after
 * twenty codes. The resend cooldown and the verify-attempt limit still apply.
 */
export const UAT_REQUEST_LIMITS = {
  phone: { max: 50, windowSeconds: 3600 },
  ip: { max: 500, windowSeconds: 3600 },
  device: { max: 100, windowSeconds: 3600 },
} as const;

export function requestLimits(): typeof REQUEST_LIMITS | typeof UAT_REQUEST_LIMITS {
  return env.otpEchoEnabled ? UAT_REQUEST_LIMITS : REQUEST_LIMITS;
}

export type OtpRequestFailure =
  | { reason: 'rate_limited'; retryAfterSeconds: number; blockedBy: string }
  | { reason: 'cooldown'; retryAfterSeconds: number }
  | { reason: 'delivery_failed' };

export type OtpRequestOutcome =
  | {
      ok: true;
      otpRef: string;
      expiresAt: Date;
      resendAfterSeconds: number;
      /** The live code. Set ONLY when env.otpEchoEnabled. Never in production. */
      echoCode?: string;
    }
  | ({ ok: false } & OtpRequestFailure);

export type OtpVerifyOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'not_found' | 'expired' | 'already_used' | 'too_many_attempts' | 'incorrect';
      attemptsRemaining: number;
    };

/* ------------------------------------------------------------------ */

/** Uniform over the full range. Math.random() is not acceptable here. */
function generateCode(): string {
  const max = 10 ** CODE_LENGTH;
  return String(randomInt(0, max)).padStart(CODE_LENGTH, '0');
}

/**
 * Keyed so a stolen database does not yield the codes. The otpRef is mixed in
 * so the same code issued to two people produces two different hashes.
 */
function hashCode(otpRef: string, code: string): string {
  return createHmac('sha256', env.otpHashSecret).update(`${otpRef}:${code}`).digest('hex');
}

function codeMatches(otpRef: string, code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashCode(otpRef, code), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/* ------------------------------------------------------------------ */

export interface RequestOtpParams {
  /** Hashed, never the raw number. Used for the per-phone limit and the lookup. */
  phoneHash: string;
  /** E.164, decrypted by the caller purely to address the message. */
  phoneE164: string;
  ip: string | null;
  /** The lead id from the continuity cookie, standing in for the device. */
  deviceId: string | null;
}

export async function requestOtp(
  prisma: PrismaClient,
  sms: SmsClient,
  params: RequestOtpParams,
): Promise<OtpRequestOutcome> {
  const { phoneHash, phoneE164, ip, deviceId } = params;

  // Cooldown first. Asking "may I resend yet" must not consume a quota, so this
  // is a read, and it is checked before anything is incremented.
  const cooldown = await secondsUntilReset(
    prisma,
    COOLDOWN_SCOPE,
    'phone',
    phoneHash,
    RESEND_COOLDOWN_SECONDS,
  );
  if (cooldown > 0) {
    return { ok: false, reason: 'cooldown', retryAfterSeconds: cooldown };
  }

  const limits = requestLimits();
  const rules: LimitRule[] = [{ kind: 'phone', subject: phoneHash, ...limits.phone }];
  if (ip) rules.push({ kind: 'ip', subject: ip, ...limits.ip });
  if (deviceId) rules.push({ kind: 'device', subject: deviceId, ...limits.device });

  const decision = await consume(prisma, SCOPE, rules);
  if (!decision.allowed) {
    return {
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: decision.retryAfterSeconds,
      blockedBy: decision.blockedBy ?? 'unknown',
    };
  }

  const otpRef = randomBytes(16).toString('hex');
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);

  await prisma.otpAttempt.create({
    data: {
      otpRef,
      phoneHash,
      codeHash: hashCode(otpRef, code),
      channel: 'sms',
      expiresAt,
      ip,
    },
  });

  try {
    await sms.send({ to: phoneE164, body: otpMessage(code) });
  } catch {
    // The attempt row stays. It expires on its own, and leaving it means a
    // retry is still subject to the same limits rather than starting fresh.
    return { ok: false, reason: 'delivery_failed' };
  }

  // Start the cooldown only once a message has actually gone out.
  await consume(prisma, COOLDOWN_SCOPE, [
    { kind: 'phone', subject: phoneHash, max: 1, windowSeconds: RESEND_COOLDOWN_SECONDS },
  ]);

  return {
    ok: true,
    otpRef,
    expiresAt,
    resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    /*
     * Only ever populated outside production, and only when asked for — see
     * env.otpEchoEnabled. Until an SMS provider exists, this is the only way a
     * tester who is not reading the server console can get past this step.
     *
     * Deliberately decided here rather than at the route, so there is exactly
     * one place in the codebase that can put a live code on the wire.
     */
    echoCode: env.otpEchoEnabled ? code : undefined,
  };
}

export interface VerifyOtpParams {
  otpRef: string;
  code: string;
  /**
   * The hash of the phone on the lead being verified. The attempt must belong
   * to the same number, or one customer's code could verify another's lead.
   */
  expectedPhoneHash: string;
}

export async function verifyOtp(
  prisma: PrismaClient,
  params: VerifyOtpParams,
): Promise<OtpVerifyOutcome> {
  const { otpRef, code, expectedPhoneHash } = params;

  const attempt = await prisma.otpAttempt.findUnique({ where: { otpRef } });

  // An attempt for a different number is reported as simply not found. Saying
  // "that code exists but is not yours" would confirm the reference is real.
  if (!attempt || attempt.phoneHash !== expectedPhoneHash) {
    return { ok: false, reason: 'not_found', attemptsRemaining: 0 };
  }
  if (attempt.verifiedAt) {
    return { ok: false, reason: 'already_used', attemptsRemaining: 0 };
  }
  if (attempt.expiresAt <= new Date()) {
    return { ok: false, reason: 'expired', attemptsRemaining: 0 };
  }
  if (attempt.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts', attemptsRemaining: 0 };
  }

  // Count the attempt before checking it. Crashing between the two must cost
  // the caller a try, not hand them a free one.
  const { attempts } = await prisma.otpAttempt.update({
    where: { otpRef },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  });

  if (!codeMatches(otpRef, code, attempt.codeHash)) {
    return {
      ok: false,
      reason: 'incorrect',
      attemptsRemaining: Math.max(0, MAX_VERIFY_ATTEMPTS - attempts),
    };
  }

  await prisma.otpAttempt.update({
    where: { otpRef },
    data: { verifiedAt: new Date() },
  });

  return { ok: true };
}

/** Background job. Expired attempts carry nothing worth keeping. */
export async function purgeExpired(prisma: PrismaClient): Promise<number> {
  const { count } = await prisma.otpAttempt.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } },
  });
  return count;
}
