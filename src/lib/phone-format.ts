/**
 * Phone formatting with no Node dependencies, so the same rules run in the
 * browser and on the server. Spec: one schema shared client and server, never
 * validation defined twice.
 *
 * Deliberately separate from crypto/phone.ts, which imports node:crypto and
 * must never reach the client bundle.
 */

/** Indian mobile numbers: 10 digits, starting 6-9. */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Accepts what people actually type — "98765 43210", "+91 98765-43210",
 * "09876543210" — and returns E.164, or null if it is not a valid Indian
 * mobile number.
 *
 * Normalising matters more than it looks: phone_hash is the dedupe key, so two
 * spellings of one number would silently become two leads and the call centre
 * would ring the same person twice.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');

  let national = digits;
  if (national.startsWith('91') && national.length === 12) national = national.slice(2);
  else if (national.startsWith('0') && national.length === 11) national = national.slice(1);

  if (!INDIAN_MOBILE.test(national)) return null;
  return `+91${national}`;
}

export function isValidPhone(input: string): boolean {
  return normalisePhone(input) !== null;
}

/** Indian pincodes: 6 digits, never starting with 0. */
const PINCODE = /^[1-9]\d{5}$/;

export function isValidPincode(input: string): boolean {
  return PINCODE.test(input.trim());
}

/** Safe to log. Use this anywhere a number would otherwise be tempting. */
export function maskPhone(e164: string): string {
  return `+91 ••••• ${e164.slice(-5)}`;
}

/** "98765 43210" — how the number is shown back to the customer. */
export function formatPhoneForDisplay(e164: string): string {
  const national = e164.replace(/^\+91/, '');
  return `${national.slice(0, 5)} ${national.slice(5)}`;
}

/**
 * Any stored number, as shown on screen: "+91 80400 00005" for an Indian
 * number, anything else exactly as stored. For dealer and support numbers —
 * never for a customer's own.
 */
export function displayPhone(phone: string): string {
  return phone.startsWith('+91') ? `+91 ${formatPhoneForDisplay(phone)}` : phone;
}
