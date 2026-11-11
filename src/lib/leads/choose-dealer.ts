import type { PrismaClient } from '@prisma/client';
import { getModel } from '@/lib/catalog/catalog';
import { findOfferedDealer, type NearbyDealer } from '@/lib/dealers/nearby';

/**
 * The customer picks their dealer.
 *
 * Written onto the lead, so the choice survives an abandoned journey — the
 * dealer they picked is the one who calls — and so the order and test ride
 * routes read it from one place rather than trusting the browser twice.
 *
 * The code is checked against what we would offer for the lead's own pincode.
 * A customer cannot point their lead at an arbitrary dealer by editing a
 * request.
 *
 * The scooter on screen is kept too, if it is one we sell: a customer who stops
 * after this has no booking to carry it to the CRM.
 */

export type ChooseDealerOutcome =
  | { ok: true; dealer: NearbyDealer }
  | { ok: false; reason: 'lead_not_found' | 'not_verified' | 'not_offered' };

export async function chooseDealer(
  prisma: PrismaClient,
  leadId: string,
  dealerCode: string,
  scooter: { modelCode?: string | null; colourCode?: string | null } = {},
): Promise<ChooseDealerOutcome> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false, reason: 'lead_not_found' };

  // The dealer step sits behind the OTP, like everything after step one.
  if (!lead.phoneVerified) return { ok: false, reason: 'not_verified' };

  const dealer = await findOfferedDealer(prisma, lead.pincode, dealerCode);
  if (!dealer) return { ok: false, reason: 'not_offered' };

  const model = getModel(scooter.modelCode);
  const colour = model?.colours.find((c) => c.code === scooter.colourCode);

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      dealerCode: dealer.code,
      ...(model ? { modelCode: model.code, colourCode: colour?.code ?? null } : {}),
    },
  });

  return { ok: true, dealer };
}
