import type { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';
import { consume } from '@/lib/rate-limit/rate-limit';

/**
 * How many NEW leads one address may create per hour.
 *
 * POST /api/leads takes no proof of anything, and with the OTP off it is the
 * only door to the dealer and the CRM. Unlimited, one script could fill the
 * call centre's list with other people's numbers (security audit V-04).
 *
 * Generous on purpose. Losing a real lead is the expensive mistake here, and
 * Indian mobile carriers put many customers behind one address, so this is a
 * ceiling for scripts, not for people. Saving step one again for the lead a
 * browser already has is never counted. UAT, where a whole team tests from
 * one office, gets ten times as many, as the OTP limits do.
 */
export const NEW_LEAD_LIMIT = { max: 60, windowSeconds: 3600 } as const;
export const UAT_NEW_LEAD_LIMIT = { max: 600, windowSeconds: 3600 } as const;

export type NewLeadDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export async function allowNewLead(prisma: PrismaClient, ip: string | null): Promise<NewLeadDecision> {
  if (!ip) return { allowed: true };
  const limit = env.otpEchoEnabled ? UAT_NEW_LEAD_LIMIT : NEW_LEAD_LIMIT;
  try {
    const decision = await consume(prisma, 'lead_create', [{ kind: 'ip', subject: ip, ...limit }]);
    return decision.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: decision.retryAfterSeconds };
  } catch (error) {
    // Fail open. A broken counter must not cost a customer their enquiry;
    // saving the lead will meet the same database problem and say so.
    console.error('[leads] new-lead limit unavailable; allowing', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    return { allowed: true };
  }
}
