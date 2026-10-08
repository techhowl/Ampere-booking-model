import type { PrismaClient } from '@prisma/client';
import { decryptPhone } from '@/lib/crypto/phone';
import { getModel } from '@/lib/catalog/catalog';

/**
 * The lead list, for the call centre.
 *
 * Spec 5 is specific about the shape of this: verified and unverified leads are
 * the same table filtered by `phone_verified`, and they must reach the sales
 * team as DISTINCT segments. Mixed together, a run of dead numbers costs the
 * team's faith in the whole list.
 *
 * Phone numbers appear here in full, because a call centre cannot ring a hash.
 * That makes every export a DPDP event:
 *
 *   - exporting requires admin authentication
 *   - a Google Sheet is plaintext and shareable by link, so any Sheet mirror
 *     needs Legal's sign-off before it is switched on
 *   - Postgres stays the source of truth; a Sheet is a one-way mirror, never
 *     a place data is edited. Spec 8 is blunt about why: "anyone with the link
 *     can break it"
 */

export type LeadSegment = 'verified' | 'unverified' | 'all';

export interface LeadRow {
  leadId: string;
  createdAt: string;
  name: string;
  /** Full E.164. The whole point of the export, and its whole risk. */
  phone: string;
  verified: boolean;
  pincode: string;
  region: string | null;
  dealerCode: string | null;
  dealerName: string | null;
  model: string | null;
  colour: string | null;
  intent: string;
  status: string;
  marketingConsent: boolean;
  source: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
}

export const LEAD_COLUMNS: { key: keyof LeadRow; header: string }[] = [
  { key: 'createdAt', header: 'Created' },
  { key: 'name', header: 'Name' },
  { key: 'phone', header: 'Phone' },
  { key: 'verified', header: 'Verified' },
  { key: 'pincode', header: 'Pincode' },
  { key: 'region', header: 'Region' },
  { key: 'dealerName', header: 'Dealer' },
  { key: 'model', header: 'Model' },
  { key: 'colour', header: 'Colour' },
  { key: 'intent', header: 'Intent' },
  { key: 'status', header: 'Status' },
  { key: 'marketingConsent', header: 'Marketing consent' },
  { key: 'source', header: 'Source' },
  { key: 'utmSource', header: 'UTM source' },
  { key: 'utmCampaign', header: 'UTM campaign' },
  { key: 'leadId', header: 'Lead ID' },
];

export async function exportLeads(
  prisma: PrismaClient,
  options: { segment?: LeadSegment; since?: Date; limit?: number } = {},
): Promise<LeadRow[]> {
  const { segment = 'all', since, limit = 5000 } = options;

  const leads = await prisma.lead.findMany({
    where: {
      ...(segment === 'all' ? {} : { phoneVerified: segment === 'verified' }),
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    include: {
      dealer: true,
      // Latest marketing answer wins; the rest is the consent audit trail.
      consents: { where: { purpose: 'marketing' }, orderBy: { grantedAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return leads.map((lead) => {
    const utm = (lead.utm ?? {}) as Record<string, string>;
    const model = getModel(lead.modelCode);

    return {
      leadId: lead.id,
      createdAt: lead.createdAt.toISOString(),
      name: lead.name,
      phone: decryptPhone(lead.phoneEnc),
      verified: lead.phoneVerified,
      pincode: lead.pincode,
      region: lead.regionCode,
      dealerCode: lead.dealerCode,
      dealerName: lead.dealer?.name ?? null,
      model: model?.name ?? lead.modelCode,
      colour: model?.colours.find((c) => c.code === lead.colourCode)?.name ?? lead.colourCode,
      intent: lead.intent,
      status: lead.status,
      marketingConsent: lead.consents[0]?.granted ?? false,
      source: lead.src,
      utmSource: utm.utm_source ?? null,
      utmCampaign: utm.utm_campaign ?? null,
    };
  });
}

/** RFC 4180: quote everything, double any inner quote. Phone numbers keep their +. */
export function toCsv(rows: LeadRow[]): string {
  const escape = (value: unknown): string => {
    const text =
      value === null || value === undefined
        ? ''
        : typeof value === 'boolean'
          ? value
            ? 'Yes'
            : 'No'
          : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const header = LEAD_COLUMNS.map((c) => escape(c.header)).join(',');
  const body = rows.map((row) => LEAD_COLUMNS.map((c) => escape(row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

/** The same rows as a value grid, which is what the Sheets API takes. */
export function toSheetValues(rows: LeadRow[]): (string | boolean)[][] {
  return [
    LEAD_COLUMNS.map((c) => c.header),
    ...rows.map((row) =>
      LEAD_COLUMNS.map((c) => {
        const value = row[c.key];
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        return value ?? '';
      }),
    ),
  ];
}
