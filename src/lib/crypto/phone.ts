import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { normalisePhone } from '@/lib/phone-format';

// Re-exported so server code has one import for everything phone-related.
// The definitions live in phone-format.ts because they must also run in the
// browser, and this module imports node:crypto.
export { normalisePhone, maskPhone, isValidPhone } from '@/lib/phone-format';

/**
 * Phone numbers, handled the way DPDP expects.
 *
 *   phoneEnc   AES-256-GCM ciphertext. Reversible, for when we need to call.
 *   phoneHash  HMAC-SHA256. Deterministic, indexed, for lookup and dedupe.
 *   phoneLast4 Plaintext, for "we'll call you on ••••3210" in the UI.
 *
 * Two separate keys on purpose. A plaintext indexed phone column is the first
 * thing a DPDP audit finds; a single key shared between the ciphertext and the
 * index means one compromise gives you both.
 *
 * Nothing in this file may ever be logged. The whole point of storing an
 * encrypted number is defeated by one console.log of the input.
 */

const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16;

/**
 * Layout: [12-byte IV][16-byte auth tag][ciphertext]
 *
 * Returns Uint8Array rather than Buffer because that is what Prisma's Bytes
 * column expects; Node's Buffer carries a wider ArrayBufferLike parameter that
 * does not satisfy it.
 */
export function encryptPhone(e164: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', env.phoneEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(e164, 'utf8'), cipher.final()]);
  return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
}

export function decryptPhone(stored: Uint8Array): string {
  if (stored.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Ciphertext too short to be a valid encrypted phone number');
  }
  const iv = stored.subarray(0, IV_BYTES);
  const tag = stored.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = stored.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', env.phoneEncryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Deterministic 64-character hex. The same number always produces the same
 * hash, which is what makes it indexable — and why it needs a secret, so the
 * index cannot be brute-forced against the ten-digit keyspace.
 */
export function hashPhone(e164: string): string {
  return createHmac('sha256', env.phoneHmacSecret).update(e164).digest('hex');
}

export function phoneLast4(e164: string): string {
  return e164.slice(-4);
}

/** For comparing a supplied number against a stored hash without leaking timing. */
export function phoneHashMatches(e164: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashPhone(e164), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/** Everything we persist about one number, derived in one place. */
export interface PhoneColumns {
  phoneEnc: Uint8Array<ArrayBuffer>;
  phoneHash: string;
  phoneLast4: string;
}

export function phoneColumns(e164: string): PhoneColumns {
  // Guard rather than trust: an unnormalised number here would produce a hash
  // that never matches, silently splitting one customer into two leads.
  if (normalisePhone(e164) !== e164) {
    throw new Error('phoneColumns requires an E.164 number from normalisePhone()');
  }
  return {
    phoneEnc: encryptPhone(e164),
    phoneHash: hashPhone(e164),
    phoneLast4: phoneLast4(e164),
  };
}
