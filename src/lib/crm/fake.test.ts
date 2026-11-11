import { describe, expect, it } from 'vitest';
import { FakeCrmClient } from './fake';

/**
 * The fake is only worth having if it behaves like the sandbox did. These pin
 * the behaviours the job tests rely on.
 */

const lead = (phone: string, over: Record<string, string> = {}) => ({
  Name: 'Asha',
  Phone: phone,
  Pincode: '560064',
  Website_Lead_ID: 'w-1',
  ...over,
});
const ride = (phone: string, over: Record<string, string> = {}) => ({
  ...lead(phone),
  Vehicle_Model_Interested: '1456765000001702028',
  Test_Ride_Location: 'Dealer',
  Test_Ride_Date_Time: '04/11/2026',
  Time_Slot: '01:00 PM - 03:00 PM',
  Zoho_CRM_Lead_ID: '',
  ...over,
});

describe('FakeCrmClient', () => {
  it('refuses the same mobile within 90 days, however it is written', async () => {
    const crm = new FakeCrmClient();
    const first = await crm.createLead(lead('+919000012345'));
    expect(first.kind).toBe('accepted');
    expect(await crm.createLead(lead('9000012345'))).toEqual({
      kind: 'rejected',
      category: 'rule_failure',
      message: 'Duplicate Lead: Active Lead already exists in the system',
      leadId: first.kind === 'accepted' ? first.leadId : 'x',
    });
  });

  it('takes the number again after 90 days', async () => {
    let now = Date.UTC(2026, 0, 1);
    const crm = new FakeCrmClient(() => now);
    await crm.createLead(lead('+919000012345'));
    now += 91 * 86_400_000;
    expect((await crm.createLead(lead('+919000012345'))).kind).toBe('accepted');
  });

  it('attaches a test ride for a known number to that lead', async () => {
    const crm = new FakeCrmClient();
    const first = await crm.createLead(lead('+919000012345'));
    const second = await crm.createTestRide(ride('+919000012345'));
    expect(second).toMatchObject({
      kind: 'accepted',
      message: 'Test Ride created and mapped to the existing Lead successfully',
      leadId: first.kind === 'accepted' ? first.leadId : 'x',
    });
  });

  it('ignores a lead id it does not have, and goes by the number', async () => {
    const crm = new FakeCrmClient();
    expect(await crm.createTestRide(ride('+919000012345', { Zoho_CRM_Lead_ID: '123' }))).toMatchObject({
      kind: 'accepted',
      message: 'New Lead and Test Ride created successfully',
    });
  });

  it('fails a ride for a new number sent with a dealer, but not for a known one', async () => {
    const crm = new FakeCrmClient();
    const withDealer = { Dealer_ID: '1456765000001717131' };
    expect(await crm.createTestRide(ride('+919000012345', withDealer))).toMatchObject({
      kind: 'rejected',
      message: expect.stringMatching(/^Lead creation failed: .*Preferred_Aggregator_Dealer/),
    });
    expect(crm.leadCount).toBe(0);

    await crm.createLead(lead('+919000012345'));
    expect(await crm.createTestRide(ride('+919000012345', withDealer))).toMatchObject({ kind: 'accepted' });
  });

  it('reads a date in the wrong format as a missing field, as the sandbox does', async () => {
    const crm = new FakeCrmClient();
    expect(await crm.createTestRide(ride('+919000012345', { Test_Ride_Date_Time: '2026-11-04' }))).toMatchObject({
      message: 'Mandatory fields are missing',
    });
  });

  it('makes two rides from the same request sent twice — the CRM has no idempotency', async () => {
    const crm = new FakeCrmClient();
    await crm.createTestRide(ride('+919000012345'));
    await crm.createTestRide(ride('+919000012345'));
    expect(crm.rideCount).toBe(2);
  });

  it('can lose the answer after writing the record', async () => {
    const crm = new FakeCrmClient();
    crm.failNext('test_ride', 'timeout_after_commit');
    expect(await crm.createTestRide(ride('+919000012345'))).toMatchObject({ kind: 'unreachable', ambiguous: true });
    expect(crm.rideCount).toBe(1);
  });

  it('finds a ride by lead and start instant', async () => {
    const crm = new FakeCrmClient();
    const created = await crm.createTestRide(ride('+919000012345'));
    if (created.kind !== 'accepted') throw new Error('expected accepted');
    const startsAt = new Date('2026-11-04T07:30:00.000Z'); // 13:00 IST
    expect(await crm.findTestRides(created.leadId!, startsAt)).toEqual([created.testRideId]);
    expect(await crm.findTestRides(created.leadId!, new Date('2026-11-04T09:30:00.000Z'))).toEqual([]);
  });
});
