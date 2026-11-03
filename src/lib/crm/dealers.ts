import type { PrismaClient } from '@prisma/client';

/**
 * The dealer master, read from Greaves CRM.Next.
 *
 * Greaves' `get_dealers` function lists every active dealer with its CRM
 * account id, name, city, state and pincode — nothing else yet: no street
 * address, no phone, no coordinates. `pnpm crm sync-dealers` makes our
 * `dealers` table match it:
 *
 *   - each listed dealer is created or updated under the code GEM-<crm id>
 *   - its location is its pincode's centre (pincode_geo). Good to a couple of
 *     km, which is enough to rank showrooms inside the 15 km radius
 *   - until Greaves send a street address, the card shows "City, State PIN"
 *   - every other dealer is retired (active = false): the placeholders, and
 *     any CRM dealer that has left the list. Never deleted — leads, orders and
 *     stock still point at them
 *
 * Ids are per environment, so a sandbox sync gives sandbox dealers and a
 * production sync production ones. Same rule as crm_vehicle_models.
 */

export interface CrmDealer {
  crmId: string;
  name: string;
  city: string;
  state: string;
  pincode: string;
}

export interface DealerList {
  dealers: CrmDealer[];
  /** Rows dropped as unusable, with why — never silently. */
  skipped: { row: number; reason: string }[];
}

export class DealerListError extends Error {}

/** Our dealer code for a CRM dealer. Stable, so a re-sync updates in place. */
export const dealerCodeFor = (crmId: string) => `GEM-${crmId}`;

const CRM_ID = /^\d{10,30}$/;
const PINCODE = /^[1-9]\d{5}$/;

/**
 * Read get_dealers' HTTP answer. Throws DealerListError when it is not a
 * dealer list at all; drops (and reports) single rows that are unusable.
 */
export function parseDealerList(status: number, body: string): DealerList {
  if (status !== 200) throw new DealerListError(`get_dealers answered HTTP ${status}`);

  let envelope: { code?: unknown; details?: { output?: unknown } };
  try {
    envelope = JSON.parse(body) as typeof envelope;
  } catch {
    throw new DealerListError('get_dealers answered something that is not JSON');
  }
  const output = envelope?.details?.output;
  if (envelope?.code !== 'success' || typeof output !== 'string') {
    throw new DealerListError(`get_dealers did not complete (${String(envelope?.code ?? 'unknown')})`);
  }

  // A 19-digit id overflows a JavaScript number. They arrive quoted today;
  // quote any that ever arrive bare before parsing, so none is rounded.
  const safe = output.replace(/("dealer_id"\s*:\s*)(\d+)/g, '$1"$2"');
  let result: { status?: unknown; message?: unknown; dealers?: unknown; total_dealers?: unknown };
  try {
    result = JSON.parse(safe) as typeof result;
  } catch {
    throw new DealerListError('get_dealers output is not JSON');
  }
  if (result.status !== 'success' || !Array.isArray(result.dealers)) {
    throw new DealerListError(`get_dealers said: ${String(result.message ?? result.status ?? 'no dealer list')}`);
  }

  const dealers: CrmDealer[] = [];
  const skipped: DealerList['skipped'] = [];
  const seen = new Set<string>();
  for (const [index, raw] of (result.dealers as unknown[]).entries()) {
    const row = index + 1;
    const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const crmId = clean(d.dealer_id);
    const name = clean(d.dealer_name);
    const pincode = clean(d.pincode);
    const problem = !CRM_ID.test(crmId)
      ? 'no valid dealer_id'
      : !name
        ? `dealer ${crmId} has no name`
        : !PINCODE.test(pincode)
          ? `dealer ${crmId} has no valid pincode`
          : seen.has(crmId)
            ? `dealer ${crmId} is listed twice`
            : null;
    if (problem) {
      skipped.push({ row, reason: problem });
      continue;
    }
    seen.add(crmId);
    dealers.push({ crmId, name, city: clean(d.city), state: clean(d.state), pincode });
  }

  if (typeof result.total_dealers === 'number' && result.total_dealers !== result.dealers.length) {
    // The list says it is partial. Retiring everyone missing from it would be wrong.
    throw new DealerListError(
      `get_dealers says ${result.total_dealers} dealers but sent ${result.dealers.length}; is it paged?`,
    );
  }
  return { dealers, skipped };
}

