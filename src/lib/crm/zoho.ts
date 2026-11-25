import { isSandboxHost, type ZohoConfig } from './config';
import { DealerListError, parseDealerList, type DealerList } from './dealers';
import { parseProductList, ProductListError, type CrmProduct } from './products';
import type { CallOptions, CrmClient, CrmRecord, CrmResult } from './types';

/**
 * Greaves CRM.Next, which is Zoho CRM on the India data centre.
 *
 * Three things about this API that the PDF does not make obvious, all seen
 * against the sandbox on 2026-11-02:
 *
 *   1. HTTP 200 does not mean success. Every business answer — created,
 *      duplicate, failed — is a 200 with the real result as a JSON *string*
 *      in details.output. Only auth and transport problems use status codes.
 *   2. Ids are 19 digits, past what a JavaScript number holds exactly. They
 *      are read out of the raw text, never through a parsed number.
 *   3. Nothing is idempotent. The same test ride sent twice is two test
 *      rides, so a send that timed out is looked up before it is repeated
 *      (see jobs.ts).
 */

export interface TokenProvider {
  /** A token believed valid, shared across every instance of the app. */
  get(): Promise<string>;
  /** The CRM refused `rejected`. Return a different, freshly minted one. */
  refresh(rejected: string): Promise<string>;
}

/** Why a token could not be had. The code is Zoho's own, never a secret. */
export class ZohoTokenError extends Error {
  constructor(readonly code: string) {
    super(`Zoho token request failed: ${code}`);
    this.name = 'ZohoTokenError';
  }
}

const TOKEN_TIMEOUT_MS = 15_000;

/**
 * Trade the refresh token for an access token.
 *
 * Credentials go in the form body, not the query string as in Greaves'
 * Postman collection, so the client secret never lands in a URL — and URLs
 * are what proxies and load balancers write to their logs.
 */
