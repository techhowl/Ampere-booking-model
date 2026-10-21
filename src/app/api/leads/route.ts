import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { leadIdentitySchema } from '@/lib/schemas/lead';
import { saveLead } from '@/lib/leads/save-lead';
import { clientIp } from '@/lib/http/request';
import {
  IDEMPOTENCY_HEADER,
  IdempotencyInFlightError,
  IdempotencyKeyReusedError,
  withIdempotency,
} from '@/lib/idempotency/idempotency';
import { readSession, writeSession } from '@/lib/http/session';

/**
 * POST /api/leads — save name, phone and pincode, before OTP.
 *
 * The record is written the moment these three are valid, with
 * phone_verified = false. An abandoned attempt is still a lead somebody can
 * call. Nothing here gates the write on verification.
 *
 * Never logs the phone number, in any branch, including the error branch.
 */

export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/leads';

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be JSON' },
      { status: 400 },
    );
  }

  const parsed = leadIdentitySchema.safeParse(raw);
  if (!parsed.success) {
    // Field-level messages so the form can put each one under its own input.
    // The phone value itself never appears here.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return NextResponse.json(
      { error: 'validation_failed', fields: fieldErrors },
      { status: 422 },
    );
  }

  const session = readSession(request);
  const context = {
    existingLeadId: session?.leadId ?? null,
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
  };

  try {
    const { statusCode, body } = await withIdempotency(prisma, {
      key: request.headers.get(IDEMPOTENCY_HEADER),
      route: ROUTE,
      body: parsed.data,
      handler: async () => {
        const { response, created } = await saveLead(prisma, parsed.data, context);
        return { statusCode: created ? 201 : 200, body: response };
      },
    });

    const response = NextResponse.json(body, { status: statusCode });

    // Carry the lead id forward so every later step patches this same record
    // rather than starting a new one. Saving step one again is a fresh
    // attempt, so this browser's verification starts over too — the number may
    // not be the one it proved.
    const leadId = (body as { leadId?: string }).leadId;
    if (leadId) writeSession(response, { leadId, verified: false });

    return response;
  } catch (error) {
    if (error instanceof IdempotencyKeyReusedError) {
      return NextResponse.json(
        { error: 'idempotency_key_reused', message: error.message },
        { status: 422 },
      );
    }
    if (error instanceof IdempotencyInFlightError) {
      return NextResponse.json(
        { error: 'request_in_flight', message: error.message },
        { status: 409 },
      );
    }

    // Deliberately opaque: the request body contains a phone number, so it must
    // not be echoed into logs or Sentry along with the stack.
    console.error('[POST /api/leads] failed to save lead', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'internal_error', message: 'Could not save your details. Please try again.' },
      { status: 500 },
    );
  }
}
