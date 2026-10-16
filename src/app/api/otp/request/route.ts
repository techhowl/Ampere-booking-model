import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { clientIp } from '@/lib/http/request';
import { decryptPhone } from '@/lib/crypto/phone';
import { SESSION_COOKIE, parseSession } from '@/lib/crypto/session';
import { otpRequestSchema, type OtpRequestResponse } from '@/lib/schemas/otp';
import { requestOtp } from '@/lib/otp/otp';
import { getSmsClient } from '@/lib/sms/sms';
import { verifyTurnstile } from '@/lib/turnstile';
import {
  IDEMPOTENCY_HEADER,
  IdempotencyInFlightError,
  IdempotencyKeyReusedError,
  withIdempotency,
} from '@/lib/idempotency/idempotency';

/**
 * POST /api/otp/request — send a verification code.
 *
 * The lead already exists by the time this runs; the continuity cookie says
 * which one. The phone number is never accepted from the body — taking it from
 * the saved record is what stops this endpoint being used to send messages to
 * arbitrary numbers.
 */

export const dynamic = 'force-dynamic';

const ROUTE = 'POST /api/otp/request';

/**
 * Every shape this route can store and replay, so idempotency can type it.
 *
 * The success arm is the shared OtpRequestResponse rather than a second copy
 * of the same fields — the client reads that type, and two definitions drift.
 *
 * Note for UAT: withIdempotency persists this body to Postgres, so when
 * testCode is populated a live code is stored in plaintext. That is only ever
 * true outside production (env.otpEchoEnabled), where the data is fake, but it
 * is a second reason the production lock has to hold.
 */
type RequestBody =
  | OtpRequestResponse
  | { error: string; message: string; retryAfterSeconds?: number };

export async function POST(request: NextRequest) {
  const session = parseSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: 'no_lead', message: 'Enter your details before requesting a code.' },
      { status: 409 },
    );
  }

  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    // An empty body is fine — everything in it is optional.
  }

  const parsed = otpRequestSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation_failed' }, { status: 422 });
  }

  const ip = clientIp(request);

  const bot = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!bot.ok) {
    const status = bot.reason === 'unreachable' ? 503 : 403;
    return NextResponse.json(
      {
        error: 'bot_check_failed',
        reason: bot.reason,
        message:
          bot.reason === 'unreachable'
            ? 'We could not complete a security check. Please try again shortly.'
            : 'Please complete the security check and try again.',
      },
      { status },
    );
  }

  const lead = await prisma.lead.findUnique({ where: { id: session.leadId } });
  if (!lead) {
    return NextResponse.json(
      { error: 'no_lead', message: 'Enter your details before requesting a code.' },
      { status: 409 },
    );
  }

  try {
    const { statusCode, body } = await withIdempotency(prisma, {
      key: request.headers.get(IDEMPOTENCY_HEADER),
      route: ROUTE,
      // The lead id, not the phone. An idempotency hash must never be computed
      // over a number we are otherwise careful never to write down.
      body: { leadId: lead.id },
      handler: async (): Promise<{ statusCode: number; body: RequestBody }> => {
        const result = await requestOtp(prisma, getSmsClient(), {
          phoneHash: lead.phoneHash,
          phoneE164: decryptPhone(lead.phoneEnc),
          ip,
          deviceId: lead.id,
        });

        if (result.ok) {
          return {
            statusCode: 200,
            body: {
              otpRef: result.otpRef,
              expiresAt: result.expiresAt.toISOString(),
              resendAfterSeconds: result.resendAfterSeconds,
              phoneLast4: lead.phoneLast4,
              // Undefined unless env.otpEchoEnabled, which is false in
              // production and requires OTP_ECHO_ENABLED to be set anywhere
              // else. JSON.stringify drops the key entirely when undefined.
              testCode: result.echoCode,
            },
          };
        }

        if (result.reason === 'delivery_failed') {
          return {
            statusCode: 502,
            body: {
              error: 'delivery_failed',
              message: 'We could not send the code. Please try again.',
            },
          };
        }

        return {
          statusCode: 429,
          body: {
            error: result.reason,
            retryAfterSeconds: result.retryAfterSeconds,
            message:
              result.reason === 'cooldown'
                ? `Please wait ${result.retryAfterSeconds}s before asking for another code.`
                : 'Too many attempts. Please try again later.',
          },
        };
      },
    });

    const response = NextResponse.json(body, { status: statusCode });
    const retryAfter = (body as { retryAfterSeconds?: number }).retryAfterSeconds;
    if (statusCode === 429 && retryAfter) {
      response.headers.set('Retry-After', String(retryAfter));
    }
    return response;
  } catch (error) {
    if (error instanceof IdempotencyKeyReusedError) {
      return NextResponse.json({ error: 'idempotency_key_reused' }, { status: 422 });
    }
    if (error instanceof IdempotencyInFlightError) {
      return NextResponse.json({ error: 'request_in_flight' }, { status: 409 });
    }

    console.error('[POST /api/otp/request] failed', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'internal_error', message: 'Could not send a code. Please try again.' },
      { status: 500 },
    );
  }
}
