import { env } from '@/lib/env';

/**
 * Cloudflare Turnstile, on the OTP endpoint.
 *
 * Spec 15 is blunt about why: uncontrolled OTP endpoints in India get abused
 * for SMS-pumping fraud within days of launch, and the bill lands on Ampere.
 *
 * Keys have not arrived yet, so this is wired behind the secret's presence:
 * enforced wherever TURNSTILE_SECRET is set, skipped where it is not. That
 * keeps local development frictionless without leaving production with no
 * check at all — and it fails closed, refusing rather than passing, if the
 * secret is set but Cloudflare cannot be reached.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;

export type TurnstileOutcome =
  | { ok: true; skipped: boolean }
  | { ok: false; reason: 'missing_token' | 'rejected' | 'unreachable' };

export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string | null,
): Promise<TurnstileOutcome> {
  const secret = env.turnstileSecret;

  // No secret configured: the check is not available yet. Announce it once so
  // it cannot quietly stay off after the keys arrive.
  if (!secret) {
    if (env.isProduction) {
      console.warn('[turnstile] TURNSTILE_SECRET is not set — bot defence is OFF');
    }
    return { ok: true, skipped: true };
  }

  if (!token) return { ok: false, reason: 'missing_token' };

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true ? { ok: true, skipped: false } : { ok: false, reason: 'rejected' };
  } catch {
    // Fail closed. An unreachable verifier is not permission to send SMS.
    return { ok: false, reason: 'unreachable' };
  }
}
