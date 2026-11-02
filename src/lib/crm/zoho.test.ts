import { describe, expect, it } from 'vitest';
import type { ZohoConfig } from './config';
import {
  parseFunctionResponse,
  recordsOf,
  requestAccessToken,
  ZohoCrmClient,
  ZohoTokenError,
  type TokenProvider,
} from './zoho';

/*
 * Response bodies recorded verbatim from Greaves' sandbox on 2026-11-02.
 * Every business answer is HTTP 200 with the result as a string inside it.
 */
const wrap = (output: string, extra = '') =>
  `{"code":"success","details":{"output":${JSON.stringify(output)}${extra},"output_type":"string","id":"600999000000022016"},"message":"function executed successfully"}`;

const SANDBOX = {
  leadCreated: wrap('{"status":"success","category":"success","message":"Lead created successfully","lead_id":"1456765000001735315"}'),
  duplicate: wrap('{"status":"failure","category":"rule_failure","message":"Duplicate Lead: Lead already exists in the system"}'),
  mandatory: wrap('{"status":"failure","category":"rule_failure","message":"Mandatory fields are missing"}'),
  technical: wrap('{"status":"failure","category":"api_failure","message":"Lead creation failed due to technical reasons"}'),
  rideNew: wrap('{"status":"success","category":"success","message":"New Lead and Test Ride created successfully","lead_id":"1456765000001731340","test_ride_id":"1456765000001736132"}'),
  rideExisting: wrap('{"status":"success","category":"success","message":"Existing Lead updated and Test Ride created successfully","lead_id":"1456765000001736114","test_ride_id":"1456765000001737120"}'),
  rideMapped: wrap('{"status":"success","category":"success","message":"Duplicate Lead already exists. Test Ride created and mapped to the existing active Lead successfully","lead_id":"1456765000001736154","test_ride_id":"1456765000001730167"}'),
  notAvailable: wrap('{"status":"failure","category":"rule_failure","message":"Provided Zoho CRM Lead ID is not available"}'),
  // Greaves' function leaks its debug log on some paths. Extra keys are ignored.
  withDebugLog: wrap(
    '{"status":"failure","category":"api_failure","message":"Lead creation failed due to technical reasons"}',
    ',"userMessage":["Starting nearest dealer search within 15 KM","Ampere Website Test Ride API Error: Error at line : 446"]',
  ),
  invalidToken: '{"code":"INVALID_TOKEN","details":{},"message":"invalid oauth token","status":"error"}',
};

describe('reading a function response', () => {
  it('reads a created lead, id intact', () => {
    expect(parseFunctionResponse(200, SANDBOX.leadCreated)).toEqual({
      kind: 'accepted',
      message: 'Lead created successfully',
      leadId: '1456765000001735315',
      testRideId: null,
    });
  });

  it('reads each test ride success, with both ids', () => {
    for (const [body, leadId, testRideId] of [
      [SANDBOX.rideNew, '1456765000001731340', '1456765000001736132'],
      [SANDBOX.rideExisting, '1456765000001736114', '1456765000001737120'],
      [SANDBOX.rideMapped, '1456765000001736154', '1456765000001730167'],
    ] as const) {
      expect(parseFunctionResponse(200, body)).toMatchObject({ kind: 'accepted', leadId, testRideId });
    }
  });

  it('reads a 200 that says no as a rejection, not a success', () => {
    expect(parseFunctionResponse(200, SANDBOX.duplicate)).toEqual({
      kind: 'rejected',
      category: 'rule_failure',
      message: 'Duplicate Lead: Lead already exists in the system',
    });
    expect(parseFunctionResponse(200, SANDBOX.mandatory)).toMatchObject({ kind: 'rejected', category: 'rule_failure' });
    expect(parseFunctionResponse(200, SANDBOX.technical)).toMatchObject({ kind: 'rejected', category: 'api_failure' });
    expect(parseFunctionResponse(200, SANDBOX.notAvailable)).toMatchObject({ kind: 'rejected' });
    expect(parseFunctionResponse(200, SANDBOX.withDebugLog)).toMatchObject({ kind: 'rejected', category: 'api_failure' });
  });

  it('keeps an id exact even if it ever arrives as a bare number', () => {
    const body = wrap('{"status":"success","message":"Lead created successfully","lead_id":1456765000001735315}');
    expect(parseFunctionResponse(200, body)).toMatchObject({ leadId: '1456765000001735315' });
  });

  it('treats transport answers as "no answer", and says when a retry could duplicate', () => {
    expect(parseFunctionResponse(401, SANDBOX.invalidToken)).toEqual({ kind: 'unreachable', reason: 'unauthorised', ambiguous: false });
    expect(parseFunctionResponse(429, '')).toMatchObject({ kind: 'unreachable', ambiguous: false });
    expect(parseFunctionResponse(502, 'Bad Gateway')).toMatchObject({ kind: 'unreachable', ambiguous: true });
    expect(parseFunctionResponse(400, '{"code":"INVALID_URL_PATTERN"}')).toMatchObject({ kind: 'unreachable', ambiguous: false });
  });

  it('never mistakes something unreadable for success', () => {
    expect(parseFunctionResponse(200, '<html>oops</html>')).toMatchObject({ kind: 'unreachable', ambiguous: true });
    expect(parseFunctionResponse(200, '{"code":"INTERNAL_ERROR","details":{}}')).toMatchObject({ kind: 'unreachable', ambiguous: true });
    expect(parseFunctionResponse(200, wrap('not json'))).toMatchObject({ kind: 'unreachable', ambiguous: true });
    expect(parseFunctionResponse(200, wrap('{"status":"maybe"}'))).toMatchObject({ kind: 'unreachable', ambiguous: true });
  });
});

