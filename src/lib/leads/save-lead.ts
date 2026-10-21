import { Prisma, type PrismaClient } from '@prisma/client';
import { normalisePhone, phoneColumns } from '@/lib/crypto/phone';
import { resolvePincode, type PincodeResolution } from '@/lib/dealers/resolve';
import { env } from '@/lib/env';
import { isValidColourCode } from '@/lib/catalog/catalog';
import type { LeadIdentityInput, LeadCreatedResponse } from '@/lib/schemas/lead';

/**
 * Save the lead. This is the most important function in the application.
 *
 * Spec 5: the record is written as soon as name, phone and pincode are present
 * and syntactically valid — BEFORE the OTP is sent, not after it is verified.
 * It carries phone_verified = false. A customer who abandons at the colour
 * picker is still a lead with a known dealer; a customer who never receives the
 * OTP is still a lead, flagged unverified.
 *
 * There is never a second record for the same attempt. When the browser already
 * carries a lead id, every subsequent step patches that same row.
 */

export const TRANSACTIONAL = 'transactional';
export const MARKETING = 'marketing';

export interface SaveLeadContext {
  /** From the continuity cookie, if the customer has been here before. */
  existingLeadId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface SaveLeadResult {
  response: LeadCreatedResponse;
  /** True when a row was inserted; false when an existing one was patched. */
  created: boolean;
}

export async function saveLead(
  prisma: PrismaClient,
  input: LeadIdentityInput,
  context: SaveLeadContext,
): Promise<SaveLeadResult> {
  const e164 = normalisePhone(input.phone);
  if (!e164) {
    // The schema should have caught this. Belt and braces, because a bad number
    // here would produce a hash that never matches anything.
    throw new Error('saveLead received a phone number that does not normalise');
  }

  const phone = phoneColumns(e164);
  const location = await resolvePincode(prisma, input.pincode);

  // A colour only means anything alongside its model.
  const colourCode =
    input.modelCode && isValidColourCode(input.modelCode, input.colourCode)
      ? input.colourCode
      : null;

  const attribution = input.attribution ?? {};

  const common = {
    name: input.name,
    ...phone,
    pincode: input.pincode,
    stateCode: location.stateCode,
    regionCode: location.regionCode,
    dealerCode: location.dealer?.code ?? null,
    modelCode: input.modelCode ?? null,
    colourCode: colourCode ?? null,
    intent: input.intent ?? 'undecided',
    src: attribution.src ?? null,
    utm: (attribution.utm ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    gclid: attribution.gclid ?? null,
    fbclid: attribution.fbclid ?? null,
    sourceRaw: (attribution.sourceRaw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  };

  const existing = context.existingLeadId
    ? await prisma.lead.findUnique({ where: { id: context.existingLeadId } })
    : null;

  let leadId: string;
  let created: boolean;

  if (existing) {
    // Patch the same row. Re-saving the same number leaves phoneVerified as it
    // was. A DIFFERENT number starts unverified: the proof was for the old
    // one, and carrying it over would let anyone verify their own phone, swap
    // in someone else's, and book against it with no OTP.
    const numberChanged = existing.phoneHash !== phone.phoneHash;
    await prisma.lead.update({
      where: { id: existing.id },
      data: numberChanged ? { ...common, phoneVerified: false } : common,
    });
    leadId = existing.id;
    created = false;
  } else {
    const lead = await prisma.lead.create({
      // phoneVerified defaults to false. That is the whole point.
      data: common,
    });
    leadId = lead.id;
    created = true;
  }

  await recordConsent(prisma, leadId, input.consent, context, created);

  return {
    created,
    response: toLeadResponse(leadId, phone.phoneLast4, input.pincode, location),
  };
}

/**
 * What the browser is told about a lead — here after a save, and again when a
 * refreshed page resumes one. Never the phone number, only its last four.
 */
export function toLeadResponse(
  leadId: string,
  phoneLast4: string,
  pincode: string,
  location: PincodeResolution,
): LeadCreatedResponse {
  return {
    leadId,
    phoneLast4,
    pincode,
    region: location.regionCode
      ? { code: location.regionCode, name: location.regionName ?? location.regionCode }
      : null,
    dealer: location.dealer
      ? {
          code: location.dealer.code,
          name: location.dealer.name,
          phone: location.dealer.phone,
          homeServiceable: location.dealer.homeServiceable,
        }
      : null,
    serviceable: location.serviceable,
  };
}

/**
 * Consent rows are an append-only history of consent events, not a current
 * value. On a first save both purposes are recorded; on a re-save only a
 * changed answer is appended, so re-submitting the form does not manufacture
 * consent events that never happened.
 *
 * Purpose, notice version, timestamp and IP are recorded for each, which is
 * what makes the unverified-lead list defensible rather than a liability.
 */
async function recordConsent(
  prisma: PrismaClient,
  leadId: string,
  consent: LeadIdentityInput['consent'],
  context: SaveLeadContext,
  isNewLead: boolean,
): Promise<void> {
  const wanted = [
    { purpose: TRANSACTIONAL, granted: consent.transactional },
    { purpose: MARKETING, granted: consent.marketing },
  ];

  const rows: Prisma.ConsentCreateManyInput[] = [];

  for (const { purpose, granted } of wanted) {
    if (!isNewLead) {
      const latest = await prisma.consent.findFirst({
        where: { leadId, purpose },
        orderBy: { grantedAt: 'desc' },
      });
      if (latest && latest.granted === granted) continue;
    }

    rows.push({
      leadId,
      purpose,
      granted,
      noticeVersion: env.consentNoticeVersion,
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  if (rows.length > 0) {
    await prisma.consent.createMany({ data: rows });
  }
}
