import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireJourney, writeSession } from '@/lib/http/session';
import { changePincodeSchema, PINCODE_INVALID_MESSAGE } from '@/lib/schemas/lead';
import { changePincode } from '@/lib/leads/change-pincode';
import {
  IDEMPOTENCY_HEADER,
  IdempotencyInFlightError,
  IdempotencyKeyReusedError,
  withIdempotency,
} from '@/lib/idempotency/idempotency';

/**
 * POST /api/leads/pincode — the customer tries another pincode, from the
 * dealer step's "no dealership in your area" state.
 *
 * Patches the lead in this browser's session; never creates one.
 */

export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/leads/pincode';

const MESSAGES: Record<string, string> = {
  lead_not_found: 'Enter your details first.',
  not_verified: 'Please verify your mobile number first.',
};

export async function POST(request: NextRequest) {
  // A live, verified journey — see lib/http/session.ts.
  const gate = requireJourney(request);
  if (!gate.ok) return gate.response;
  const { session } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = changePincodeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_failed', message: PINCODE_INVALID_MESSAGE },
      { status: 422 },
    );
  }

  try {
    const { statusCode, body } = await withIdempotency(prisma, {
      key: request.headers.get(IDEMPOTENCY_HEADER),
      route: ROUTE,
      body: { leadId: session.leadId, ...parsed.data },
      handler: async (): Promise<{ statusCode: number; body: unknown }> => {
        const result = await changePincode(prisma, session.leadId, parsed.data.pincode);
        if (result.ok) return { statusCode: 200, body: { lead: result.lead } };
        return {
          statusCode: result.reason === 'not_verified' ? 403 : 409,
          body: { error: result.reason, message: MESSAGES[result.reason] },
        };
      },
    });

    return writeSession(NextResponse.json(body, { status: statusCode }), session);
  } catch (error) {
    if (error instanceof IdempotencyKeyReusedError) {
      return NextResponse.json({ error: 'idempotency_key_reused' }, { status: 422 });
    }
    if (error instanceof IdempotencyInFlightError) {
      return NextResponse.json({ error: 'request_in_flight' }, { status: 409 });
    }

    console.error('[POST /api/leads/pincode] failed', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'internal_error', message: 'We couldn’t process your request. Please try again in a moment.' },
      { status: 500 },
    );
  }
}
