import { timingSafeEqual, createHash } from 'node:crypto';

/**
 * Admin authentication.
 *
 * Spec 14: "a small internal area behind a password, later behind SSO." This
 * is the password, checked against ADMIN_PASSWORD_HASH (a SHA-256 hex digest).
 *
 * Deliberately refuses when the hash is unset rather than defaulting to open.
 * An admin route that falls open when a variable is missing is how a lead list
 * with full phone numbers ends up on the public internet.
 *
 * SHA-256 is a fast hash, so the secret behind it must be a random token, not
 * a word someone chose (security audit V-06): `openssl rand -base64 32`. A
 * leaked hash of a 32-byte random token is not worth attacking; a leaked hash
 * of a password is.
 */

/**
 * The attempts one address gets per hour, right or wrong. The call centre
 * pulls an export a few times a day; guessing needs thousands.
 */
export const ADMIN_ATTEMPTS_PER_HOUR = 30;

/**
 * ADMIN_ALLOWED_IPS: comma-separated addresses that may call admin routes at
 * all. Unset means no restriction, which is how it behaved before.
 */
export function adminIpAllowed(ip: string | null): boolean {
  const allowed = (process.env.ADMIN_ALLOWED_IPS ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return ip !== null && allowed.includes(ip);
}

export function isAdminAuthorised(header: string | null): boolean {
  const expected = process.env.ADMIN_PASSWORD_HASH;
  if (!expected) return false;
  if (!header?.startsWith('Bearer ')) return false;

  const supplied = createHash('sha256').update(header.slice(7)).digest('hex');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected.trim().toLowerCase());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
