import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

/**
 * Keys must exist before the module under test reads them. env.ts is lazy, so
 * setting them here is enough.
 */
beforeAll(() => {
  process.env.PHONE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PHONE_HMAC_SECRET = randomBytes(32).toString('base64');
});

const {
  normalisePhone,
  encryptPhone,
  decryptPhone,
  hashPhone,
  phoneHashMatches,
  phoneColumns,
  maskPhone,
} = await import('./phone');

describe('normalisePhone', () => {
  it('accepts the shapes people actually type', () => {
    const expected = '+919876543210';
    for (const input of [
      '9876543210',
      '98765 43210',
      '98765-43210',
      '+919876543210',
      '+91 98765 43210',
      '919876543210',
      '09876543210',
      ' 9876543210 ',
    ]) {
      expect(normalisePhone(input), input).toBe(expected);
    }
  });

  it('rejects what is not an Indian mobile number', () => {
    for (const input of [
      '1234567890', // does not start 6-9
      '5876543210',
      '987654321', // too short
      '98765432101', // too long
      '',
      'not a phone',
      '+1 415 555 0123', // not India
    ]) {
      expect(normalisePhone(input), input).toBeNull();
    }
  });

  it('is idempotent — normalising twice changes nothing', () => {
    const once = normalisePhone('98765 43210');
    expect(once).not.toBeNull();
    expect(normalisePhone(once as string)).toBe(once);
  });
});

describe('encryption', () => {
  it('round-trips', () => {
    const e164 = '+919876543210';
    expect(decryptPhone(encryptPhone(e164))).toBe(e164);
  });

  it('produces different ciphertext every time', () => {
    // A deterministic ciphertext would leak that two leads share a number,
    // which is exactly what the separate HMAC index is for.
    const a = encryptPhone('+919876543210');
    const b = encryptPhone('+919876543210');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('refuses tampered ciphertext rather than returning garbage', () => {
    const encrypted = encryptPhone('+919876543210');
    const last = encrypted.length - 1;
    encrypted.set([(encrypted.at(last) ?? 0) ^ 0xff], last);
    expect(() => decryptPhone(encrypted)).toThrow();
  });

  it('refuses a truncated buffer', () => {
    expect(() => decryptPhone(Buffer.alloc(8))).toThrow(/too short/i);
  });
});

describe('hashPhone', () => {
  it('is deterministic and 64 hex characters, so it fits char(64)', () => {
    const hash = hashPhone('+919876543210');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPhone('+919876543210')).toBe(hash);
  });

  it('differs between numbers', () => {
    expect(hashPhone('+919876543210')).not.toBe(hashPhone('+919876543211'));
  });

  it('is not the raw number in any form', () => {
    expect(hashPhone('+919876543210')).not.toContain('9876543210');
  });
});

describe('phoneHashMatches', () => {
  it('matches the same number and rejects another', () => {
    const stored = hashPhone('+919876543210');
    expect(phoneHashMatches('+919876543210', stored)).toBe(true);
    expect(phoneHashMatches('+919876543211', stored)).toBe(false);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(phoneHashMatches('+919876543210', 'nonsense')).toBe(false);
  });
});

describe('phoneColumns', () => {
  it('produces exactly what the leads table needs', () => {
    const columns = phoneColumns('+919876543210');

    expect(columns.phoneLast4).toBe('3210');
    expect(columns.phoneLast4).toHaveLength(4);
    expect(columns.phoneHash).toHaveLength(64);
    expect(decryptPhone(columns.phoneEnc)).toBe('+919876543210');
  });
});

describe('maskPhone', () => {
  it('hides enough to be safe in a log line', () => {
    const masked = maskPhone('+919876543210');
    expect(masked).toBe('+91 ••••• 43210');
    expect(masked).not.toContain('98765');
  });
});