describe('recordsOf', () => {
  it('reads ids as strings and drops anything that is not one', () => {
    const body = '{"data":[{"id":"1456765000001702028","Name":"Nexus EX+"},{"id":12,"Name":"x"},{"Name":"no id"}],"info":{"count":3}}';
    expect(recordsOf(body)).toEqual([{ id: '1456765000001702028', Name: 'Nexus EX+' }]);
    expect(recordsOf('not json')).toBeNull();
    expect(recordsOf('{"info":{}}')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

const CONFIG: ZohoConfig = {
  accountsUrl: 'https://accounts.zoho.in',
  apiUrl: 'https://sandbox.zohoapis.in',
  clientId: 'client-id',
  clientSecret: 'very-secret',
  refreshToken: 'refresh-me',
  leadFunction: 'leadcreation_for_ampere_website',
  testRideFunction: 'test_ride_creation_for_ampere_website',
  timeoutMs: 1000,
};

interface Sent {
  url: string;
  method: string;
  auth: string | null;
  body: string;
}

/** A scripted fetch: each call takes the next reply. A reply can be an Error, thrown as fetch would. */
function scriptedFetch(replies: (Response | Error)[]) {
  const sent: Sent[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({
      url: String(url),
      method: init?.method ?? 'GET',
      auth: headers.get('authorization'),
      body: typeof init?.body === 'string' ? init.body : String(init?.body ?? ''),
    });
    const next = replies.shift();
    if (!next) throw new Error('scriptedFetch ran out of replies');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, sent };
}

class Tokens implements TokenProvider {
  refreshed: string[] = [];
  constructor(private current = 'token-1', private fail: Error | null = null) {}
  async get() {
    if (this.fail) throw this.fail;
    return this.current;
  }
  async refresh(rejected: string) {
    this.refreshed.push(rejected);
    this.current = `token-${this.refreshed.length + 1}`;
    return this.current;
  }
}

const RECORD = { Name: 'Asha', Phone: '+919876543210', Pincode: '560064', Website_Lead_ID: 'abc' };
const ok = (body: string, status = 200) => new Response(body, { status });

describe('ZohoCrmClient', () => {
  it('calls Greaves’ function with the token and the record in data[0]', async () => {
    const { fn, sent } = scriptedFetch([ok(SANDBOX.leadCreated)]);
    const client = new ZohoCrmClient(CONFIG, new Tokens(), fn);

    const result = await client.createLead(RECORD);

    expect(result).toMatchObject({ kind: 'accepted', leadId: '1456765000001735315' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: 'https://sandbox.zohoapis.in/crm/v7/functions/leadcreation_for_ampere_website/actions/execute?auth_type=oauth',
      method: 'POST',
      auth: 'Bearer token-1',
    });
    expect(JSON.parse(sent[0]!.body)).toEqual({ data: [RECORD] });
    expect(client.name).toBe('zoho-sandbox');
  });

  it('sends test rides to the test ride function', async () => {
    const { fn, sent } = scriptedFetch([ok(SANDBOX.rideNew)]);
    await new ZohoCrmClient(CONFIG, new Tokens(), fn).createTestRide(RECORD);
    expect(sent[0]!.url).toContain('/functions/test_ride_creation_for_ampere_website/actions/execute');
  });

  it('on a 401, renews the token once and tries again', async () => {
    const tokens = new Tokens();
    const { fn, sent } = scriptedFetch([ok(SANDBOX.invalidToken, 401), ok(SANDBOX.leadCreated)]);

    const result = await new ZohoCrmClient(CONFIG, tokens, fn).createLead(RECORD);

    expect(result.kind).toBe('accepted');
    expect(tokens.refreshed).toEqual(['token-1']);
    expect(sent.map((s) => s.auth)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('gives up after one renewal rather than loop', async () => {
    const tokens = new Tokens();
    const { fn, sent } = scriptedFetch([ok(SANDBOX.invalidToken, 401), ok(SANDBOX.invalidToken, 401)]);

    const result = await new ZohoCrmClient(CONFIG, tokens, fn).createLead(RECORD);

    expect(result).toEqual({ kind: 'unreachable', reason: 'unauthorised', ambiguous: false });
    expect(sent).toHaveLength(2);
    expect(tokens.refreshed).toHaveLength(1);
  });

  it('does not mint a token for a 401 that is not about the token', async () => {
    const tokens = new Tokens();
    const { fn, sent } = scriptedFetch([ok('{"code":"OAUTH_SCOPE_MISMATCH","details":{},"message":"invalid oauth scope to access this URL","status":"error"}', 401)]);

    const result = await new ZohoCrmClient(CONFIG, tokens, fn).createLead(RECORD);

    expect(result).toMatchObject({ kind: 'unreachable', reason: 'unauthorised' });
    expect(tokens.refreshed).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it('fits a request inside the time the caller has left', async () => {
    // A CRM that never answers: only the abort ends the request.
    const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const client = new ZohoCrmClient({ ...CONFIG, timeoutMs: 30_000 }, new Tokens(), hang);

    const started = Date.now();
    const result = await client.createTestRide(RECORD, { timeoutMs: 100 });

    expect(result).toEqual({ kind: 'unreachable', reason: 'timeout', ambiguous: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('reports a timeout as ambiguous — the record may exist', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { fn } = scriptedFetch([timeout]);
    expect(await new ZohoCrmClient(CONFIG, new Tokens(), fn).createTestRide(RECORD)).toEqual({
      kind: 'unreachable',
      reason: 'timeout',
      ambiguous: true,
    });
  });

  it('reports a dropped connection as ambiguous too', async () => {
    const { fn } = scriptedFetch([new TypeError('fetch failed')]);
    expect(await new ZohoCrmClient(CONFIG, new Tokens(), fn).createTestRide(RECORD)).toMatchObject({
      kind: 'unreachable',
      reason: 'network_error',
      ambiguous: true,
    });
  });

  it('without a token, sends nothing and says so plainly', async () => {
    const { fn, sent } = scriptedFetch([]);
    const tokens = new Tokens('x', new ZohoTokenError('invalid_code'));

    const result = await new ZohoCrmClient(CONFIG, tokens, fn).createLead(RECORD);

    expect(result).toEqual({ kind: 'unreachable', reason: 'token_invalid_code', ambiguous: false });
    expect(sent).toHaveLength(0);
  });

  it('labels a non-sandbox host as production', () => {
    const client = new ZohoCrmClient({ ...CONFIG, apiUrl: 'https://www.zohoapis.in' }, new Tokens());
    expect(client.name).toBe('zoho-production');
  });
});

describe('looking up a test ride before a retry', () => {
  it('asks by lead and IST start time, and reads the ids back', async () => {
    const { fn, sent } = scriptedFetch([
      ok('{"data":[{"id":"1456765000001730179","Name":"TR-184"}],"info":{"count":1,"more_records":false}}'),
    ]);
    const client = new ZohoCrmClient(CONFIG, new Tokens(), fn);

    const found = await client.findTestRides('1456765000001730169', new Date('2026-11-04T09:30:00.000Z'));

    expect(found).toEqual(['1456765000001730179']);
    expect(sent[0]!.url).toBe('https://sandbox.zohoapis.in/crm/v7/coql');
    expect(JSON.parse(sent[0]!.body).select_query).toBe(
      "select id from Test_Rides where (Lead = 1456765000001730169 and Test_Ride_Date_Time = '2026-11-04T15:00:00+05:30') limit 10",
    );
  });

  it('reads Zoho’s 204 as "none"', async () => {
    const { fn } = scriptedFetch([new Response(null, { status: 204 })]);
    expect(await new ZohoCrmClient(CONFIG, new Tokens(), fn).findTestRides('1', new Date())).toEqual([]);
  });

  it('returns null — not "none" — when the lookup fails', async () => {
    const { fn } = scriptedFetch([ok('{"code":"OAUTH_SCOPE_MISMATCH"}', 401), ok('{"code":"OAUTH_SCOPE_MISMATCH"}', 401)]);
    expect(await new ZohoCrmClient(CONFIG, new Tokens(), fn).findTestRides('1', new Date())).toBeNull();
    const { fn: down } = scriptedFetch([new TypeError('fetch failed')]);
    expect(await new ZohoCrmClient(CONFIG, new Tokens(), down).findTestRides('1', new Date())).toBeNull();
  });

  it('refuses to put anything but digits into the query', async () => {
    const { fn, sent } = scriptedFetch([]);
    const client = new ZohoCrmClient(CONFIG, new Tokens(), fn);
    expect(await client.findTestRides("1 or 1=1 --", new Date())).toBeNull();
    expect(sent).toHaveLength(0);
  });
});

describe('vehicle models', () => {
  it('lists the CRM’s models with their ids', async () => {
    const { fn, sent } = scriptedFetch([
      ok('{"data":[{"id":"1456765000001702028","Name":"Nexus EX+"},{"id":"1456765000001702031","Name":"Magnus GMAX (INTELLIPACK)"}],"info":{}}'),
    ]);
    expect(await new ZohoCrmClient(CONFIG, new Tokens(), fn).listVehicleModels()).toEqual([
      { id: '1456765000001702028', name: 'Nexus EX+' },
      { id: '1456765000001702031', name: 'Magnus GMAX (INTELLIPACK)' },
    ]);
    expect(sent[0]!.url).toContain('/crm/v7/Vehicle_Models?fields=Name');
  });
});

describe('requestAccessToken', () => {
  it('sends the credentials in the body, never the URL', async () => {
    const { fn, sent } = scriptedFetch([
      ok('{"access_token":"1000.abc","scope":"ZohoCRM.functions.execute.CREATE","api_domain":"https://www.zohoapis.in","token_type":"Bearer","expires_in":3600}'),
    ]);

    const token = await requestAccessToken(CONFIG, fn);

    expect(token).toEqual({ accessToken: '1000.abc', expiresInSeconds: 3600 });
    expect(sent[0]!.url).toBe('https://accounts.zoho.in/oauth/v2/token');
    expect(sent[0]!.url).not.toContain('very-secret');
    const form = new URLSearchParams(sent[0]!.body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('client_secret')).toBe('very-secret');
    expect(form.get('refresh_token')).toBe('refresh-me');
  });

  it('turns Zoho’s "invalid_code" (a 200!) into an error', async () => {
    const { fn } = scriptedFetch([ok('{"error":"invalid_code"}')]);
    await expect(requestAccessToken(CONFIG, fn)).rejects.toMatchObject({ code: 'invalid_code' });
  });

  it('turns a rate-limit refusal into an error', async () => {
    const { fn } = scriptedFetch([ok('{"error_description":"You have made too many requests continuously.","error":"Access Denied","status":"failure"}', 400)]);
    await expect(requestAccessToken(CONFIG, fn)).rejects.toMatchObject({ code: 'Access Denied' });
  });

  it('never puts a secret in the error', async () => {
    const { fn } = scriptedFetch([new TypeError('fetch failed')]);
    const error = await requestAccessToken(CONFIG, fn).catch((e: Error) => e);
    expect(error).toBeInstanceOf(ZohoTokenError);
    expect(String((error as Error).message)).not.toMatch(/very-secret|refresh-me/);
  });
});