function clean(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().replace(/\s+/g, ' ') : '';
}

/** What a dealer card shows until the CRM sends a street address. */
export function localityOf(dealer: Pick<CrmDealer, 'city' | 'state' | 'pincode'>): string {
  return [[dealer.city, dealer.state].filter(Boolean).join(', '), dealer.pincode].filter(Boolean).join(' ');
}

export interface SyncSummary {
  listed: number;
  created: number;
  updated: number;
  /** Active before, not in the list: now inactive. */
  retired: string[];
  /** Listed, but their pincode has no location, so no radius search finds them. */
  unlocated: { code: string; name: string; pincode: string }[];
  dryRun: boolean;
}

/**
 * Below this, a list is treated as broken rather than as most dealers
 * closing overnight: a sync that would retire more than half of the CRM
 * dealers we have stops, unless forced.
 */
const MAX_RETIRE_SHARE = 0.5;

export async function syncDealers(
  prisma: PrismaClient,
  list: CrmDealer[],
  options: { dryRun?: boolean; force?: boolean } = {},
): Promise<SyncSummary> {
  if (list.length === 0) throw new DealerListError('The CRM listed no dealers. Nothing changed.');

  const codes = new Set(list.map((d) => dealerCodeFor(d.crmId)));
  const geo = new Map(
    (await prisma.pincodeGeo.findMany({ where: { pincode: { in: [...new Set(list.map((d) => d.pincode))] } } })).map(
      (g) => [g.pincode, g],
    ),
  );

  return prisma.$transaction(
    async (tx) => {
      const existing = new Set(
        (await tx.dealer.findMany({ where: { dealerCode: { in: [...codes] } }, select: { dealerCode: true } })).map(
          (d) => d.dealerCode,
        ),
      );
      const activeElsewhere = await tx.dealer.findMany({
        where: { active: true, dealerCode: { notIn: [...codes] } },
        select: { dealerCode: true },
      });
      const retired = activeElsewhere.map((d) => d.dealerCode);

      const synced = await tx.dealer.count({ where: { active: true, dealerCode: { startsWith: 'GEM-' } } });
      const retiringSynced = retired.filter((code) => code.startsWith('GEM-')).length;
      if (!options.force && synced > 0 && retiringSynced / synced > MAX_RETIRE_SHARE) {
        throw new DealerListError(
          `This sync would retire ${retiringSynced} of ${synced} CRM dealers. ` +
            'That looks like a broken list, so nothing changed. Run with --force if it is real.',
        );
      }

      const summary: SyncSummary = {
        listed: list.length,
        created: list.filter((d) => !existing.has(dealerCodeFor(d.crmId))).length,
        updated: list.filter((d) => existing.has(dealerCodeFor(d.crmId))).length,
        retired,
        unlocated: list
          .filter((d) => !geo.has(d.pincode))
          .map((d) => ({ code: dealerCodeFor(d.crmId), name: d.name, pincode: d.pincode })),
        dryRun: Boolean(options.dryRun),
      };
      if (options.dryRun) return summary;

      for (const dealer of list) {
        const point = geo.get(dealer.pincode);
        const fields = {
          name: dealer.name,
          address: localityOf(dealer),
          lat: point?.lat ?? null,
          lng: point?.lng ?? null,
          active: true,
          crmId: dealer.crmId,
        };
        // Phone and home test rides are not in the CRM list, so a sync leaves
        // whatever we hold for them alone.
        await tx.dealer.upsert({
          where: { dealerCode: dealerCodeFor(dealer.crmId) },
          create: { dealerCode: dealerCodeFor(dealer.crmId), ...fields },
          update: fields,
        });
      }
      if (retired.length > 0) {
        await tx.dealer.updateMany({ where: { dealerCode: { in: retired } }, data: { active: false } });
      }
      return summary;
    },
    { timeout: 60_000 },
  );
}
