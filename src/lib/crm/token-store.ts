import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ZohoConfig } from './config';
import { requestAccessToken, ZohoTokenError, type TokenProvider } from './zoho';

/**
 * The Zoho access token, cached in Postgres and shared by every instance.
 *
 * Greaves: a token lives an hour; reuse it for about 55 minutes; minting is
 * rate-limited, so never one per lead. An in-memory cache alone would mint a
 * token per serverless cold start, so the row in crm_tokens is the cache and
 * memory only saves the read.
 *
 * Renewal holds a Postgres advisory lock. Ten requests arriving with an
 * expired token make ONE call to Zoho; the other nine wait on the lock and
 * then read the row the first one wrote.
 *
 * The token is encrypted at rest with a key derived from the client secret. A
 * database dump alone therefore yields nothing usable, and no extra key has to
 * be managed — the secret already lives only in the environment.
 */

/** Greaves' "about 55 minutes": renew this long before Zoho's expiry. */
const RENEW_BEFORE_EXPIRY_MS = 5 * 60_000;
/** Covers the token request's own 15-second timeout, with room to spare. */
const RENEWAL_TRANSACTION_MS = 30_000;
/**
 * After Zoho refuses a token, say so for this long without asking again.
 * Every due job would otherwise ask once each, and keep its rate limit tripped.
 */
const FAILURE_MEMORY_MS = 60_000;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class PrismaTokenProvider implements TokenProvider {
  private memory: { token: string; expiresAt: number } | null = null;
  private renewing: Promise<string> | null = null;
  private failure: { error: ZohoTokenError; until: number } | null = null;
  private readonly key: string;
  private readonly cipherKey: Buffer;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: ZohoConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.key = `zoho:${new URL(config.apiUrl).host}:${config.clientId}`;
    this.cipherKey = Buffer.from(
      hkdfSync('sha256', config.clientSecret, 'ampere-buy/crm-token', this.key, 32),
    );
  }

  async get(): Promise<string> {
    if (this.memory && this.usable(this.memory.expiresAt)) return this.memory.token;

    const row = await this.prisma.crmToken.findUnique({ where: { key: this.key } });
    if (row && this.usable(row.expiresAt.getTime())) {
      const token = this.decrypt(row.tokenEnc);
      if (token) {
        this.memory = { token, expiresAt: row.expiresAt.getTime() };
        return token;
      }
    }
    return this.renew(null);
  }

  async refresh(rejected: string): Promise<string> {
    this.memory = null;
    return this.renew(rejected);
  }

  /**
   * One renewal per process at a time. Concurrent callers share it, rather
   * than each holding a pooled database connection while they queue on the
   * advisory lock — enough of those and ordinary requests find no connection.
   */
  private async renew(rejected: string | null): Promise<string> {
    if (this.failure && this.failure.until > this.now()) throw this.failure.error;

    const inFlight = this.renewing;
    if (inFlight) {
      const token = await inFlight.catch(() => null);
      if (token && token !== rejected) return token;
      if (this.failure && this.failure.until > this.now()) throw this.failure.error;
    }

    const attempt = this.renewUnderLock(rejected);
    this.renewing = attempt;
    try {
      const token = await attempt;
      this.failure = null;
      return token;
    } catch (error) {
      if (error instanceof ZohoTokenError) this.failure = { error, until: this.now() + FAILURE_MEMORY_MS };
      throw error;
    } finally {
      if (this.renewing === attempt) this.renewing = null;
    }
  }

  private async renewUnderLock(rejected: string | null): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${this.key}))::text AS locked`;

        // Whoever held the lock before us may already have renewed it.
        const row = await tx.crmToken.findUnique({ where: { key: this.key } });
        if (row && this.usable(row.expiresAt.getTime())) {
          const token = this.decrypt(row.tokenEnc);
          if (token && token !== rejected) {
            this.memory = { token, expiresAt: row.expiresAt.getTime() };
            return token;
          }
        }

        const { accessToken, expiresInSeconds } = await requestAccessToken(this.config, this.fetchFn);
        const expiresAt = new Date(this.now() + expiresInSeconds * 1000);
        const tokenEnc = this.encrypt(accessToken);
        await tx.crmToken.upsert({
          where: { key: this.key },
          create: { key: this.key, tokenEnc, expiresAt },
          update: { tokenEnc, expiresAt },
        });
        this.memory = { token: accessToken, expiresAt: expiresAt.getTime() };
        return accessToken;
      },
      { maxWait: RENEWAL_TRANSACTION_MS, timeout: RENEWAL_TRANSACTION_MS },
    );
  }

  private usable(expiresAt: number): boolean {
    return expiresAt - RENEW_BEFORE_EXPIRY_MS > this.now();
  }

  private encrypt(token: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.cipherKey, iv);
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
  }

  /** Null when the row cannot be read — say, after the client secret changed. Then we mint anew. */
  private decrypt(stored: Uint8Array): string | null {
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.cipherKey, stored.subarray(0, IV_BYTES));
      decipher.setAuthTag(stored.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(stored.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }
}
