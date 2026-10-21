import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';

beforeAll(() => {
  process.env.SESSION_SECRET = randomBytes(32).toString('base64');
});

const { requireJourney, writeSession, clearSession } = await import('./session');
const { serialiseSession, parseSession, SESSION_COOKIE } = await import('@/lib/crypto/session');
const { NextResponse } = await import('next/server');

const LEAD_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const now = () => Math.floor(Date.now() / 1000);

function request(cookie?: string) {
  return new NextRequest('https://buy.ampere-electric.com/api/orders', {
    method: 'POST',
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

async function refusal(cookie?: string) {
  const gate = requireJourney(request(cookie));
  if (gate.ok) return null;
  return { status: gate.response.status, body: (await gate.response.json()) as { error: string } };
}

/**
 * The gate on every route that commits the customer to something: choosing a
 * dealer, booking a ride, starting a payment.
 */
describe('requireJourney', () => {
  it('lets a live, verified session through', () => {
    const gate = requireJourney(request(serialiseSession({ leadId: LEAD_ID, verified: true })));
    expect(gate.ok).toBe(true);
  });

  it('refuses no session at all', async () => {
    expect(await refusal()).toEqual({ status: 409, body: expect.objectContaining({ error: 'no_lead' }) });
  });

  it('refuses a session idle for more than an hour, verified or not', async () => {
    const stale = serialiseSession({ leadId: LEAD_ID, verified: true, seenAt: now() - 61 * 60 });
    expect(await refusal(stale)).toEqual({
      status: 401,
      body: expect.objectContaining({ error: 'session_expired' }),
    });
  });

  it('refuses a live session whose number this browser has not verified', async () => {
    const unverified = serialiseSession({ leadId: LEAD_ID, verified: false });
    expect(await refusal(unverified)).toEqual({
      status: 403,
      body: expect.objectContaining({ error: 'not_verified' }),
    });
  });

  it('treats a forged cookie as no session', async () => {
    const forged = `${LEAD_ID}.1.${now()}.not-a-signature`;
    expect((await refusal(forged))?.status).toBe(409);
  });
});

describe('writing the cookie', () => {
  it('stamps it now, HttpOnly and SameSite=Lax, scoped to the whole site for 7 days', () => {
    const response = writeSession(NextResponse.json({}), { leadId: LEAD_ID, verified: true });
    const cookie = response.cookies.get(SESSION_COOKIE);

    expect(parseSession(cookie?.value)?.seenAt).toBeGreaterThanOrEqual(now() - 1);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 604800 });
  });

  it('clears it on "Not you?"', () => {
    const response = clearSession(NextResponse.json({}));
    expect(response.cookies.get(SESSION_COOKIE)).toMatchObject({ value: '', maxAge: 0 });
  });
});
