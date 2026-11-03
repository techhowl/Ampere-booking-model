/**
 * Greaves CRM.Next — the shapes shared by the real client, the fake, and the
 * sync jobs. See docs/greaves-crm/README.md for the API and what the sandbox
 * actually does, which is not always what the PDF says.
 */

/**
 * One record exactly as the CRM function takes it: Zoho's own field names,
 * every value a string. Built in payload.ts and nowhere else.
 *
 * Strings, not numbers, for the ids too. A Zoho id such as
 * 1456765000001702028 is larger than JavaScript can hold exactly, so a number
 * would arrive at the CRM as a different id. The sandbox accepts strings.
 */
export type CrmRecord = Record<string, string>;

/** What happened when we called the CRM. */
export type CrmResult =
  /** The CRM did it. Ids are present whenever the CRM returned them. */
  | { kind: 'accepted'; message: string; leadId: string | null; testRideId: string | null }
  /**
   * The CRM answered, and the answer was no. `leadId` is the customer's
   * existing lead when the answer names one — a "Duplicate Lead" does, since
   * 2026-11-03 — otherwise null.
   */
  | { kind: 'rejected'; category: string; message: string; leadId: string | null }
  /**
   * We have no answer. `ambiguous` means the request may still have landed —
   * a timeout, a dropped connection, a 5xx — so a retry could duplicate it.
   */
  | { kind: 'unreachable'; reason: string; ambiguous: boolean };

/** Per call. Lets a caller with a time limit fit the request inside it. */
export interface CallOptions {
  timeoutMs?: number;
}

export interface CrmClient {
  /** "zoho-sandbox", "zoho-production" or "fake" — for logs, never secrets. */
  readonly name: string;

  /** Greaves' "Create Lead (Website Enquiry)". */
  createLead(record: CrmRecord, options?: CallOptions): Promise<CrmResult>;

  /** Greaves' "Create Test Ride and Lead". */
  createTestRide(record: CrmRecord, options?: CallOptions): Promise<CrmResult>;

  /**
   * Test rides already on this CRM lead that start at this instant. Used
   * before re-sending a test ride whose last attempt timed out, because the
   * CRM creates a second ride for a repeated request.
   *
   * Null when the lookup itself failed: the caller must not read that as "none".
   */
  findTestRides(crmLeadId: string, startsAt: Date, options?: CallOptions): Promise<string[] | null>;
}
