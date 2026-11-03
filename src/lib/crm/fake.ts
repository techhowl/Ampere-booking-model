import type { CrmClient, CrmRecord, CrmResult } from './types';

/**
 * Greaves CRM.Next, in memory. Drives development and the test suite, the same
 * pattern as FakeJuspayClient.
 *
 * It copies what the sandbox was SEEN to do (2026-11-02, re-tested
 * 2026-11-03), not what the PDF says, where the two differ:
 *
 *   - the same mobile within 90 days is a duplicate, whatever its spelling,
 *     and the answer names the existing lead (Existing_lead_id)
 *   - a test ride for a known number attaches to that customer's active lead
 *   - an unknown Zoho_CRM_Lead_ID is refused
 *   - a date not in dd/MM/yyyy reads as "Mandatory fields are missing"
 *   - the same test ride sent twice is two test rides
 *
 * failNext() queues the failures the real one can produce, including the
 * worst: a timeout AFTER the CRM has written the record.
 */

export type FakeFailure =
  /** Never reached the CRM. */
  | 'unreachable'
  /** Reached it, wrote the record, and the answer was lost. */
  | 'timeout_after_commit'
  /** The CRM's catch-all, as for a suspended dealer. */
  | 'api_failure'
  /** Only for findTestRides: the lookup itself fails. */
  | 'lookup_fails';

type Method = 'lead' | 'test_ride' | 'find';

const NINETY_DAYS_MS = 90 * 86_400_000;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i;

interface FakeLead {
  id: string;
  phone: string;
  createdAt: number;
}

interface FakeRide {
  id: string;
  leadId: string;
  startsAt: number;
  record: CrmRecord;
}

const accepted = (message: string, leadId: string, testRideId: string | null): CrmResult => ({
  kind: 'accepted',
  message,
  leadId,
  testRideId,
});
const rejected = (category: string, message: string, leadId: string | null = null): CrmResult => ({
  kind: 'rejected',
  category,
  message,
  leadId,
});
const MISSING = rejected('rule_failure', 'Mandatory fields are missing');

export class FakeCrmClient implements CrmClient {
  readonly name = 'fake';
  /** Every call, in order — what the tests assert on. */
  readonly calls: { method: Method; record?: CrmRecord }[] = [];

  private readonly leads = new Map<string, FakeLead>();
  private readonly rides: FakeRide[] = [];
  private readonly failures: Record<Method, FakeFailure[]> = { lead: [], test_ride: [], find: [] };
  private nextId = 9_100_000_000_000_000_000n;

  constructor(
    private readonly now: () => number = Date.now,
    /** False: a duplicate answer names no lead, as the sandbox did until 2026-11-03. */
    private readonly duplicateNamesLead = true,
  ) {}

  failNext(method: Method, ...failures: FakeFailure[]): void {
    this.failures[method].push(...failures);
  }

  async createLead(record: CrmRecord): Promise<CrmResult> {
    this.calls.push({ method: 'lead', record });
    const failure = this.failures.lead.shift();
    if (failure === 'unreachable') return { kind: 'unreachable', reason: 'network_error', ambiguous: true };
    if (failure === 'api_failure') return rejected('api_failure', 'Lead creation failed due to technical reasons');

    if (!record.Name || !record.Phone || !record.Pincode || !record.Website_Lead_ID) return MISSING;
    const existing = this.activeLeadFor(record.Phone);
    if (existing) {
      return this.duplicateNamesLead
        ? rejected('rule_failure', 'Duplicate Lead: Active Lead already exists in the system', existing.id)
        : rejected('rule_failure', 'Duplicate Lead: Lead already exists in the system');
    }

    const lead = this.addLead(record.Phone);
    this.log(`lead ${lead.id} for ••••${record.Phone.slice(-4)}`);
    if (failure === 'timeout_after_commit') return { kind: 'unreachable', reason: 'timeout', ambiguous: true };
    return accepted('Lead created successfully', lead.id, null);
  }

