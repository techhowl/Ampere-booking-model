import { describe, expect, it } from 'vitest';
import { DealerListError, localityOf, parseDealerList } from './dealers';

const wrap = (output: string, code = 'success') =>
  JSON.stringify({ code, details: { output, output_type: 'string', id: '600999000000022030' }, message: 'function executed successfully' });

/** The first rows of get_dealers' answer, recorded from the sandbox on 2026-11-03. */
const RECORDED = wrap(
  '{"status":"success","category":"success","message":"Dealers fetched successfully","total_dealers":3,"dealers":[' +
    '{"dealer_name":"RG Motors","dealer_id":"1456765000001717131","city":"Bengaluru","state":"Karnataka","pincode":"560064"},' +
    '{"dealer_name":"GAUR AUTO WINGS PRIVATE LIMITED","dealer_id":"1456765000001717134","city":"Gautam Buddha Nagar","state":"Uttar Pradesh","pincode":"201301"},' +
    '{"dealer_name":"Shivam Ev","dealer_id":"1456765000001717135","city":"Rajkot","state":"Gujarat","pincode":"360007"}]}',
);

const list = (dealers: unknown[], extra: Record<string, unknown> = {}) =>
  wrap(JSON.stringify({ status: 'success', message: 'Dealers fetched successfully', total_dealers: dealers.length, dealers, ...extra }));

describe('reading the dealer master', () => {
  it('reads the recorded answer, ids exact', () => {
    const { dealers, skipped } = parseDealerList(200, RECORDED);
    expect(skipped).toEqual([]);
    expect(dealers).toHaveLength(3);
    expect(dealers[0]).toEqual({
      crmId: '1456765000001717131',
      name: 'RG Motors',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560064',
    });
  });

  it('keeps an id exact even if it arrives as a bare number', () => {
    const body = wrap(
      '{"status":"success","total_dealers":1,"dealers":[{"dealer_name":"RG Motors","dealer_id":1456765000001717131,"city":"Bengaluru","state":"Karnataka","pincode":"560064"}]}',
    );
    expect(parseDealerList(200, body).dealers[0]!.crmId).toBe('1456765000001717131');
  });

  it('drops unusable rows and says why, and tidies names', () => {
    const { dealers, skipped } = parseDealerList(
      200,
      list([
        { dealer_name: '  Moti   Motors ', dealer_id: '1456765000001717200', city: 'Chennai', state: 'Tamil Nadu', pincode: '600052' },
        { dealer_name: 'No Id', dealer_id: '', city: 'Chennai', state: 'Tamil Nadu', pincode: '600052' },
        { dealer_name: '', dealer_id: '1456765000001717201', city: 'Chennai', state: 'Tamil Nadu', pincode: '600052' },
        { dealer_name: 'Bad Pin', dealer_id: '1456765000001717202', city: 'Chennai', state: 'Tamil Nadu', pincode: '60005' },
        { dealer_name: 'Moti Motors again', dealer_id: '1456765000001717200', city: 'Chennai', state: 'Tamil Nadu', pincode: '600096' },
        'not a row',
      ]),
    );
    expect(dealers.map((d) => d.name)).toEqual(['Moti Motors']);
    expect(skipped).toEqual([
      { row: 2, reason: 'no valid dealer_id' },
      { row: 3, reason: 'dealer 1456765000001717201 has no name' },
      { row: 4, reason: 'dealer 1456765000001717202 has no valid pincode' },
      { row: 5, reason: 'dealer 1456765000001717200 is listed twice' },
      { row: 6, reason: 'no valid dealer_id' },
    ]);
  });

  it('refuses anything that is not a whole dealer list', () => {
    expect(() => parseDealerList(401, '{"code":"OAUTH_SCOPE_MISMATCH"}')).toThrow(DealerListError);
    expect(() => parseDealerList(200, 'not json')).toThrow(DealerListError);
    expect(() => parseDealerList(200, wrap('{}', 'INVALID_DATA'))).toThrow(DealerListError);
    expect(() => parseDealerList(200, wrap('{"status":"failure","message":"Dealers fetch failed"}'))).toThrow(
      /Dealers fetch failed/,
    );
    // A list that says it holds more than it sent is partial; syncing it would retire the rest.
    expect(() =>
      parseDealerList(200, list([{ dealer_name: 'RG Motors', dealer_id: '1456765000001717131', city: 'Bengaluru', state: 'Karnataka', pincode: '560064' }], { total_dealers: 441 })),
    ).toThrow(/paged/);
  });

  it('shows city, state and pincode until the CRM sends an address', () => {
    expect(localityOf({ city: 'Bengaluru', state: 'Karnataka', pincode: '560064' })).toBe('Bengaluru, Karnataka 560064');
    expect(localityOf({ city: '', state: 'Karnataka', pincode: '560064' })).toBe('Karnataka 560064');
  });
});
