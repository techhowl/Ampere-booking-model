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
 */

export const SESSION_COOKIE = 'amp_lead';

/** Long enough that a customer interrupted by a phone call still comes back to it. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface LeadSession {
  leadId: string;
  verified: boolean;
}

function sign(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
}

/** Format: <leadId>.<0|1>.<signature> */
export function serialiseSession(session: LeadSession): string {
  const payload = `${session.leadId}.${session.verified ? '1' : '0'}`;
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

  const [leadId, verifiedFlag] = payload.split('.');
  if (!leadId || (verifiedFlag !== '0' && verifiedFlag !== '1')) return null;

  return { leadId, verified: verifiedFlag === '1' };
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProduction,
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;