  async createTestRide(record: CrmRecord): Promise<CrmResult> {
    this.calls.push({ method: 'test_ride', record });
    const failure = this.failures.test_ride.shift();
    if (failure === 'unreachable') return { kind: 'unreachable', reason: 'network_error', ambiguous: true };
    if (failure === 'api_failure') return rejected('api_failure', 'Lead creation failed due to technical reasons');

    const startsAt = startOf(record.Test_Ride_Date_Time, record.Time_Slot);
    const mandatory = ['Name', 'Phone', 'Pincode', 'Vehicle_Model_Interested', 'Test_Ride_Location', 'Website_Lead_ID'];
    if (mandatory.some((field) => !record[field]) || startsAt === null) return MISSING;

    let lead: FakeLead | undefined;
    let message: string;
    if (record.Zoho_CRM_Lead_ID) {
      lead = this.leads.get(record.Zoho_CRM_Lead_ID);
      if (!lead) return rejected('rule_failure', 'Provided Zoho CRM Lead ID is not available');
      message = 'Test Ride created and mapped to the existing Lead successfully';
    } else {
      lead = this.activeLeadFor(record.Phone ?? '');
      if (lead) {
        message = 'Duplicate Lead already exists. Test Ride created and mapped to the existing active Lead successfully';
      } else {
        lead = this.addLead(record.Phone ?? '');
        message = 'New Lead and Test Ride created successfully';
      }
    }

    const ride: FakeRide = { id: this.id(), leadId: lead.id, startsAt, record };
    this.rides.push(ride);
    this.log(`test ride ${ride.id} on lead ${lead.id}, ${record.Test_Ride_Date_Time} ${record.Time_Slot}`);
    if (failure === 'timeout_after_commit') return { kind: 'unreachable', reason: 'timeout', ambiguous: true };
    return accepted(message, lead.id, ride.id);
  }

  async findTestRides(crmLeadId: string, startsAt: Date): Promise<string[] | null> {
    this.calls.push({ method: 'find' });
    if (this.failures.find.shift() === 'lookup_fails') return null;
    return this.rides
      .filter((ride) => ride.leadId === crmLeadId && ride.startsAt === startsAt.getTime())
      .map((ride) => ride.id);
  }

  /* --- for the tests ------------------------------------------------ */

  /** As if the CRM merged or deleted the lead: its id stops working. */
  forgetLead(id: string): void {
    this.leads.delete(id);
  }

  ridesOn(leadId: string): FakeRide[] {
    return this.rides.filter((ride) => ride.leadId === leadId);
  }

  get rideCount(): number {
    return this.rides.length;
  }

  get leadCount(): number {
    return this.leads.size;
  }

  reset(): void {
    this.calls.length = 0;
    this.leads.clear();
    this.rides.length = 0;
    for (const queue of Object.values(this.failures)) queue.length = 0;
  }

  /* ------------------------------------------------------------------ */

  private id(): string {
    this.nextId += 1n;
    return this.nextId.toString();
  }

  private addLead(phone: string): FakeLead {
    const lead = { id: this.id(), phone: phone.replace(/\D/g, '').slice(-10), createdAt: this.now() };
    this.leads.set(lead.id, lead);
    return lead;
  }

  /** The sandbox matched a number with and without +91, so compare the last ten digits. */
  private activeLeadFor(phone: string): FakeLead | undefined {
    const digits = phone.replace(/\D/g, '').slice(-10);
    const cutoff = this.now() - NINETY_DAYS_MS;
    return [...this.leads.values()].find((lead) => lead.phone === digits && lead.createdAt >= cutoff);
  }

  private log(line: string): void {
    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      console.info(`[fake-crm] ${line}`);
    }
  }
}

/** dd/MM/yyyy plus the slot's start, as the instant the CRM would store. Null if either is unreadable. */
function startOf(date: string | undefined, slot: string | undefined): number | null {
  const d = date?.match(DATE);
  const t = slot?.match(TIME);
  if (!d || !t) return null;
  let hours = Number(t[1]) % 12;
  if (t[3]?.toUpperCase() === 'PM') hours += 12;
  const midnight = Date.UTC(Number(d[3]), Number(d[2]) - 1, Number(d[1]));
  return midnight + (hours * 60 + Number(t[2]) - 330) * 60_000;
}