export async function requestAccessToken(
  config: ZohoConfig,
  fetchFn: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  let response: Response;
  let body: string;
  try {
    response = await fetchFn(`${config.accountsUrl}/oauth/v2/token`, {
      method: 'POST',
      body: new URLSearchParams({
        refresh_token: config.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    body = await response.text();
  } catch (error) {
    throw new ZohoTokenError(isTimeout(error) ? 'timeout' : 'unreachable');
  }

  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    // Falls through to the error below.
  }

  const token = json.access_token;
  if (response.ok && typeof token === 'string' && token.length > 0) {
    const expires = Number(json.expires_in);
    return { accessToken: token, expiresInSeconds: Number.isFinite(expires) && expires > 0 ? expires : 3600 };
  }

  // A bad refresh token is a 200 with {"error":"invalid_code"}; too many token
  // requests is a 400 "Access Denied". Neither carries anything secret.
  throw new ZohoTokenError(typeof json.error === 'string' ? json.error : `http_${response.status}`);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/** "lead_id":"1456…" or "lead_id":1456… — the digits, as text, either way. */
function idFrom(output: string, key: string): string | null {
  const match = output.match(new RegExp(`"${key}"\\s*:\\s*"?(\\d+)"?`));
  return match?.[1] ?? null;
}

type FunctionResult = { status?: unknown; category?: unknown; message?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** "success" or "failure", in any case. */
function outcomeOf(value: unknown): 'success' | 'failure' | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text === 'success' || text === 'failure' ? text : null;
}

/**
 * The function's own answer, wherever this deployment put it. Searched
 * breadth-first, a few levels down, for the first object whose `status` is
 * success or failure: the whole body (live Create Lead, which answers in plain
 * JSON), `details.output` when Zoho hands it over as an object rather than a
 * string, or a `data`/`response`/`body` wrapper.
 */
function findResult(root: unknown): FunctionResult | null {
  let level: unknown[] = [root];
  for (let depth = 0; depth < 4 && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (Array.isArray(node)) {
        next.push(...node.slice(0, 5));
        continue;
      }
      if (!isRecord(node)) continue;
      if (outcomeOf(node.status)) return node as FunctionResult;
      next.push(...Object.values(node));
    }
    level = next;
  }
  return null;
}

/**
 * The top-level keys of an answer we could not read — never its values, which
 * may hold customer details — so the log says what shape arrived.
 */
function shapeOf(parsed: unknown): string {
  if (Array.isArray(parsed)) return 'array';
  if (!isRecord(parsed)) return typeof parsed;
  const keys = Object.keys(parsed)
    .slice(0, 8)
    .map((key) => key.replace(/[^A-Za-z0-9_]/g, '').slice(0, 30));
  return `keys:${keys.join(',') || 'none'}`;
}

/** The answer, read from `text` so 19-digit ids keep every digit. */
function resultFrom(result: FunctionResult, text: string): CrmResult {
  if (outcomeOf(result.status) === 'success') {
    return {
      kind: 'accepted',
      message: String(result.message ?? ''),
      leadId: idFrom(text, 'lead_id'),
      testRideId: idFrom(text, 'test_ride_id'),
    };
  }
  return {
    kind: 'rejected',
    category: String(result.category ?? ''),
    message: String(result.message ?? ''),
    // Create Lead's "Duplicate Lead" names the existing lead this way.
    leadId: idFrom(text, 'Existing_lead_id') ?? idFrom(text, 'lead_id'),
  };
}

/**
 * Read a function call's HTTP response. Exported for the tests, which feed it
 * responses recorded from the sandbox and the shapes seen on live.
 *
 * Two shapes are business answers:
 *   - Zoho's wrapper, `{"code":"success","details":{"output":"<JSON text>"}}`.
 *     The sandbox, and live Create Test Ride, answer this way.
 *   - The function's own JSON as the whole body, `{"status":"success",
 *     "lead_id":…}`. Live Create Lead has answered this way since go-live
 *     (2026-11-23). Read as an unknown answer, every lead was sent again on
 *     each retry, and each send was another lead in the CRM.
 */
export function parseFunctionResponse(status: number, body: string): CrmResult {
  if (status === 401) return { kind: 'unreachable', reason: 'unauthorised', ambiguous: false };
  if (status === 429) return { kind: 'unreachable', reason: 'rate_limited', ambiguous: false };
  // A 5xx may come after the function has already written the record.
  if (status >= 500) return { kind: 'unreachable', reason: `http_${status}`, ambiguous: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    if (status !== 200) return { kind: 'unreachable', reason: `http_${status}`, ambiguous: false };
    return { kind: 'unreachable', reason: 'unreadable_response', ambiguous: true };
  }

  const envelope = isRecord(parsed) ? parsed : null;
  const details = isRecord(envelope?.details) ? envelope.details : null;
  const output = details?.output;
  const wrapped = typeof envelope?.code === 'string' && envelope.code.toLowerCase() === 'success';

  // Zoho's wrapper with the answer as text: parse the text, read ids off it.
  if (status === 200 && wrapped && typeof output === 'string') {
    let result: unknown;
    try {
      result = JSON.parse(output);
    } catch {
      return { kind: 'unreachable', reason: 'unreadable_output', ambiguous: true };
    }
    if (isRecord(result) && outcomeOf(result.status)) return resultFrom(result, output);
    return { kind: 'unreachable', reason: 'unexpected_output', ambiguous: true };
  }

  // Anything else: find the function's own answer in the JSON. A function that
  // sets its own status code (a 400 for a duplicate, say) is read the same way.
  const result = findResult(parsed);
  if (result) return resultFrom(result, body);

  if (status !== 200) return { kind: 'unreachable', reason: `http_${status}`, ambiguous: false };
  // The function did not complete normally, or answered in a shape we do not
  // know; it may have written something before it stopped.
  const code = typeof envelope?.code === 'string' ? envelope.code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) : 'unknown';
  return { kind: 'unreachable', reason: `zoho_${code || 'unknown'} (${shapeOf(parsed)})`, ambiguous: true };
}

/**
 * The rows of a Zoho read (records API or COQL). Zoho's v7 read APIs give ids
 * as quoted strings, so parsing is safe here — unlike a function's output,
 * which is Greaves' own code. A row whose id is not a digit string is dropped
 * rather than trusted; null means the body was not a record list at all.
 */
export function recordsOf(body: string): ({ id: string } & Record<string, unknown>)[] | null {
  let parsed: { data?: unknown };
  try {
    parsed = JSON.parse(body) as { data?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(parsed?.data)) return null;
  return parsed.data.filter(
    (row): row is { id: string } & Record<string, unknown> =>
      typeof row === 'object' && row !== null && typeof (row as { id?: unknown }).id === 'string' &&
      /^\d+$/.test((row as { id: string }).id),
  );
}

/** 2026-11-04T13:00:00+05:30 — how the CRM writes Test_Ride_Date_Time. */
export function istTimestamp(at: Date): string {
  const shifted = new Date(at.getTime() + 330 * 60_000);
  return `${shifted.toISOString().slice(0, 19)}+05:30`;
}

type Exchange =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'network'; reason: string }
  | { kind: 'token'; code: string };

export class ZohoCrmClient implements CrmClient {
  readonly name: string;

  constructor(
    private readonly config: ZohoConfig,
    private readonly tokens: TokenProvider,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.name = isSandboxHost(config.apiUrl) ? 'zoho-sandbox' : 'zoho-production';
  }

  createLead(record: CrmRecord, options: CallOptions = {}): Promise<CrmResult> {
    return this.execute(this.config.leadFunction, record, options);
  }

  createTestRide(record: CrmRecord, options: CallOptions = {}): Promise<CrmResult> {
    return this.execute(this.config.testRideFunction, record, options);
  }

  async findTestRides(crmLeadId: string, startsAt: Date, options: CallOptions = {}): Promise<string[] | null> {
    // Both values go into a query string, so both are checked to be exactly
    // what they claim — digits, and our own timestamp format.
    if (!/^\d{1,30}$/.test(crmLeadId)) return null;

    // Greaves moved the ride's time to Scheduled_Date_Time on 2026-11-05; rides
    // made before then hold it in Test_Ride_Date_Time. An org without one of
    // them answers 400 INVALID_QUERY, so production can have either or both.
    const at = istTimestamp(startsAt);
    const conditions = [
      `(Scheduled_Date_Time = '${at}' or Test_Ride_Date_Time = '${at}')`,
      `Scheduled_Date_Time = '${at}'`,
      `Test_Ride_Date_Time = '${at}'`,
    ];

    for (const condition of conditions) {
      const exchange = await this.authorised(
        `${this.config.apiUrl}/crm/v7/coql`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            select_query: `select id from Test_Rides where (Lead = ${crmLeadId} and ${condition}) limit 10`,
          }),
        },
        options,
      );
      if (exchange.kind !== 'response') return null;
      if (exchange.status === 204) return []; // Zoho's "no rows"
      if (exchange.status === 200) {
        const rows = recordsOf(exchange.body);
        return rows ? rows.map((row) => row.id) : null;
      }
      if (exchange.status !== 400 || !exchange.body.includes('INVALID_QUERY')) return null;
    }
    return null;
  }

  /** The CRM's vehicle models, for `pnpm crm sync-models`. */
  async listVehicleModels(): Promise<{ id: string; name: string }[]> {
    const exchange = await this.authorised(
      `${this.config.apiUrl}/crm/v7/Vehicle_Models?fields=Name&per_page=200`,
      { method: 'GET' },
    );
    if (exchange.kind === 'token') throw new ZohoTokenError(exchange.code);
    if (exchange.kind === 'network') throw new Error(`Vehicle_Models: ${exchange.reason}`);
    if (exchange.status === 204) return [];
    if (exchange.status !== 200) throw new Error(`Vehicle_Models: HTTP ${exchange.status}`);
    const rows = recordsOf(exchange.body);
    if (!rows) throw new Error('Vehicle_Models: unreadable response');
    return rows.map((row) => ({ id: row.id, name: typeof row.Name === 'string' ? row.Name : '' }));
  }

  /**
   * Greaves' dealer master, for `pnpm crm sync-dealers`. A read: the function
   * is called with GET and no arguments.
   */
  async listDealers(): Promise<DealerList> {
    const exchange = await this.authorised(
      `${this.config.apiUrl}/crm/v7/functions/${encodeURIComponent(this.config.dealersFunction)}/actions/execute?auth_type=oauth`,
      { method: 'GET' },
    );
    if (exchange.kind === 'token') throw new ZohoTokenError(exchange.code);
    if (exchange.kind === 'network') throw new DealerListError(`get_dealers: ${exchange.reason}`);
    return parseDealerList(exchange.status, exchange.body);
  }

  /**
   * Greaves' product list, for `pnpm crm sync-models`. A read, like
   * get_dealers: GET, no arguments. Arrived with the live collection.
   */
  async listProducts(): Promise<CrmProduct[]> {
    const exchange = await this.authorised(
      `${this.config.apiUrl}/crm/v7/functions/${encodeURIComponent(this.config.productsFunction)}/actions/execute?auth_type=oauth`,
      { method: 'GET' },
    );
    if (exchange.kind === 'token') throw new ZohoTokenError(exchange.code);
    if (exchange.kind === 'network') throw new ProductListError(`get_products: ${exchange.reason}`);
    return parseProductList(exchange.status, exchange.body);
  }

  private async execute(functionName: string, record: CrmRecord, options: CallOptions): Promise<CrmResult> {
    const exchange = await this.authorised(
      `${this.config.apiUrl}/crm/v7/functions/${encodeURIComponent(functionName)}/actions/execute?auth_type=oauth`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [record] }),
      },
      options,
    );
    // No token means the request never left: nothing can have landed.
    if (exchange.kind === 'token') return { kind: 'unreachable', reason: `token_${exchange.code}`, ambiguous: false };
    if (exchange.kind === 'network') return { kind: 'unreachable', reason: exchange.reason, ambiguous: true };
    return parseFunctionResponse(exchange.status, exchange.body);
  }

  /**
   * One request with the shared token. A 401 that says INVALID_TOKEN gets
   * exactly one retry with a fresh token. Any other 401 — OAUTH_SCOPE_MISMATCH,
   * say — is returned as it is: a new token would be refused the same way, and
   * minting one per request would run into Zoho's limit on token requests.
   */
  private async authorised(url: string, init: RequestInit, options: CallOptions = {}): Promise<Exchange> {
    let token: string;
    try {
      token = await this.tokens.get();
    } catch (error) {
      return { kind: 'token', code: error instanceof ZohoTokenError ? error.code : 'unavailable' };
    }

    let exchange = await this.send(url, init, token, options);
    if (exchange.kind === 'response' && exchange.status === 401 && exchange.body.includes('INVALID_TOKEN')) {
      try {
        token = await this.tokens.refresh(token);
      } catch (error) {
        return { kind: 'token', code: error instanceof ZohoTokenError ? error.code : 'unavailable' };
      }
      exchange = await this.send(url, init, token, options);
    }
    return exchange;
  }

  private async send(url: string, init: RequestInit, token: string, options: CallOptions): Promise<Exchange> {
    const timeoutMs = Math.min(this.config.timeoutMs, options.timeoutMs ?? Number.POSITIVE_INFINITY);
    try {
      const response = await this.fetchFn(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { kind: 'response', status: response.status, body: await response.text() };
    } catch (error) {
      return { kind: 'network', reason: isTimeout(error) ? 'timeout' : 'network_error' };
    }
  }
}
