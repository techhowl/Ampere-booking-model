import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireJourney, writeSession } from '@/lib/http/session';
import { createOrderSchema } from '@/lib/schemas/order';
import { createOrder, OrderError } from '@/lib/orders/create-order';
import { getJuspayClient } from '@/lib/juspay/client';
import {
  IDEMPOTENCY_HEADER,
  IdempotencyInFlightError,
  IdempotencyKeyReusedError,
  withIdempotency,
} from '@/lib/idempotency/idempotency';

/**
 * POST /api/orders — reserve stock, create the order, get a Juspay session.
 *
 * Idempotency-keyed, because a customer double-tapping Pay on a flaky mobile
 * connection must not produce two orders or hold two scooters.
 */

export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/orders';

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

  const parsed = createOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation_failed' }, { status: 422 });
  }

  const origin = request.nextUrl.origin;

  try {
    const { statusCode, body } = await withIdempotency(prisma, {
      key: request.headers.get(IDEMPOTENCY_HEADER),
      route: ROUTE,
      body: { leadId: session.leadId, ...parsed.data },
      handler: async (): Promise<{ statusCode: number; body: unknown }> => {
        try {
          const order = await createOrder(
            prisma,
            getJuspayClient(),
            { leadId: session.leadId, ...parsed.data },
            `${origin}/buy/return`,
          );
          return { statusCode: 201, body: order };
        } catch (error) {
          if (error instanceof OrderError) {
            const status = error.reason === 'out_of_stock' ? 409 : 422;
            return {
              statusCode: status,
              body: { error: error.reason, message: error.message },
            };
          }
          throw error;
        }
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

    console.error('[POST /api/orders] failed', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'internal_error', message: 'Could not start your payment. Please try again.' },
      { status: 500 },
    );
  }
}
