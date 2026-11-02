import { describe, expect, it } from 'vitest';
import {
  buildLeadRecord,
  buildTestRideRecord,
  crmDate,
  crmHelpTopics,
  crmPhone,
  crmSlotStart,
  crmTimeSlot,
  text,
  type LeadSnapshot,
  type TestRideSnapshot,
} from './payload';
import { istTimestamp } from './zoho';

/** Greaves' field lists, from the PDF, in order. The CRM function reads these names exactly. */
const LEAD_FIELDS = [
  'Name',
  'Phone',
  'Pincode',
  'Vehicle_Model_Interested',
  'Colour_Preference',
  'Dealer_Name',
  'Dealer_ID',
  'Is_There_Anything_We_Can_Help_You_With?',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_layout',
  'Website_Lead_ID',
];
const TEST_RIDE_FIELDS = [
  ...LEAD_FIELDS,
  'Test_Ride_Location',
  'Test_Ride_Date_Time',
  'Time_Slot',
  'Zoho_CRM_Lead_ID',
];

/** Real sandbox ids — each longer than a JavaScript number can hold exactly. */
const NEXUS = '1456765000001702028';
const RG_MOTORS = '1456765000001717131';

const lead = (over: Partial<LeadSnapshot> = {}): LeadSnapshot => ({
  websiteLeadId: '0b8e3c1e-1111-4a6f-9c1e-2a9c8f1d7e01',
  name: 'Asha Menon',
  phoneE164: '+919876543210',
  pincode: '560064',
  vehicleCrmId: NEXUS,
  colourName: 'Carbon Knight',
  dealerName: 'RG Motors',
  dealerCrmId: RG_MOTORS,
  helpTopics: [],
  utm: null,
  layout: 'list',
  ...over,
});

const ride = (over: Partial<TestRideSnapshot> = {}): TestRideSnapshot => ({
  ...lead(),
  mode: 'dealer',
  slotDate: new Date('2026-11-04T00:00:00.000Z'),
  windowCode: 'w2',
  crmLeadId: null,
  ...over,
});

describe('dates and times, as the sandbox accepted them', () => {
  it('writes the date dd/MM/yyyy', () => {
    expect(crmDate(new Date('2026-11-04T00:00:00.000Z'))).toBe('04/11/2026');
    expect(crmDate(new Date('2027-01-09T00:00:00.000Z'))).toBe('09/01/2027');
    expect(crmDate(new Date('2026-12-31T00:00:00.000Z'))).toBe('31/12/2026');
  });

  it('writes every slot in Greaves’ "hh:mm AM - hh:mm PM", plain hyphen', () => {
    expect(crmTimeSlot('w1')).toBe('10:00 AM - 12:00 PM');
    expect(crmTimeSlot('w2')).toBe('01:00 PM - 03:00 PM');
    expect(crmTimeSlot('w3')).toBe('03:00 PM - 05:00 PM');
    expect(crmTimeSlot('w4')).toBe('05:00 PM - 08:00 PM');
  });

  it('never sends the page’s long dash', () => {
    for (const w of ['w1', 'w2', 'w3', 'w4']) expect(crmTimeSlot(w)).not.toContain('–');
  });

  it('refuses a slot it does not know', () => {
    expect(() => crmTimeSlot('w9')).toThrow();
  });

  it('starts the slot at the instant the CRM stores, in IST', () => {
    const start = crmSlotStart(new Date('2026-11-04T00:00:00.000Z'), 'w2');
    expect(start.toISOString()).toBe('2026-11-04T07:30:00.000Z');
    // Exactly the Test_Ride_Date_Time the sandbox stored for this slot.
    expect(istTimestamp(start)).toBe('2026-11-04T13:00:00+05:30');
    expect(istTimestamp(crmSlotStart(new Date('2026-11-05T00:00:00.000Z'), 'w1'))).toBe(
      '2026-11-05T10:00:00+05:30',
    );
  });
});

describe('help topics', () => {
  it('joins with a comma and no spaces, like Greaves’ "Offers,Financing"', () => {
    expect(crmHelpTopics(['offers', 'brochure'])).toBe('Offers,Brochure');
  });

  it('drops repeats and anything unknown, and is empty when nothing was ticked', () => {
    expect(crmHelpTopics(['brochure', 'brochure', 'nonsense'])).toBe('Brochure');
    expect(crmHelpTopics([])).toBe('');
  });
});

describe('phone and text', () => {
  it('sends the mobile as +91 and ten digits', () => {
    expect(crmPhone('+919876543210')).toBe('+919876543210');
  });

  it('refuses anything else rather than guess', () => {
    expect(() => crmPhone('9876543210')).toThrow();
    expect(() => crmPhone('+14155550100')).toThrow();
    expect(() => crmPhone('+915876543210')).toThrow();
  });

  it('trims, collapses spaces and stops at 255', () => {
    expect(text('  Asha   Menon ')).toBe('Asha Menon');
    expect(text(null)).toBe('');
    expect(text('x'.repeat(300))).toHaveLength(255);
  });
});

