import { getSlotWindow } from '@/lib/test-rides/slots';
import type { CrmRecord } from './types';

/**
 * Our data, in the exact shape Greaves' CRM functions take.
 *
 * Pure. Every format here was checked against the sandbox on 2026-11-02 —
 * docs/greaves-crm/README.md has what was sent and what came back.
 */

const MAX_LENGTH = 255;
const IST_OFFSET_MINUTES = 330;

/** Every Zoho record id is a run of digits. Anything else is corrupt data. */
const ZOHO_ID = /^\d{1,30}$/;

/**
 * Trimmed, single-spaced, cut to the CRM's 255. Missing becomes an empty
 * string, which Greaves' document defines as "not given" for optional fields.
 */
export function text(value: string | null | undefined, max = MAX_LENGTH): string {
  if (value === null || value === undefined) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * +91 and ten digits. The CRM's duplicate search is an exact match on this
 * value, so it must be the same spelling every time — which normalisePhone()
 * already guarantees for anything we stored.
 */
export function crmPhone(e164: string): string {
  if (!/^\+91[6-9]\d{9}$/.test(e164)) {
    throw new Error('crmPhone expects an Indian mobile number in E.164 form');
  }
  return e164;
}

function crmId(value: string | null | undefined, what: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (!ZOHO_ID.test(value)) throw new Error(`${what} is not a Zoho record id`);
  return value;
}

/**
 * dd/MM/yyyy. Any other shape comes back from the CRM as "Mandatory fields
 * are missing", which is misleading, so this is the only place a date is
 * formatted for it.
 *
 * A slot date is a calendar date pinned to UTC midnight (see slots.ts), so it
 * is read in UTC — reading it in local time could slide it a day.
 */
export function crmDate(slotDate: Date): string {
  const dd = String(slotDate.getUTCDate()).padStart(2, '0');
  const mm = String(slotDate.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${slotDate.getUTCFullYear()}`;
}

function clock(minutesOfDay: number): string {
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(twelve).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
}

/**
 * "01:00 PM - 03:00 PM": Greaves' "hh:mm AM/PM - hh:mm AM/PM", plain hyphen.
 *
 * The page shows "1:00 PM – 3:00 PM". The sandbox reads either correctly, but
 * it stores the text exactly as sent, so the CRM's own spelling is the one
 * that keeps their reports consistent.
 */
export function crmTimeSlot(windowCode: string): string {
  const window = getSlotWindow(windowCode);
  if (!window) throw new Error(`Unknown slot window: ${windowCode}`);
  return `${clock(window.startMinutes)} - ${clock(window.endMinutes)}`;
}

/** The instant the slot starts. The CRM stores this as Test_Ride_Date_Time. */
export function crmSlotStart(slotDate: Date, windowCode: string): Date {
  const window = getSlotWindow(windowCode);
  if (!window) throw new Error(`Unknown slot window: ${windowCode}`);
  return new Date(slotDate.getTime() + (window.startMinutes - IST_OFFSET_MINUTES) * 60_000);
}

/** Our help-topic codes as the CRM's multi-select values. */
const TOPIC_LABELS: Record<string, string> = {
  offers: 'Offers',
  brochure: 'Brochure',
  financing: 'Financing',
  specs: 'Specifications',
};

/** "Offers,Brochure" — comma-separated, no spaces, as Greaves' example. */
export function crmHelpTopics(topics: readonly string[]): string {
  return [...new Set(topics)]
    .map((topic) => TOPIC_LABELS[topic])
    .filter((label): label is string => Boolean(label))
    .join(',');
}

export type PageLayout = 'list' | 'variants';

/**
 * utm_layout is Greaves' "UTM layout / page identifier". When the ad link
 * carried one it wins; otherwise it says which of our two layouts the customer
 * saw, which is what lets the two be compared in the CRM.
 */
export function crmPageId(layout: PageLayout): string {
  return layout === 'variants' ? 'buy_variants' : 'buy_list';
}

interface UtmFields {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  utm_layout: string;
}

function utmFields(utm: Record<string, unknown> | null, layout: PageLayout): UtmFields {
  const value = (key: string) => {
    const raw = utm?.[key];
    return typeof raw === 'string' ? text(raw) : '';
  };
  return {
    utm_source: value('utm_source'),
    utm_medium: value('utm_medium'),
    utm_campaign: value('utm_campaign'),
    utm_content: value('utm_content'),
    utm_term: value('utm_term'),
    utm_layout: value('utm_layout') || crmPageId(layout),
  };
}

/* ------------------------------------------------------------------ */

/** Everything the CRM is told about a lead, already read from our records. */
export interface LeadSnapshot {
  /** Our lead id. Greaves' mandatory Website_Lead_ID. */
  websiteLeadId: string;
  name: string;
  phoneE164: string;
  pincode: string;
  vehicleCrmId: string | null;
  colourName: string | null;
  dealerName: string | null;
  dealerCrmId: string | null;
  helpTopics: readonly string[];
  utm: Record<string, unknown> | null;
  layout: PageLayout;
}

export interface TestRideSnapshot extends LeadSnapshot {
  mode: 'dealer' | 'home';
  slotDate: Date;
  windowCode: string;
  /** Links the ride to an existing CRM lead. Empty: the CRM finds or makes one. */
  crmLeadId: string | null;
}

/** The fields a lead and a test ride share, already checked and formatted. */
function sharedFields(lead: LeadSnapshot) {
  if (!/^[1-9]\d{5}$/.test(lead.pincode)) throw new Error('Pincode must be six digits');
  const name = text(lead.name);
  if (!name) throw new Error('A lead needs a name');

  return {
    name,
    phone: crmPhone(lead.phoneE164),
    vehicle: crmId(lead.vehicleCrmId, 'Vehicle model id'),
    colour: text(lead.colourName),
    dealerName: text(lead.dealerName),
    dealerId: crmId(lead.dealerCrmId, 'Dealer id'),
    help: crmHelpTopics(lead.helpTopics),
    utm: utmFields(lead.utm, lead.layout),
    websiteLeadId: text(lead.websiteLeadId),
  };
}

export function buildLeadRecord(lead: LeadSnapshot): CrmRecord {
  const f = sharedFields(lead);
  return {
    Name: f.name,
    Phone: f.phone,
    Pincode: lead.pincode,
    Vehicle_Model_Interested: f.vehicle,
    Colour_Preference: f.colour,
    Dealer_Name: f.dealerName,
    Dealer_ID: f.dealerId,
    'Is_There_Anything_We_Can_Help_You_With?': f.help,
    ...f.utm,
    Website_Lead_ID: f.websiteLeadId,
  };
}

export function buildTestRideRecord(ride: TestRideSnapshot): CrmRecord {
  // Mandatory for a test ride, unlike a lead. Sending it empty gets
  // "Mandatory fields are missing" back, so refuse here with the real reason.
  if (!ride.vehicleCrmId) throw new Error('A test ride needs the CRM vehicle model id');

  const f = sharedFields(ride);
  return {
    Name: f.name,
    Phone: f.phone,
    Pincode: ride.pincode,
    Vehicle_Model_Interested: f.vehicle,
    Colour_Preference: f.colour,
    Test_Ride_Location: ride.mode === 'home' ? 'Home' : 'Dealer',
    Dealer_Name: f.dealerName,
    Dealer_ID: f.dealerId,
    Test_Ride_Date_Time: crmDate(ride.slotDate),
    Time_Slot: crmTimeSlot(ride.windowCode),
    'Is_There_Anything_We_Can_Help_You_With?': f.help,
    ...f.utm,
    Website_Lead_ID: f.websiteLeadId,
    Zoho_CRM_Lead_ID: crmId(ride.crmLeadId, 'CRM lead id'),
  };
}
