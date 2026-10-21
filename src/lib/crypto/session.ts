import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * The continuity cookie.
 *
 * It carries which lead this browser belongs to, and whether that lead's phone
 * has been verified. Spec 5: "Returning from the same device resumes where
 * they left off rather than restarting", and every step after the first patches
 * the SAME record — never a second one.
 *
 * Signed, not encrypted: a lead id is not a secret, but it must not be
 * forgeable, or anyone could patch anyone else's lead by editing a cookie.
 *
 * Scoped to this subdomain only, HttpOnly, Secure, SameSite=Lax. Deliberately
 * NOT set on the parent domain — that is for attribution cookies, which are a
 * different thing with different rules.
 *
 * Two lifetimes, on purpose:
 *
 *   the cookie       7 days. Ties this browser to its lead, so a customer who
 *                    comes back next week patches the same row rather than
 *                    making a second, and can still read their order status.
 *   the journey      SESSION_IDLE_MINUTES (60) since the last action. Within
 *                    it, a refresh resumes where they were and a verified
 *                    number can book and pay. After it, they verify again.
 *                    Enforced on the server — see lib/http/session.ts.
 */

export const SESSION_COOKIE = 'amp_lead';

/** Long enough that a customer interrupted by a phone call still comes back to it. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface LeadSession {
  leadId: string;
  verified: boolean;
  /** Last activity, in epoch seconds. 0 for a cookie from before this was recorded. */
  seenAt: number;
}

function sign(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
}

/**
 * Format: <leadId>.<0|1>.<seenAt>.<signature>. seenAt defaults to now, which
 * is what every writer wants: writing the cookie IS the activity.
 */
export function serialiseSession(
  session: Omit<LeadSession, 'seenAt'> & { seenAt?: number },
): string {
  const seenAt = session.seenAt ?? Math.floor(Date.now() / 1000);
  const payload = `${session.leadId}.${session.verified ? '1' : '0'}.${seenAt}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Returns null for anything that does not verify. A tampered cookie is treated
 * as no cookie: the customer starts a fresh lead rather than seeing an error.
 */
export function parseSession(raw: string | undefined | null): LeadSession | null {
  if (!raw) return null;

  const lastDot = raw.lastIndexOf('.');
  if (lastDot < 1) return null;

  const payload = raw.slice(0, lastDot);
  const signature = raw.slice(lastDot + 1);

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  // Three parts now; two in a cookie written before the activity time was
  // recorded. That one still identifies its lead, but its journey is over.
  const [leadId, verifiedFlag, seen, ...rest] = payload.split('.');
  if (!leadId || (verifiedFlag !== '0' && verifiedFlag !== '1') || rest.length > 0) return null;
  const seenAt = seen === undefined ? 0 : Number(seen);
  if (!Number.isSafeInteger(seenAt) || seenAt < 0) return null;

  return { leadId, verified: verifiedFlag === '1', seenAt };
}

/** Whether the journey is still live: some activity within the idle limit. */
export function isActive(session: LeadSession, now: number = Date.now()): boolean {
  return now / 1000 - session.seenAt <= env.sessionIdleSeconds;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProduction,
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;
