import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.SESSION_SECRET = randomBytes(32).toString('base64');
});

const { serialiseSession, parseSession, isActive } = await import('./session');
const { createHmac } = await import('node:crypto');

const LEAD_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('the continuity cookie', () => {
  it('round-trips a session', () => {
    const cookie = serialiseSession({ leadId: LEAD_ID, verified: false, seenAt: 1_700_000_000 });
    expect(parseSession(cookie)).toEqual({
      leadId: LEAD_ID,
      verified: false,
      seenAt: 1_700_000_000,
    });
  });

  it('round-trips a verified session', () => {
    const cookie = serialiseSession({ leadId: LEAD_ID, verified: true, seenAt: 1_700_000_000 });
    expect(parseSession(cookie)?.verified).toBe(true);
  });

  it('stamps the time of writing when none is given', () => {
    const before = Math.floor(Date.now() / 1000);
    const session = parseSession(serialiseSession({ leadId: LEAD_ID, verified: true }));
    expect(session?.seenAt).toBeGreaterThanOrEqual(before);
  });

  it('refuses a cookie whose activity time was pushed forward', () => {
    // Otherwise a stale verified session could be revived by editing a number.
    const cookie = serialiseSession({ leadId: LEAD_ID, verified: true, seenAt: 1_700_000_000 });
    expect(parseSession(cookie.replace('.1700000000.', '.1999999999.'))).toBeNull();
  });

  it('still reads a cookie written before activity was recorded, as long expired', () => {
    const payload = `${LEAD_ID}.1`;
    const signature = createHmac('sha256', Buffer.from(process.env.SESSION_SECRET!, 'base64'))
      .update(payload)
      .digest('base64url');
    const session = parseSession(`${payload}.${signature}`);

    expect(session).toEqual({ leadId: LEAD_ID, verified: true, seenAt: 0 });
    expect(isActive(session!)).toBe(false);
  });

  it('refuses a cookie whose lead id was swapped', () => {
    const cookie = serialiseSession({ leadId: LEAD_ID, verified: false });
    const attacker = cookie.replace(LEAD_ID, '11111111-2222-3333-4444-555555555555');
    expect(parseSession(attacker)).toBeNull();
  });

  it('refuses a cookie promoted to verified', () => {
    // The whole reason this is signed. Flipping this bit would otherwise walk
    // straight past OTP.
    const cookie = serialiseSession({ leadId: LEAD_ID, verified: false });
    const [id, , seenAt, signature] = cookie.split('.');
    expect(parseSession(`${id}.1.${seenAt}.${signature}`)).toBeNull();
  });

  it('refuses a cookie with no signature at all', () => {
    expect(parseSession(`${LEAD_ID}.1`)).toBeNull();
    expect(parseSession(LEAD_ID)).toBeNull();
  });

  it('treats absent and malformed cookies as simply not present', () => {
    for (const input of [undefined, null, '', '...', 'garbage']) {
      expect(parseSession(input), String(input)).toBeNull();
    }
  });
});

describe('the journey timeout', () => {
  const at = (seenAt: number) => ({ leadId: LEAD_ID, verified: true, seenAt });
  const NOW = 1_700_000_000_000; // ms

  it('is live up to an hour after the last activity, and over after it', () => {
    expect(isActive(at(NOW / 1000 - 59 * 60), NOW)).toBe(true);
    expect(isActive(at(NOW / 1000 - 60 * 60), NOW)).toBe(true);
    expect(isActive(at(NOW / 1000 - 60 * 60 - 1), NOW)).toBe(false);
  });

  it('takes its length from SESSION_IDLE_MINUTES', () => {
    process.env.SESSION_IDLE_MINUTES = '15';
    try {
      expect(isActive(at(NOW / 1000 - 16 * 60), NOW)).toBe(false);
      expect(isActive(at(NOW / 1000 - 14 * 60), NOW)).toBe(true);
    } finally {
      delete process.env.SESSION_IDLE_MINUTES;
    }
  });
});
