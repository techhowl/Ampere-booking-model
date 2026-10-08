import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { SESSION_COOKIE, parseSession } from '@/lib/crypto/session';
import { testRideSchema } from '@/lib/schemas/test-ride';
import { bookTestRide } from '@/lib/test-rides/book';
import { offeredDays } from '@/lib/test-rides/slots';
import { getDealerNotifier } from '@/lib/notifications/dealer';
import {
  IDEMPOTENCY_HEADER,
  IdempotencyInFlightError,
  IdempotencyKeyReusedError,
  withIdempotency,
} from '@/lib/idempotency/idempotency';

/**
 * GET  /api/test-rides — the slots we are offering right now
 * POST /api/test-rides — book one, and notify the dealer
 *
 * Slots are computed server-side in IST. The browser's clock and timezone are
 * not consulted, and a slot it sends back is re-validated against what we
 * actually offered.
 */

export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/test-rides';

const MESSAGES: Record<string, string> = {
  not_verified: 'Please verify your mobile number first.',
  lead_not_found: 'Enter your details before booking.',
  no_dealer: 'We have no dealer covering your pincode yet. We will call you instead.',
  unknown_model: 'We could not find that model.',
  out_of_range: 'Please pick a date within the next seven days.',
  too_late: 'That slot has already started. Please pick another.',
  unknown_window: 'Please pick one of the available time slots.',
  bad_date: 'Please pick a valid date.',
};

export async function GET() {
  return NextResponse.json(
    { days: offeredDays() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const session = parseSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: 'no_lead', message: MESSAGES.lead_not_found },
      { status: 409 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = testRideSchema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fields[path]) fields[path] = issue.message;
    }
    return NextResponse.json({ error: 'validation_failed', fields }, { status: 422 });
  }

  try {
    const { statusCode, body } = await withIdempotency(prisma, {
      key: request.headers.get(IDEMPOTENCY_HEADER),
      route: ROUTE,
      body: { leadId: session.leadId, ...parsed.data },
      handler: async (): Promise<{ statusCode: number; body: unknown }> => {
        const result = await bookTestRide(prisma, getDealerNotifier(), {
          leadId: session.leadId,
          ...parsed.data,
        });

        if (result.ok) return { statusCode: 201, body: result.booking };

        const detail = result.reason === 'bad_slot' ? result.detail : result.reason;
        const status =
          result.reason === 'not_verified' ? 403 : result.reason === 'bad_slot' ? 422 : 409;

        return {
          statusCode: status,
          body: {
            error: result.reason,
            detail,
            message: MESSAGES[detail] ?? 'We could not book that slot.',
          },
        };
      },
    });

    return NextResponse.json(body, { status: statusCode });
  } catch (error) {
    if (error instanceof IdempotencyKeyReusedError) {
      return NextResponse.json({ error: 'idempotency_key_reused' }, { status: 422 });
    }
    if (error instanceof IdempotencyInFlightError) {
      return NextResponse.json({ error: 'request_in_flight' }, { status: 409 });
    }

    console.error('[POST /api/test-rides] failed', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'internal_error', message: 'Could not book your test ride. Please try again.' },
      { status: 500 },
    );
  }
}
