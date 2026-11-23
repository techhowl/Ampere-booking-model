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

  /**
   * Whether the journey past step one waits for an OTP. On unless set to
   * exactly "false".
   *
   * Off while Ampere's SMS sender is still in DLT registration and no code can
   * reach a real handset (Greaves, 2026-11: "we will disable OTP verification
   * for the Zoho Pilot Dealers. Those leads will be marked as unqualified and
   * will then need to be qualified by Call centre"). Off means: the lead is
   * still saved with phone_verified = false, the customer carries straight on
   * to the scooter, and the lead goes to the CRM unverified. Buy Now still
   * needs a verified number, whatever this says: see create-order.ts.
   */
  get otpRequired(): boolean {
    return process.env.OTP_REQUIRED !== 'false';
  },

  /**
   * The Zoho pilot: Greaves CRM account ids of the only dealers the page may
   * offer, comma separated. Unset or empty means every active dealer.
   *
   * Ids, not names or our dealer codes, because they are what the CRM's dealer
   * master and `pnpm crm sync-dealers` key on. They differ between sandbox and
   * production, so they live in each deployment's environment, never in code.
   */
  get pilotDealerCrmIds(): string[] | null {
    return parsePilotDealerIds(process.env.PILOT_DEALER_CRM_IDS);
  },

  /**
   * Where a customer goes when no dealer we offer is near their pincode: the
   * Goal App test ride form, which serves every dealer outside the pilot.
   * Unset means no hand-off; the dealer step's "no dealership" state instead.
   */
  get goalAppUrl(): string | null {
    return parseGoalAppUrl(process.env.GOAL_APP_URL);
  },
} as const;

/** Throws on anything that is not a list of CRM ids, so a typo stops the app at startup. */
export function parsePilotDealerIds(value: string | undefined): string[] | null {
  const ids = (value ?? '')
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) return null;
  const bad = ids.filter((id) => !/^\d{10,30}$/.test(id));
  if (bad.length > 0) {
    throw new Error(`PILOT_DEALER_CRM_IDS must be CRM account ids (digits), comma separated. Not: ${bad.join(', ')}`);
  }
  return [...new Set(ids)];
}

export function parseGoalAppUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('GOAL_APP_URL is not a URL');
  }
  if (url.protocol !== 'https:') throw new Error('GOAL_APP_URL must be https');
  return url.toString();
}
