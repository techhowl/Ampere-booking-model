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
] as const;

export function register(): void {
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

  console.info(
    `[startup] APP_ENV=${appEnv} juspay=${juspayLive ? 'REAL' : 'fake'} otpEcho=${otpEcho ? 'ON' : 'off'} buyNow=${buyNow ? 'ON' : 'off'}`,
  );

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
