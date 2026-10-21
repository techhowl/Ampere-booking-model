import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_EXPIRED_MESSAGE } from './session-messages';
import {
  SESSION_COOKIE,
  isActive,
  parseSession,
  serialiseSession,
  sessionCookieOptions,
  type LeadSession,
} from '@/lib/crypto/session';

/**
 * The session, as the routes use it.
 *
 * Every route that commits the customer to something — choosing a dealer,
 * booking a ride, starting a payment — goes through requireJourney(). It
 * wants a cookie, a journey still within the idle limit, and a number this
 * browser has verified. The lead's phone_verified in the database is checked
 * again further in; this is the browser half of the same question.
 *
 * Reading an order's status deliberately does NOT go through here. A customer
 * can spend longer than the idle limit on Juspay's EMI pages, and must still
 * see their confirmation when they come back. That route checks ownership
 * only.
 */

export { SESSION_EXPIRED_MESSAGE } from './session-messages';

export function readSession(request: NextRequest): LeadSession | null {
  return parseSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export type JourneyGate =
  | { ok: true; session: LeadSession }
  | { ok: false; response: NextResponse };

export function requireJourney(request: NextRequest): JourneyGate {
  const session = readSession(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'no_lead', message: 'Enter your details first.' },
        { status: 409 },
      ),
    };
  }
  if (!isActive(session)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'session_expired', message: SESSION_EXPIRED_MESSAGE },
        { status: 401 },
      ),
    };
  }
  if (!session.verified) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'not_verified', message: 'Please verify your mobile number first.' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}

/** Write the cookie, stamped now. Every successful step is activity. */
export function writeSession(
  response: NextResponse,
  session: Pick<LeadSession, 'leadId' | 'verified'>,
): NextResponse {
  response.cookies.set(SESSION_COOKIE, serialiseSession(session), sessionCookieOptions);
  return response;
}

export function clearSession(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
