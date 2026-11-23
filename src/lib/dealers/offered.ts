import { Prisma } from '@prisma/client';
import { env } from '@/lib/env';

/**
 * Which dealers the page may offer, in one place.
 *
 * Active, always. During the Zoho pilot (PILOT_DEALER_CRM_IDS) also one of the
 * pilot dealers, by CRM account id: every other dealer is still on Goal App,
 * and a lead or test ride for them must not come through here. When the pilot
 * ends the setting goes, and every active dealer is offered again.
 *
 * Every query that picks a dealer for a customer goes through these: the
 * nearby search, pincode resolution, and the lead's fallback dealer.
 */

export function offeredDealerWhere(): Prisma.DealerWhereInput {
  const pilot = env.pilotDealerCrmIds;
  return pilot ? { active: true, crmId: { in: pilot } } : { active: true };
}

/** The same rule as SQL, for the raw distance query. `alias` is the dealers table's. */
export function offeredDealerSql(alias: string): Prisma.Sql {
  const table = Prisma.raw(alias);
  const pilot = env.pilotDealerCrmIds;
  return pilot
    ? Prisma.sql`${table}.active AND ${table}.crm_id IN (${Prisma.join(pilot)})`
    : Prisma.sql`${table}.active`;
}

export function isOffered(dealer: { active: boolean; crmId: string | null }): boolean {
  if (!dealer.active) return false;
  const pilot = env.pilotDealerCrmIds;
  return !pilot || (dealer.crmId !== null && pilot.includes(dealer.crmId));
}

/** True while the pilot setting restricts the dealers. */
export function pilotActive(): boolean {
  return env.pilotDealerCrmIds !== null;
}
