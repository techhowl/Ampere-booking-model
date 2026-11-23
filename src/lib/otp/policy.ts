import { env } from '@/lib/env';

/**
 * Whether a lead may go past step one: to the scooter, the dealer, a test ride,
 * and the CRM.
 *
 * With the OTP on, only once its number is verified. With it off
 * (OTP_REQUIRED=false, while DLT registration is pending), as soon as it is
 * saved. phone_verified itself always tells the truth: it is never set without
 * a code, so the export and the CRM can still tell the two apart.
 *
 * Buy Now does NOT use this. Payment always wants a verified number.
 */
export function leadMayProceed(lead: { phoneVerified: boolean }): boolean {
  return lead.phoneVerified || !env.otpRequired;
}
