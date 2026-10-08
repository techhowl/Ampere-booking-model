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
 */

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