describe('the lead record', () => {
  it('has exactly Greaves’ fields, every one a string', () => {
    const record = buildLeadRecord(lead());
    expect(Object.keys(record)).toEqual(LEAD_FIELDS);
    for (const value of Object.values(record)) expect(typeof value).toBe('string');
  });

  it('carries our values in the right places', () => {
    const record = buildLeadRecord(lead({ helpTopics: ['offers'] }));
    expect(record).toMatchObject({
      Name: 'Asha Menon',
      Phone: '+919876543210',
      Pincode: '560064',
      Vehicle_Model_Interested: NEXUS,
      Colour_Preference: 'Carbon Knight',
      Dealer_Name: 'RG Motors',
      Dealer_ID: RG_MOTORS,
      'Is_There_Anything_We_Can_Help_You_With?': 'Offers',
      Website_Lead_ID: '0b8e3c1e-1111-4a6f-9c1e-2a9c8f1d7e01',
    });
  });

  it('keeps all 19 digits of every id on the wire', () => {
    const wire = JSON.stringify({ data: [buildLeadRecord(lead())] });
    expect(wire).toContain(`"Vehicle_Model_Interested":"${NEXUS}"`);
    expect(wire).toContain(`"Dealer_ID":"${RG_MOTORS}"`);
    // What a number would have done to it:
    expect(String(Number(NEXUS))).not.toBe(NEXUS);
  });

  it('sends empty strings, never null, for what we do not know', () => {
    const record = buildLeadRecord(
      lead({ vehicleCrmId: null, colourName: null, dealerName: null, dealerCrmId: null }),
    );
    expect(record.Vehicle_Model_Interested).toBe('');
    expect(record.Colour_Preference).toBe('');
    expect(record.Dealer_Name).toBe('');
    expect(record.Dealer_ID).toBe('');
    expect(record.utm_source).toBe('');
  });

  it('passes the ad’s UTMs through', () => {
    const record = buildLeadRecord(
      lead({ utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'gmax_launch', utm_term: 'ev scooter' } }),
    );
    expect(record).toMatchObject({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'gmax_launch',
      utm_content: '',
      utm_term: 'ev scooter',
    });
  });

  it('names the layout the customer saw in utm_layout, unless the ad named one', () => {
    expect(buildLeadRecord(lead({ layout: 'list' })).utm_layout).toBe('buy_list');
    expect(buildLeadRecord(lead({ layout: 'variants' })).utm_layout).toBe('buy_variants');
    expect(buildLeadRecord(lead({ utm: { utm_layout: 'diwali_lp' } })).utm_layout).toBe('diwali_lp');
  });

  it('ignores a UTM that is not text', () => {
    expect(buildLeadRecord(lead({ utm: { utm_source: 42 } })).utm_source).toBe('');
  });

  it('refuses a corrupt id or pincode rather than send it', () => {
    expect(() => buildLeadRecord(lead({ dealerCrmId: 'AMP-S-001' }))).toThrow(/Dealer id/);
    expect(() => buildLeadRecord(lead({ vehicleCrmId: '1e18' }))).toThrow(/Vehicle model id/);
    expect(() => buildLeadRecord(lead({ pincode: '05600' }))).toThrow(/Pincode/);
    expect(() => buildLeadRecord(lead({ name: '   ' }))).toThrow(/name/);
  });
});

describe('the test ride record', () => {
  it('has exactly Greaves’ fields, every one a string', () => {
    const record = buildTestRideRecord(ride());
    expect(Object.keys(record).sort()).toEqual([...TEST_RIDE_FIELDS].sort());
    for (const value of Object.values(record)) expect(typeof value).toBe('string');
  });

  it('carries the booking', () => {
    const record = buildTestRideRecord(ride({ helpTopics: ['offers', 'brochure'], crmLeadId: '1456765000001736114' }));
    expect(record).toMatchObject({
      Test_Ride_Location: 'Dealer',
      Test_Ride_Date_Time: '04/11/2026',
      Time_Slot: '01:00 PM - 03:00 PM',
      'Is_There_Anything_We_Can_Help_You_With?': 'Offers,Brochure',
      Zoho_CRM_Lead_ID: '1456765000001736114',
      Dealer_ID: RG_MOTORS,
      Vehicle_Model_Interested: NEXUS,
    });
  });

  it('leaves Zoho_CRM_Lead_ID empty when we have none, so the CRM matches by number', () => {
    expect(buildTestRideRecord(ride({ crmLeadId: null })).Zoho_CRM_Lead_ID).toBe('');
  });

  it('says Home for a home ride', () => {
    expect(buildTestRideRecord(ride({ mode: 'home' })).Test_Ride_Location).toBe('Home');
  });

  it('will not send a ride without the vehicle, which the CRM requires', () => {
    expect(() => buildTestRideRecord(ride({ vehicleCrmId: null }))).toThrow(/vehicle model id/);
  });
});
