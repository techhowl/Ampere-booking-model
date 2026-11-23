/**
 * Runs once, when the server starts. Next calls `register()` automatically.
 *
 * This exists because of one specific, expensive failure mode.
 *
 * `.env` for local development is read by dotenv, which strips surrounding
 * quotes: FOO="bar" arrives as `bar`. Docker's --env-file and compose's
 * env_file do NOT strip them: the same line arrives as `"bar"`, quotes and
 * all. The file looks identical and the behaviour is not.
 *
 * What that costs here:
 *
 *   JUSPAY_ENABLED="true"   ->  '"true"' !== 'true'  ->  the real payment
 *                               client never loads and the site quietly takes
 *                               no money, with no error anywhere
 *   TURNSTILE_SECRET=""     ->  '""' is truthy       ->  bot defence turns ON
 *                               with a junk secret and every OTP fails
 *   PHONE_ENCRYPTION_KEY="" ->  wrong key length     ->  at least this one
 *                               throws
 *
 * The first two fail silently, which is the only reason this file is worth
 * having. A deployment that is misconfigured should refuse to start, not serve
 * a checkout that cannot charge anyone.
 */

/** Values that arrived still wearing their quotes. */
function quoted(value: string | undefined): boolean {
  if (!value || value.length < 2) return false;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'");
}

/**
 * Everything this app reads from the environment. Listed explicitly rather
 * than scanning process.env, which on a container is full of unrelated
 * variables we have no business validating.
 */
const KNOWN_VARS = [
  'DATABASE_URL',
  'APP_ENV',
  'PHONE_ENCRYPTION_KEY',
  'PHONE_HMAC_SECRET',
  'SESSION_SECRET',
  'OTP_HASH_SECRET',
  'CONSENT_NOTICE_VERSION',
  'TURNSTILE_SECRET',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'ADMIN_PASSWORD_HASH',
  'CRON_SECRET',
  'OTP_ECHO_ENABLED',
  'JUSPAY_ENABLED',
  'BUY_NOW_ENABLED',
  'JUSPAY_MERCHANT_ID',
  'JUSPAY_API_KEY',
  'JUSPAY_PAYMENT_PAGE_CLIENT_ID',
  'JUSPAY_WEBHOOK_USERNAME',
  'JUSPAY_WEBHOOK_PASSWORD',
  'JUSPAY_WEBHOOK_URL',
  'JUSPAY_BASE_URL',
  'JUSPAY_RECEIPT_DOMAIN',
  'CRM_PROVIDER',
  'ZOHO_ACCOUNTS_URL',
  'ZOHO_API_URL',
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
  'ZOHO_LEAD_FUNCTION',
  'ZOHO_TEST_RIDE_FUNCTION',
  'ZOHO_DEALERS_FUNCTION',
  'ZOHO_PRODUCTS_FUNCTION',
  'ZOHO_TIMEOUT_MS',
  'OTP_REQUIRED',
  'PILOT_DEALER_CRM_IDS',
  'GOAL_APP_URL',
  'ADMIN_ALLOWED_IPS',
] as const;

