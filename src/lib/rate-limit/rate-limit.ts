import type { PrismaClient } from '@prisma/client';

/**
 * Rate limits, in Postgres.
 *
 * Spec 15: bot defence on OTP is "Turnstile plus rate limits per phone, per IP,
 * per device". Three dimensions, because each one alone is easy to defeat — a
 * botnet has many IPs, an emulator farm has many devices, and neither needs
 * more than one phone number to burn Ampere's SMS budget.
 *
 * A fixed window that resets once elapsed. The cost of a burst straddling a
 * window boundary is one extra message; the per-phone cooldown handles the
 * case that actually matters.
 */

export type LimitKind = 'phone' | 'ip' | 'device';

export interface LimitRule {
  kind: LimitKind;
  /** Never a raw phone number — the hashed one, an IP, or a device id. */
  subject: string;
  max: number;
  windowSeconds: number;
}

export interface LimitDecision {
  allowed: boolean;
  /** The dimension that refused, when one did. */
  blockedBy: LimitKind | null;
  /** Seconds until the offending window resets. */
  retryAfterSeconds: number;
}

const ALLOWED: LimitDecision = { allowed: true, blockedBy: null, retryAfterSeconds: 0 };

/**
 * Checks every rule and increments those that pass.
 *
 * Rules are evaluated in order and the first refusal stops the walk, so a
 * request blocked on phone does not also burn the caller's IP quota.
 */
export async function consume(
  prisma: PrismaClient,
  scope: string,
  rules: LimitRule[],
): Promise<LimitDecision> {
  for (const rule of rules) {
    const decision = await consumeOne(prisma, scope, rule);
    if (!decision.allowed) return decision;
  }
  return ALLOWED;
}

async function consumeOne(
  prisma: PrismaClient,
  scope: string,
  rule: LimitRule,
): Promise<LimitDecision> {
  const now = new Date();
  const windowMs = rule.windowSeconds * 1000;

  return prisma.$transaction(async (tx) => {
    // Lock the counter row so two simultaneous requests cannot both read the
    // same count and both decide they are under the limit.
    const rows = await tx.$queryRaw<{ count: number; window_start: Date }[]>`
      SELECT count, window_start FROM rate_limits
      WHERE scope = ${scope} AND kind = ${rule.kind} AND subject = ${rule.subject}
      FOR UPDATE
    `;

    const existing = rows[0];
    const windowExpired =
      !existing || now.getTime() - existing.window_start.getTime() >= windowMs;

    if (windowExpired) {
      await tx.rateLimit.upsert({
        where: {
          scope_kind_subject: { scope, kind: rule.kind, subject: rule.subject },
        },
        create: { scope, kind: rule.kind, subject: rule.subject, count: 1, windowStart: now },
        update: { count: 1, windowStart: now },
      });
      return ALLOWED;
    }

    if (existing.count >= rule.max) {
      const elapsed = now.getTime() - existing.window_start.getTime();
      return {
        allowed: false,
        blockedBy: rule.kind,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
      };
    }

    await tx.rateLimit.update({
      where: {
        scope_kind_subject: { scope, kind: rule.kind, subject: rule.subject },
      },
      data: { count: { increment: 1 } },
    });
    return ALLOWED;
  });
}

/**
 * Reads a counter without incrementing it. Used for the resend cooldown, where
 * asking "how long until I may try again" must not itself count as a try.
 */
export async function secondsUntilReset(
  prisma: PrismaClient,
  scope: string,
  kind: LimitKind,
  subject: string,
  windowSeconds: number,
): Promise<number> {
  const row = await prisma.rateLimit.findUnique({
    where: { scope_kind_subject: { scope, kind, subject } },
  });
  if (!row) return 0;

  const elapsed = Date.now() - row.windowStart.getTime();
  const remaining = windowSeconds * 1000 - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Background job. An elapsed window carries no information. */
export async function purgeExpired(
  prisma: PrismaClient,
  olderThanSeconds = 86_400,
): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: new Date(Date.now() - olderThanSeconds * 1000) } },
  });
  return count;
}
