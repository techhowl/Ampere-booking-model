import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { SESSION_COOKIE, parseSession } from '@/lib/crypto/session';
import { chooseDealerSchema } from '@/lib/schemas/dealer';
import { chooseDealer } from '@/lib/leads/choose-dealer';
import {
  IDEMPOTENCY_HEADER,
  IdempotencyInFlightError,
  IdempotencyKeyReusedError,
  withIdempotency,
} from '@/lib/idempotency/idempotency';

/**
 * POST /api/leads/dealer — record which dealer the customer picked.
 *
 * Patches the lead in this browser's session; never creates one. The order and
 * test ride routes then read the dealer from the lead.
 */

export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/leads/dealer';

const MESSAGES: Record<string, string> = {
  lead_not_found: 'Enter your details first.',
  not_verified: 'Please verify your mobile number first.',
  not_offered: 'That dealer is not available for your pincode. Please choose another.',
};

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

  const parsed = chooseDealerSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_failed', message: parsed.error.issues[0]?.message },
      { status: 422 },
    );
  }

  try {
    const { statusCode, body } = await withIdempotency(prisma, {
      key: request.headers.get(IDEMPOTENCY_HEADER),
      route: ROUTE,
      body: { leadId: session.leadId, ...parsed.data },
      handler: async (): Promise<{ statusCode: number; body: unknown }> => {
        const result = await chooseDealer(prisma, session.leadId, parsed.data.dealerCode);
        if (result.ok) return { statusCode: 200, body: { dealer: result.dealer } };

        return {
          statusCode:
            result.reason === 'not_verified' ? 403 : result.reason === 'not_offered' ? 422 : 409,
          body: { error: result.reason, message: MESSAGES[result.reason] },
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

    console.error('[POST /api/leads/dealer] failed', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'internal_error', message: 'Could not save your dealer. Please try again.' },
      { status: 500 },
    );
  }
}
