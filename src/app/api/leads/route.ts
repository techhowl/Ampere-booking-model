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
import { readJsonBody } from '@/lib/http/body';
import { allowNewLead } from '@/lib/leads/limits';
import { env } from '@/lib/env';
import { queueLeadSync } from '@/lib/crm/schedule';

/**
 * POST /api/leads — save name, phone and pincode, before OTP.
 *
 * The record is written the moment these three are valid, with
 * phone_verified = false. An abandoned attempt is still a lead somebody can
 * call. Nothing here gates the write on verification.
 *
 * Never logs the phone number, in any branch, including the error branch.
 *
 * Bounded: the body by size (readJsonBody), new leads per address by
 * allowNewLead. A browser re-saving its own lead is never limited.
 */

export const dynamic = 'force-dynamic';
/** With the OTP off, CRM sends that have come due run after the response. */
export const maxDuration = 60;

const ROUTE = 'POST /api/leads';

/** Name, phone, pincode, consent and attribution: a few KB at the very most. */
const LEAD_BODY_MAX_BYTES = 32 * 1024;

export async function POST(request: NextRequest) {
  const json = await readJsonBody(request, { maxBytes: LEAD_BODY_MAX_BYTES });
  if (!json.ok) return json.response;

  const parsed = leadIdentitySchema.safeParse(json.value);
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

  // Only a browser without a lead creates one, so only that is counted.
  if (!context.existingLeadId) {
    const limit = await allowNewLead(prisma, context.ip);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: 'rate_limited',
          retryAfterSeconds: limit.retryAfterSeconds,
          message: 'We are getting a lot of requests from your network. Please try again in a few minutes.',
        },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }
  }

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

    // With the OTP off there is no verify step to queue the CRM lead from, so
    // it is queued here: held for the booking, sent after LEAD_HOLD_MS if
    // none comes. A changed number is a new job (see lib/crm/jobs.ts).
    if (leadId && !env.otpRequired) await queueLeadSync(leadId);

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
