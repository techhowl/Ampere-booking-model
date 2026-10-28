/**
 * Typed access to the environment.
 *
 * Read lazily, never at import time. A Docker or CI build runs `next build`
 * without production secrets present; validating on import would fail the build
 * for variables the build itself never touches.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

/** A base64-encoded 32-byte key. Generated with `openssl rand -base64 32`. */
function requiredKey(name: string): Buffer {
  const key = Buffer.from(required(name), 'base64');
  if (key.length !== 32) {
    throw new Error(
      `${name} must be 32 bytes, base64-encoded (got ${key.length}). ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

export const env = {
  /** Encrypts the phone number at rest. */
  get phoneEncryptionKey(): Buffer {
    return requiredKey('PHONE_ENCRYPTION_KEY');
  },

  /**
   * Builds the searchable phone_hash. MUST be a different value from the
   * encryption key — sharing one key between encryption and the lookup index
   * means compromising either compromises both.
   */
  get phoneHmacSecret(): Buffer {
    return requiredKey('PHONE_HMAC_SECRET');
  },

  /** Signs the continuity cookie. */
  get sessionSecret(): Buffer {
    return requiredKey('SESSION_SECRET');
  },

  /**
   * Keys the stored OTP hash. A six-digit code has only a million values, so an
   * unkeyed hash of one is reversible in seconds with a stolen database dump.
   */
  get otpHashSecret(): Buffer {
    return requiredKey('OTP_HASH_SECRET');
  },

  /** Notice version stamped on every consent record. */
  get consentNoticeVersion(): string {
    return process.env.CONSENT_NOTICE_VERSION ?? 'v1';
  },

  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },

  /**
   * Which deployment this is: 'development' | 'uat' | 'production'.
   *
   * Distinct from NODE_ENV, which is 'production' on UAT too — UAT runs the
   * same built image, and that is the point of it.
   *
   * Defaults to 'production' when unset, so a forgotten variable fails closed.
   */
  get appEnv(): 'development' | 'uat' | 'production' {
    const value = process.env.APP_ENV;
    if (value === 'development' || value === 'uat') return value;
    return 'production';
  },

  /**
   * Show the OTP to the person requesting it, instead of only sending it.
   *
   * Nobody can test this journey without the code, and until an SMS provider
   * and a DLT template exist, no real handset receives one. The alternative is
   * a tester reading it out of the server console, which rules out everyone
   * who should actually be doing UAT.
   *
   * TWO locks, because one flag protecting a one-time password is not enough:
   * APP_ENV must not be production, AND the echo must be asked for explicitly.
   * Either alone does nothing.
   */
  get otpEchoEnabled(): boolean {
    if (this.appEnv === 'production') return false;
    return process.env.OTP_ECHO_ENABLED === 'true';
  },

  /**
   * How long a journey survives without activity. Within it a refresh resumes
   * where the customer was; after it they verify their number again. Not the
   * cookie's lifetime — that stays seven days, for lead continuity.
   */
  get sessionIdleSeconds(): number {
    const minutes = Number(process.env.SESSION_IDLE_MINUTES ?? 60);
    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 3600;
  },

  /**
   * Buy Now — price, payment option, Juspay. Off for launch, which is test
   * rides only; every part of it is kept and comes back with
   * BUY_NOW_ENABLED=true. Off means hidden on the page AND refused by the
   * order route, so it cannot be reached by calling the API directly.
   */
  get buyNowEnabled(): boolean {
    return process.env.BUY_NOW_ENABLED === 'true';
  },

  /** Turnstile is inert until keys arrive; see the OTP route. */
  get turnstileSecret(): string | null {
    return process.env.TURNSTILE_SECRET || null;
  },
} as const;
