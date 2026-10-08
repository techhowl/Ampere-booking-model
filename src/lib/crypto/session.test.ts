import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.SESSION_SECRET = randomBytes(32).toString('base64');
});

const { serialiseSession, parseSession } = await import('./session');

const LEAD_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('the continuity cookie', () => {
  it('round-trips a session', () => {
    const cookie = serialiseSession({ leadId: LEAD_ID, verified: false });
    expect(parseSession(cookie)).toEqual({ leadId: LEAD_ID, verified: false });
  });

  it('round-trips a verified session', () => {
    const cookie = serialiseSession({ leadId: LEAD_ID, verified: true });
    expect(parseSession(cookie)).toEqual({ leadId: LEAD_ID, verified: true });
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
    const [id, , signature] = cookie.split('.');
    expect(parseSession(`${id}.1.${signature}`)).toBeNull();
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
