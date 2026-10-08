import { z } from 'zod';
import { isValidPhone, isValidPincode } from '@/lib/phone-format';
import { MODEL_CODES } from '@/lib/catalog/catalog';

/**
 * One definition, used by the form in the browser and by the route on the
 * server. Never validated twice, never allowed to disagree.
 *
 * Nothing about money appears here. The client sends selections; amounts are
 * resolved server-side from price_book.
 */

export const LEAD_INTENTS = ['undecided', 'testride', 'buy'] as const;

/**
 * Consent, captured at step one under the phone field. Two purposes, recorded
 * independently, because storing an unverified number is fine but contacting
 * that person later is what needs consent.
 */
export const consentSchema = z.object({
  /** Required to proceed — we cannot service an enquiry we may not reply to. */
  transactional: z.literal(true, {
    message: 'We need your permission to contact you about this enquiry',
  }),
  /** Genuinely optional. A pre-ticked box here is not consent. */
  marketing: z.boolean(),
});

/**
 * Attribution. Passed through from the page, which parsed it server-side from
 * the query string. Not security-sensitive — it decides which report a lead
 * lands in, not what anything costs.
 */
export const attributionSchema = z.object({
  src: z.string().max(64).nullable().optional(),
  utm: z.record(z.string(), z.string()).nullable().optional(),
  gclid: z.string().max(255).nullable().optional(),
  fbclid: z.string().max(255).nullable().optional(),
  /** The full original query string, whatever we managed to parse from it. */
  sourceRaw: z.record(z.string(), z.string()).nullable().optional(),
});

/**
 * Step one. The moment all three of these are present and valid, the lead is
 * written — before the OTP is sent, not after it is verified.
 */
export const leadIdentitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Please enter your name')
    .max(80, 'That name is too long'),

  phone: z
    .string()
    .trim()
    .refine(isValidPhone, 'Enter a valid 10-digit mobile number'),

  pincode: z
    .string()
    .trim()
    .refine(isValidPincode, 'Enter a valid 6-digit pincode'),

  consent: consentSchema,

  // Preselection from the product page the customer arrived from. Optional:
  // /buy with no parameters must render a complete, working page.
  modelCode: z.enum(MODEL_CODES as [string, ...string[]]).nullable().optional(),
  colourCode: z.string().max(64).nullable().optional(),
  intent: z.enum(LEAD_INTENTS).optional(),

  attribution: attributionSchema.optional(),
});

export type LeadIdentityInput = z.infer<typeof leadIdentitySchema>;
export type ConsentInput = z.infer<typeof consentSchema>;
export type AttributionInput = z.infer<typeof attributionSchema>;

/** What POST /api/leads returns. Never the phone number, in any form. */
export interface LeadCreatedResponse {
  leadId: string;
  phoneLast4: string;
  /** Echoed back so later steps can ask for prices and stock without re-asking. */
  pincode: string;
  region: { code: string; name: string } | null;
  dealer: {
    code: string;
    name: string;
    phone: string | null;
    homeServiceable: boolean;
  } | null;
  /** False when we have no dealer covering this pincode. */
  serviceable: boolean;
}
