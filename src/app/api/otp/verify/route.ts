import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { readSession, writeSession } from '@/lib/http/session';
import { otpVerifySchema } from '@/lib/schemas/otp';
import { verifyOtp } from '@/lib/otp/otp';
import { queueLeadSync } from '@/lib/crm/schedule';
import { readJsonBody } from '@/lib/http/body';
import { markPhoneVerified } from '@/lib/leads/mark-verified';

/**
 * POST /api/otp/verify — check the code and mark the number verified.
 *
 * On success the SAME lead row is updated to phone_verified = true. There is
 * never a second record, and nothing that was captured before verification is
 * discarded.
 *
 * Not idempotency-wrapped: a code is single-use by design, and a replay is
 * already answered correctly by `already_used`.
 */

export const dynamic = 'force-dynamic';
/** The CRM send runs after the response, inside this function's time. */
export const maxDuration = 60;

const MESSAGES: Record<string, string> = {
  not_found: 'That code is not valid. Please request a new one.',
  expired: 'Your verification code has expired. Request a new one.',
  already_used: 'That code has already been used.',
  too_many_attempts: 'Too many incorrect attempts. Please request a new code.',
  incorrect: 'That doesn’t look right. Please check the code and try again.',
};

export async function POST(request: NextRequest) {
  // Deliberately not requireJourney(): verifying is how an expired journey
  // starts again.
  const session = readSession(request);
  if (!session) {
    return NextResponse.json(
      { error: 'no_lead', message: 'Enter your details before verifying.' },
      { status: 409 },
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = otpVerifySchema.safeParse(body.value);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fields[path]) fields[path] = issue.message;
    }
    return NextResponse.json({ error: 'validation_failed', fields }, { status: 422 });
  }

  const lead = await prisma.lead.findUnique({ where: { id: session.leadId } });
  if (!lead) {
    return NextResponse.json(
      { error: 'no_lead', message: 'Enter your details before verifying.' },
      { status: 409 },
    );
  }

  try {
    const result = await verifyOtp(prisma, {
      otpRef: parsed.data.otpRef,
      code: parsed.data.code,
      // Binds the code to this lead's number. A valid code for someone else is
      // reported as not found rather than accepted.
      expectedPhoneHash: lead.phoneHash,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.reason,
          attemptsRemaining: result.attemptsRemaining,
          message: MESSAGES[result.reason] ?? 'That code is not valid.',
        },
        { status: result.reason === 'incorrect' ? 422 : 410 },
      );
    }

    // Only while the lead still carries the number the code went to. Saved
    // again mid-verify with another number, the proof does not carry over
    // (see markPhoneVerified).
    if (!(await markPhoneVerified(prisma, lead.id, lead.phoneHash))) {
      return NextResponse.json(
        { error: 'not_found', attemptsRemaining: 0, message: MESSAGES.not_found },
        { status: 410 },
      );
    }

    // Verified, so it may go to Greaves' CRM: with the booking, or after a
    // wait if the customer stops before one. See lib/crm/jobs.ts.
    await queueLeadSync(lead.id);

    return writeSession(NextResponse.json({ verified: true }, { status: 200 }), {
      leadId: lead.id,
      verified: true,
    });
  } catch (error) {
    console.error('[POST /api/otp/verify] failed', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'internal_error', message: 'Could not verify the code. Please try again.' },
      { status: 500 },
    );
  }
}