export async function register(): Promise<void> {
  const offenders = KNOWN_VARS.filter((name) => quoted(process.env[name]));

  if (offenders.length > 0) {
    throw new Error(
      `Environment variables arrived with literal quote characters: ${offenders.join(', ')}.\n` +
        'Docker --env-file and compose env_file do not strip quotes, unlike dotenv.\n' +
        'Write deploy/.env.production WITHOUT quotes:  KEY=value  not  KEY="value".\n' +
        'Refusing to start: JUSPAY_ENABLED and TURNSTILE_SECRET both fail silently when quoted.',
    );
  }

  const appEnv = process.env.APP_ENV ?? 'production (defaulted)';
  const juspayLive = process.env.JUSPAY_ENABLED === 'true';
  const otpEcho = process.env.OTP_ECHO_ENABLED === 'true';
  const buyNow = process.env.BUY_NOW_ENABLED === 'true';

  /*
   * The CRM rules, checked now rather than on the first lead: a missing
   * credential, or production pointed at the sandbox (or UAT at the live
   * CRM), refuses to start. See lib/crm/config.ts.
   */
  const { crmSettings } = await import('./lib/crm/config');
  const crm = crmSettings();
  const crmLabel = crm.provider === 'zoho' ? (crm.sandbox ? 'zoho-SANDBOX' : 'zoho-LIVE') : 'fake';

  // A typo in either stops the app here, not on a customer's first request.
  const { parseGoalAppUrl, parsePilotDealerIds } = await import('./lib/env');
  const pilot = parsePilotDealerIds(process.env.PILOT_DEALER_CRM_IDS);
  const goalApp = parseGoalAppUrl(process.env.GOAL_APP_URL);
  const otpRequired = process.env.OTP_REQUIRED !== 'false';

  // The hand-off must lead away from this site, or a customer outside the
  // pilot is sent round in a circle.
  const siteHost = process.env.SITE_HOST?.trim().toLowerCase();
  if (goalApp && siteHost && new URL(goalApp).hostname.toLowerCase() === siteHost) {
    throw new Error(`GOAL_APP_URL points at this site (${siteHost}). It must be the Goal App's own address.`);
  }

  console.info(
    `[startup] APP_ENV=${appEnv} juspay=${juspayLive ? 'REAL' : 'fake'} otpEcho=${otpEcho ? 'ON' : 'off'} buyNow=${buyNow ? 'ON' : 'off'} crm=${crmLabel} ` +
      `otp=${otpRequired ? 'required' : 'OFF'} dealers=${pilot ? `pilot(${pilot.length})` : 'all'} goalApp=${goalApp ? 'set' : 'off'}`,
  );

  if (!otpRequired) {
    console.warn(
      '[startup] OTP is OFF (OTP_REQUIRED=false): numbers are not verified, and unverified leads go to the CRM. ' +
        'Switch it back on once the SMS sender clears DLT.',
    );
  }

  /*
   * Payment is never taken against a number nobody proved. create-order.ts
   * refuses an unverified lead regardless, so this pairing would put a Buy
   * button on the page that can only fail.
   */
  if (buyNow && !otpRequired) {
    throw new Error('BUY_NOW_ENABLED=true needs the OTP. Unset OTP_REQUIRED, or turn Buy Now off.');
  }

  /*
   * A live deployment (a production build with APP_ENV production or unset)
   * never runs the stand-in checkout: lib/juspay/client.ts gives it a client
   * that takes no payment instead. Buy Now there without the real client is a
   * Buy button that can only fail, and before that safeguard it confirmed
   * payments nobody made (security audit V-01). Stop here, where whoever is
   * deploying sees it.
   */
  const live =
    process.env.NODE_ENV === 'production' &&
    process.env.APP_ENV !== 'development' &&
    process.env.APP_ENV !== 'uat';
  if (live && buyNow && !juspayLive) {
    throw new Error(
      'BUY_NOW_ENABLED=true in production needs the real Juspay client. ' +
        'Set JUSPAY_ENABLED=true with the JUSPAY_* credentials, or turn Buy Now off.',
    );
  }

  if (crm.provider === 'fake' && (process.env.APP_ENV ?? 'production') === 'production') {
    console.warn(
      '[startup] WARNING: production is running without Greaves CRM.Next. Leads and test rides ' +
        'are saved and HELD in crm_jobs; they are delivered once CRM_PROVIDER=zoho.',
    );
  }

  /*
   * Belt and braces on the OTP echo. env.otpEchoEnabled already refuses in
   * production, but a deployment that asked for it there has a configuration
   * problem worth stopping for rather than silently ignoring.
   */
  if (otpEcho && (process.env.APP_ENV ?? 'production') === 'production') {
    throw new Error(
      'OTP_ECHO_ENABLED is set while APP_ENV is production. ' +
        'That would print live one-time codes to anyone who asked for one. ' +
        'Set APP_ENV=uat, or unset OTP_ECHO_ENABLED.',
    );
  }
}
