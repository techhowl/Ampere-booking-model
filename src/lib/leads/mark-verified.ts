import type { PrismaClient } from '@prisma/client';

/**
 * Mark a lead's number verified, but only if the lead still carries the
 * number the code was sent to.
 *
 * The OTP route reads the lead, checks the code against that lead's phone
 * hash, then writes. Step one can be saved again in between, on the same
 * session, with a different number. An unconditional write then marked the
 * NEW number verified on the strength of a code sent to the old one. The
 * security audit reproduced it on the second try (V-02).
 *
 * The phone hash in the WHERE clause closes that. Postgres re-checks the
 * condition on the row as it stands when the update takes its lock, so a
 * number changed a moment earlier makes this match nothing.
 *
 * Returns whether the lead was marked. False means the number changed under
 * the code: nothing was proven, and the caller must not say otherwise.
 */
export async function markPhoneVerified(
  prisma: PrismaClient,
  leadId: string,
  provenPhoneHash: string,
): Promise<boolean> {
  const { count } = await prisma.lead.updateMany({
    where: { id: leadId, phoneHash: provenPhoneHash },
    data: { phoneVerified: true },
  });
  return count === 1;
}
