/**
 * What the customer is told when their journey has timed out. Shared by the
 * routes that refuse a stale session and the page that asks for the OTP
 * again, so the two never say different things. No server imports: the
 * browser bundle reads this too.
 */
export const SESSION_EXPIRED_MESSAGE =
  'For your security, your session timed out. Please verify your number again.';
