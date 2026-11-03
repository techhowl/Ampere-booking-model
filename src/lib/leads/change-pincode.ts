import type { PrismaClient } from '@prisma/client';
import { resolvePincode } from '@/lib/dealers/resolve';
import type { LeadCreatedResponse } from '@/lib/schemas/lead';
import { toLeadResponse } from './save-lead';

/**
 * "Change location" on the dealer step: no dealership near this pincode, so
 * the customer tries another.
 *
 * The same lead, verified as it was — the number has not changed, so neither
 * has the proof. Region and default dealer follow the new pincode, and any
 * dealer chosen for the old one is let go: it was offered for somewhere else.
 */

export type ChangePincodeOutcome =
  | { ok: true; lead: LeadCreatedResponse }
  | { ok: false; reason: 'lead_not_found' | 'not_verified' };

export async function changePincode(
  prisma: PrismaClient,
  leadId: string,
  pincode: string,
): Promise<ChangePincodeOutcome> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false, reason: 'lead_not_found' };

  // The dealer step sits behind the OTP, like everything after step one.
  if (!lead.phoneVerified) return { ok: false, reason: 'not_verified' };

  const location = await resolvePincode(prisma, pincode);
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      pincode,
      stateCode: location.stateCode,
      regionCode: location.regionCode,
      dealerCode: location.dealer?.code ?? null,
    },
  });

  return { ok: true, lead: toLeadResponse(lead.id, lead.phoneLast4, pincode, location) };
}
