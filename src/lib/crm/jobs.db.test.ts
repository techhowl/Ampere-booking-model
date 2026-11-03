import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { resetDatabase } from '../../../test/reset-db';
import type { CrmClient, CrmRecord, CrmResult } from './types';

beforeAll(() => {
  process.env.PHONE_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.PHONE_HMAC_SECRET = randomBytes(32).toString('base64');
});

const prisma = new PrismaClient({ datasources: { db: { url: inject('databaseUrl') } } });

const {
  enqueueLeadSync,
  enqueueTestRideSync,
  MAX_ATTEMPTS,
  reconcileMissingJobs,
  requeueDeadJobs,
  runDueJobs,
  runJob,
} = await import('./jobs');
const { FakeCrmClient } = await import('./fake');
const { phoneColumns } = await import('@/lib/crypto/phone');

const PHONE = '+919876543210';
const NEXUS = '1456765000001702028';
const RG_MOTORS = '1456765000001717131';
const MINUTE = 60_000;

let crm: InstanceType<typeof FakeCrmClient>;

/** Just after "now", so a job created a moment ago is due. */
const soon = (offsetMs = 0) => new Date(Date.now() + 1000 + offsetMs);
const run = (id: string, client: CrmClient = crm, at: Date = soon()) => runJob(prisma, client, id, at);
const job = (id: string) => prisma.crmJob.findUniqueOrThrow({ where: { id } });
const sent = (method: 'lead' | 'test_ride') =>
  crm.calls.filter((c) => c.method === method).map((c) => c.record as CrmRecord);

async function makeLead(over: { phone?: string; verified?: boolean; crmLeadId?: string | null } = {}) {
  const lead = await prisma.lead.create({
    data: {
      name: 'Asha Menon',
      ...phoneColumns(over.phone ?? PHONE),
      phoneVerified: over.verified ?? true,
      pincode: '560064',
      dealerCode: 'AMP-S-001',
      modelCode: 'nexus-ex-plus',
      colourCode: 'carbon-knight',
      utm: { utm_source: 'google', utm_campaign: 'gmax_launch' },
      sourceRaw: { view: 'variants', utm_source: 'google' },
      crmLeadId: over.crmLeadId ?? null,
    },
  });
  return lead.id;
}

async function makeRide(leadId: string, over: Record<string, unknown> = {}) {
  const ride = await prisma.testRide.create({
    data: {
      leadId,
      dealerCode: 'AMP-S-001',
      modelCode: 'nexus-ex-plus',
      colourCode: 'carbon-knight',
      mode: 'dealer',
      slotDate: new Date('2026-11-04T00:00:00.000Z'),
      slotWindow: 'w2',
      helpTopic: 'offers',
      helpTopics: ['offers', 'brochure'],
      status: 'booked',
      ...over,
    },
  });
  return ride.id;
}

/** What save-lead does when the customer types a different number. */
const changeNumber = (leadId: string, phone: string) =>
  prisma.lead.update({ where: { id: leadId }, data: { ...phoneColumns(phone), phoneVerified: false, crmLeadId: null } });
const verify = (leadId: string) => prisma.lead.update({ where: { id: leadId }, data: { phoneVerified: true } });

/** A client that answers with whatever the test says — for answers the fake never gives. */
function stub(answer: (method: 'lead' | 'test_ride') => Promise<CrmResult>): CrmClient {
  return {
    name: 'stub',
    createLead: () => answer('lead'),
    createTestRide: () => answer('test_ride'),
    findTestRides: async () => [],
  };
}

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.dealer.create({
    data: { dealerCode: 'AMP-S-001', name: 'Ampere Indiranagar', active: true, crmId: RG_MOTORS },
  });
  await prisma.crmVehicleModel.create({
    data: { modelCode: 'nexus-ex-plus', crmId: NEXUS, crmName: 'Nexus EX+' },
  });
  crm = new FakeCrmClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */

describe('queueing', () => {
  it('keeps unverified numbers out of the CRM', async () => {
    const leadId = await makeLead({ verified: false });
    expect(await enqueueLeadSync(prisma, leadId)).toBeNull();
    expect(await prisma.crmJob.count()).toBe(0);
  });

  it('queues a verified lead once, however often it is asked', async () => {
    const leadId = await makeLead();
    const first = await enqueueLeadSync(prisma, leadId);
    const second = await enqueueLeadSync(prisma, leadId);
    expect(first).toBe(second);
    expect(await prisma.crmJob.count()).toBe(1);
  });

  it('queues a test ride once', async () => {
    const rideId = await makeRide(await makeLead());
    expect(await enqueueTestRideSync(prisma, rideId)).toBe(await enqueueTestRideSync(prisma, rideId));
    expect(await prisma.crmJob.count()).toBe(1);
  });

  it('sends a changed number as a new customer, even after the first was sent', async () => {
    const leadId = await makeLead();
    // after() sends the first number the moment it is verified.
    await run((await enqueueLeadSync(prisma, leadId))!);
    const firstCrmId = (await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId;
    expect(firstCrmId).toMatch(/^\d{19}$/);

    await changeNumber(leadId, '+919123456780');
    await verify(leadId);
    expect(await run((await enqueueLeadSync(prisma, leadId))!)).toMatchObject({ state: 'done', outcome: 'created' });

    expect(sent('lead').map((r) => r.Phone)).toEqual([PHONE, '+919123456780']);
    const secondCrmId = (await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId;
    expect(secondCrmId).toMatch(/^\d{19}$/);
    expect(secondCrmId).not.toBe(firstCrmId);
  });

  it('drops a job whose number changed before it was sent', async () => {
    const leadId = await makeLead();
    const oldJob = (await enqueueLeadSync(prisma, leadId))!;
    await changeNumber(leadId, '+919123456780');

    expect(await run(oldJob)).toMatchObject({ state: 'done', outcome: 'superseded' });
    expect(sent('lead')).toHaveLength(0);
  });

  it('sends the first number after all if the customer goes back to it (A, B, A)', async () => {
    const leadId = await makeLead();
    const jobA = (await enqueueLeadSync(prisma, leadId))!;
    await changeNumber(leadId, '+919123456780');
    await run(jobA); // superseded

    await changeNumber(leadId, PHONE);
    await verify(leadId);
    expect(await enqueueLeadSync(prisma, leadId)).toBe(jobA);
    expect(await run(jobA)).toMatchObject({ state: 'done', outcome: 'created' });
    expect(sent('lead').map((r) => r.Phone)).toEqual([PHONE]);
  });

  it('does not file a late answer for the old number under the new one', async () => {
    const leadId = await makeLead();
    const jobId = (await enqueueLeadSync(prisma, leadId))!;

    // While the old number is being sent, the customer changes it.
    const slow = stub(async () => {
      await changeNumber(leadId, '+919123456780');
      return { kind: 'accepted', message: 'Lead created successfully', leadId: '1456765000001700001', testRideId: null };
    });

    expect(await run(jobId, slow)).toMatchObject({ state: 'done', outcome: 'created' });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe('a lead', () => {
  it('reaches the CRM with every field, and keeps the CRM’s id', async () => {
    const leadId = await makeLead();
    const jobId = (await enqueueLeadSync(prisma, leadId))!;

    expect(await run(jobId)).toMatchObject({ state: 'done', outcome: 'created' });

    const [record] = sent('lead');
    expect(record).toMatchObject({
      Name: 'Asha Menon',
      Phone: PHONE,
      Pincode: '560064',
      Vehicle_Model_Interested: NEXUS,
      Colour_Preference: 'Carbon Knight',
      Dealer_Name: 'Ampere Indiranagar',
      Dealer_ID: RG_MOTORS,
      'Is_There_Anything_We_Can_Help_You_With?': '',
      utm_source: 'google',
      utm_campaign: 'gmax_launch',
      utm_layout: 'buy_variants',
      Website_Lead_ID: leadId,
    });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.crmLeadId).toMatch(/^\d{19}$/);
    expect((await job(jobId)).crmLeadId).toBe(lead.crmLeadId);
  });

  it('accepts the CRM’s duplicate rule as done, and keeps the existing lead it names', async () => {
    const existing = await crm.createLead({ Name: 'x', Phone: PHONE, Pincode: '560064', Website_Lead_ID: 'other' });
    const existingId = existing.kind === 'accepted' ? existing.leadId : 'x';
    const leadId = await makeLead();
    const jobId = (await enqueueLeadSync(prisma, leadId))!;

    expect(await run(jobId)).toMatchObject({ state: 'done', outcome: 'duplicate' });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId).toBe(existingId);
    expect((await job(jobId)).crmLeadId).toBe(existingId);
  });

  it('a duplicate that names no lead is still done, with nothing to keep', async () => {
    const before = new FakeCrmClient(Date.now, false);
    await before.createLead({ Name: 'x', Phone: PHONE, Pincode: '560064', Website_Lead_ID: 'other' });
    const leadId = await makeLead();

    expect(await run((await enqueueLeadSync(prisma, leadId))!, before)).toMatchObject({ state: 'done', outcome: 'duplicate' });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId).toBeNull();
  });

  it('does not file a duplicate’s lead under a number the customer has since changed', async () => {
    const leadId = await makeLead();
    const jobId = (await enqueueLeadSync(prisma, leadId))!;
    const changing = stub(async () => {
      // The customer edits their number while the answer is on its way.
      await prisma.lead.update({ where: { id: leadId }, data: { phoneHash: 'f'.repeat(64) } });
      return {
        kind: 'rejected',
        category: 'rule_failure',
        message: 'Duplicate Lead: Active Lead already exists in the system',
        leadId: '1456765000001809001',
      };
    });

    expect(await run(jobId, changing)).toMatchObject({ state: 'done', outcome: 'duplicate' });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId).toBeNull();
  });

  it('retries a CRM failure later, with backoff', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead()))!;
    crm.failNext('lead', 'api_failure');

    const at = soon();
    expect(await run(jobId, crm, at)).toMatchObject({ state: 'retry' });
    const waiting = await job(jobId);
    expect(waiting).toMatchObject({
      status: 'pending',
      attempts: 1,
      ambiguous: false,
      lastError: 'api_failure: Lead creation failed due to technical reasons',
    });
    expect(waiting.nextAttemptAt.getTime()).toBe(at.getTime() + MINUTE);

    expect(await run(jobId, crm, new Date(at.getTime() + 30_000))).toMatchObject({ state: 'skipped' });
    expect(await run(jobId, crm, new Date(at.getTime() + 61_000))).toMatchObject({ state: 'done', outcome: 'created' });
  });

  it('never calls a lead retry ambiguous — the CRM refuses a second lead for the number anyway', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead()))!;
    crm.failNext('lead', 'unreachable');
    await run(jobId);
    expect((await job(jobId)).ambiguous).toBe(false);
  });

  it('gives up after the last attempt, and can be given a fresh start', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead()))!;
    const failing = stub(async () => ({ kind: 'rejected', category: 'api_failure', message: 'Lead creation failed due to technical reasons', leadId: null }));

    let at = soon();
    for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
      const result = await run(jobId, failing, at);
      expect(result.state).toBe(i < MAX_ATTEMPTS ? 'retry' : 'dead');
      at = new Date((await job(jobId)).nextAttemptAt.getTime() + 1);
    }
    expect(await job(jobId)).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS });

    expect(await requeueDeadJobs(prisma)).toBe(1);
    expect(await job(jobId)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(await run(jobId)).toMatchObject({ state: 'done', outcome: 'created' });
  });

  it('gives up at once when the CRM says fields are missing — retrying cannot help', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead()))!;
    const result = await run(jobId, stub(async () => ({ kind: 'rejected', category: 'rule_failure', message: 'Mandatory fields are missing', leadId: null })));
    expect(result).toMatchObject({ state: 'dead' });
  });

  it('skips the CRM when it already knows the customer', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead({ crmLeadId: '1456765000001736114' })))!;
    expect(await run(jobId)).toMatchObject({ state: 'done', outcome: 'already_linked' });
    expect(crm.calls).toHaveLength(0);
  });

  it('keeps the phone number out of the job’s error log, even when the CRM echoes it', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead()))!;
    await run(
      jobId,
      stub(async () => ({
        kind: 'rejected',
        category: 'api_failure',
        message: 'Lead creation failed for +919876543210 (debug: Phone=9876543210)',
        leadId: null,
      })),
    );
    const failed = await job(jobId);
    expect(failed.lastError).toContain('api_failure: Lead creation failed for');
    expect(JSON.stringify(failed)).not.toContain('9876543210');
  });

  it('keeps it out when our own code fails with the number in the message', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead()))!;
    await run(jobId, stub(async () => { throw new Error('bad value +919876543210'); }));
    expect(JSON.stringify(await job(jobId))).not.toContain('9876543210');
  });

  it('spends no attempt, and waits five minutes, when there is no Zoho token', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead()))!;
    const at = soon();
    const result = await run(jobId, stub(async () => ({ kind: 'unreachable', reason: 'token_invalid_code', ambiguous: false })), at);

    expect(result).toMatchObject({ state: 'retry', tokenFailure: true });
    const waiting = await job(jobId);
    expect(waiting).toMatchObject({ status: 'pending', attempts: 0, lastError: 'unreachable: token_invalid_code' });
    expect(waiting.nextAttemptAt.getTime()).toBe(at.getTime() + 5 * MINUTE);
  });

  it('stops a run at the first token failure instead of asking Zoho once per job', async () => {
    for (const phone of ['+919000000001', '+919000000002', '+919000000003']) {
      await enqueueLeadSync(prisma, await makeLead({ phone }));
    }
    let calls = 0;
    const noToken = stub(async () => {
      calls += 1;
      return { kind: 'unreachable', reason: 'token_Access Denied', ambiguous: false };
    });
    expect(await runDueJobs(prisma, noToken, { now: () => soon() })).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it('does not start a send it has no time to finish', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead()))!;
    const at = soon();
    const result = await runJob(prisma, crm, jobId, at, { deadline: Date.now() + 3000 });

    expect(result).toMatchObject({ state: 'retry' });
    expect(crm.calls).toHaveLength(0);
    const waiting = await job(jobId);
    expect(waiting).toMatchObject({ status: 'pending', attempts: 0 });
    expect(waiting.nextAttemptAt.getTime()).toBe(at.getTime() + MINUTE);
  });
});

/* ------------------------------------------------------------------ */

describe('a test ride', () => {
  it('attaches to the CRM lead we already have, with the booking exactly as Greaves specify', async () => {
    const leadId = await makeLead();
    await run((await enqueueLeadSync(prisma, leadId))!);
    const crmLeadId = (await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId;
    const rideId = await makeRide(leadId);

    expect(await run((await enqueueTestRideSync(prisma, rideId))!)).toMatchObject({ state: 'done', outcome: 'linked' });

    expect(sent('test_ride')[0]).toMatchObject({
      Zoho_CRM_Lead_ID: crmLeadId,
      Test_Ride_Location: 'Dealer',
      Test_Ride_Date_Time: '04/11/2026',
      Time_Slot: '01:00 PM - 03:00 PM',
      'Is_There_Anything_We_Can_Help_You_With?': 'Offers,Brochure',
      Vehicle_Model_Interested: NEXUS,
      Dealer_ID: RG_MOTORS,
      Website_Lead_ID: leadId,
    });
    const ride = await prisma.testRide.findUniqueOrThrow({ where: { id: rideId } });
    expect(ride.crmTestRideId).toMatch(/^\d{19}$/);
    expect(crm.ridesOn(crmLeadId!)).toHaveLength(1);
  });

  it('lets the CRM make the lead when the lead job has not run', async () => {
    const leadId = await makeLead();
    const rideId = await makeRide(leadId);

    expect(await run((await enqueueTestRideSync(prisma, rideId))!)).toMatchObject({ state: 'done', outcome: 'created' });
    expect(sent('test_ride')[0]!.Zoho_CRM_Lead_ID).toBe('');
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId).toMatch(/^\d{19}$/);
  });

  it('after a duplicate lead, sends the ride to the existing CRM lead by its id', async () => {
    const existing = await crm.createLead({ Name: 'x', Phone: PHONE, Pincode: '560064', Website_Lead_ID: 'older' });
    const existingId = existing.kind === 'accepted' ? existing.leadId : 'x';
    const leadId = await makeLead();
    await run((await enqueueLeadSync(prisma, leadId))!); // duplicate, naming the existing lead
    const rideId = await makeRide(leadId);

    expect(await run((await enqueueTestRideSync(prisma, rideId))!)).toMatchObject({ outcome: 'linked' });
    expect(sent('test_ride')[0]!.Zoho_CRM_Lead_ID).toBe(existingId);
    expect(crm.ridesOn(existingId!)).toHaveLength(1);
  });

  it('after a duplicate that names no lead, the CRM still maps the ride by number, and we remember it', async () => {
    const before = new FakeCrmClient(Date.now, false);
    const existing = await before.createLead({ Name: 'x', Phone: PHONE, Pincode: '560064', Website_Lead_ID: 'older' });
    const leadId = await makeLead();
    await run((await enqueueLeadSync(prisma, leadId))!, before);
    const rideId = await makeRide(leadId);

    expect(await run((await enqueueTestRideSync(prisma, rideId))!, before)).toMatchObject({ outcome: 'mapped_to_existing_lead' });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId).toBe(
      existing.kind === 'accepted' ? existing.leadId : 'x',
    );
  });

  it('when the CRM no longer knows our lead id, forgets it and sends again', async () => {
    const leadId = await makeLead();
    await run((await enqueueLeadSync(prisma, leadId))!);
    const oldId = (await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId!;
    crm.forgetLead(oldId);

    const result = await run((await enqueueTestRideSync(prisma, await makeRide(leadId)))!);

    expect(result).toMatchObject({ state: 'done', outcome: 'created' });
    expect(sent('test_ride').map((r) => r.Zoho_CRM_Lead_ID)).toEqual([oldId, '']);
    const newId = (await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).crmLeadId;
    expect(newId).not.toBe(oldId);
    expect(newId).toMatch(/^\d{19}$/);
  });

  it('after a timeout that DID land, finds the ride instead of making a second one', async () => {
    const leadId = await makeLead();
    await run((await enqueueLeadSync(prisma, leadId))!);
    const jobId = (await enqueueTestRideSync(prisma, await makeRide(leadId)))!;

    crm.failNext('test_ride', 'timeout_after_commit');
    const at = soon();
    expect(await run(jobId, crm, at)).toMatchObject({ state: 'retry' });
    expect(await job(jobId)).toMatchObject({ ambiguous: true });

    expect(await run(jobId, crm, new Date(at.getTime() + 61_000))).toMatchObject({ state: 'done', outcome: 'recovered' });
    expect(crm.rideCount).toBe(1);
    expect(sent('test_ride')).toHaveLength(1);
    expect((await prisma.testRide.findFirstOrThrow()).crmTestRideId).toMatch(/^\d{19}$/);
  });

  it('after a timeout that did NOT land, looks, finds nothing, and sends', async () => {
    const leadId = await makeLead();
    await run((await enqueueLeadSync(prisma, leadId))!);
    const jobId = (await enqueueTestRideSync(prisma, await makeRide(leadId)))!;

    crm.failNext('test_ride', 'unreachable');
    const at = soon();
    await run(jobId, crm, at);
    expect(await run(jobId, crm, new Date(at.getTime() + 61_000))).toMatchObject({ outcome: 'linked' });
    expect(crm.calls.map((c) => c.method)).toEqual(['lead', 'test_ride', 'find', 'test_ride']);
    expect(crm.rideCount).toBe(1);
  });

  it('sends anyway if the look-up itself fails — a duplicate ride is chosen over a lost one', async () => {
    const leadId = await makeLead();
    await run((await enqueueLeadSync(prisma, leadId))!);
    const jobId = (await enqueueTestRideSync(prisma, await makeRide(leadId)))!;

    crm.failNext('test_ride', 'timeout_after_commit');
    crm.failNext('find', 'lookup_fails');
    const at = soon();
    await run(jobId, crm, at);
    expect(await run(jobId, crm, new Date(at.getTime() + 61_000))).toMatchObject({ state: 'done' });

    expect(crm.calls.map((c) => c.method)).toEqual(['lead', 'test_ride', 'find', 'test_ride']);
    // The known cost: the first send had landed, so the CRM now has two.
    expect(crm.rideCount).toBe(2);
  });

  it('recovers when the worker died mid-send, after the CRM had written the ride', async () => {
    const leadId = await makeLead();
    await run((await enqueueLeadSync(prisma, leadId))!);
    const jobId = (await enqueueTestRideSync(prisma, await makeRide(leadId)))!;

    // Writes to the CRM, then blows up before we hear the answer.
    const dies: CrmClient = {
      name: 'dies',
      createLead: (r) => crm.createLead(r),
      createTestRide: async (r) => {
        await crm.createTestRide(r);
        throw new Error('process killed');
      },
      findTestRides: (id, at) => crm.findTestRides(id, at),
    };
    const at = soon();
    expect(await run(jobId, dies, at)).toMatchObject({ state: 'retry' });
    expect(await job(jobId)).toMatchObject({ ambiguous: true });

    expect(await run(jobId, crm, new Date(at.getTime() + 61_000))).toMatchObject({ outcome: 'recovered' });
    expect(crm.rideCount).toBe(1);
  });

  it('with no CRM lead id to look under, sends again', async () => {
    const jobId = (await enqueueTestRideSync(prisma, await makeRide(await makeLead())))!;
    crm.failNext('test_ride', 'unreachable');
    const at = soon();
    await run(jobId, crm, at);
    expect(await run(jobId, crm, new Date(at.getTime() + 61_000))).toMatchObject({ outcome: 'created' });
    expect(crm.calls.map((c) => c.method)).toEqual(['test_ride', 'test_ride']);
  });

  it('waits, without sending, until the scooter has a CRM vehicle id', async () => {
    await prisma.crmVehicleModel.deleteMany({});
    const jobId = (await enqueueTestRideSync(prisma, await makeRide(await makeLead())))!;

    const at = soon();
    const result = await run(jobId, crm, at);
    expect(result).toMatchObject({ state: 'retry' });
    expect(result.error).toContain('pnpm crm sync-models');
    expect(crm.calls).toHaveLength(0);

    await prisma.crmVehicleModel.create({ data: { modelCode: 'nexus-ex-plus', crmId: NEXUS, crmName: 'Nexus EX+' } });
    expect(await run(jobId, crm, new Date(at.getTime() + 61_000))).toMatchObject({ state: 'done' });
  });

  it('sends a booking from before the multi-topic change with its one topic', async () => {
    const rideId = await makeRide(await makeLead(), { helpTopics: [], helpTopic: 'brochure' });
    await run((await enqueueTestRideSync(prisma, rideId))!);
    expect(sent('test_ride')[0]!['Is_There_Anything_We_Can_Help_You_With?']).toBe('Brochure');
  });

  it('waits for the customer’s lead to finish sending, then attaches to it — never two leads', async () => {
    const leadId = await makeLead();
    const leadJob = (await enqueueLeadSync(prisma, leadId))!;
    const rideJob = (await enqueueTestRideSync(prisma, await makeRide(leadId)))!;

    // Another worker is mid-way through sending the lead…
    await prisma.crmJob.update({
      where: { id: leadJob },
      data: { status: 'processing', attempts: 1, lockedUntil: new Date(Date.now() + 5 * MINUTE) },
    });
    const created = await crm.createLead({ Name: 'x', Phone: PHONE, Pincode: '560064', Website_Lead_ID: leadId });
    const crmLeadId = created.kind === 'accepted' ? created.leadId! : 'x';
    // …and finishes 600 ms later.
    setTimeout(() => {
      void prisma.$transaction([
        prisma.lead.update({ where: { id: leadId }, data: { crmLeadId } }),
        prisma.crmJob.update({ where: { id: leadJob }, data: { status: 'done', lockedUntil: null } }),
      ]);
    }, 600);

    const started = Date.now();
    expect(await run(rideJob)).toMatchObject({ state: 'done', outcome: 'linked' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    expect(sent('test_ride')[0]!.Zoho_CRM_Lead_ID).toBe(crmLeadId);
    expect(crm.leadCount).toBe(1);
  });

  it('does not wait on a lead send whose worker died', async () => {
    const leadId = await makeLead();
    const leadJob = (await enqueueLeadSync(prisma, leadId))!;
    await prisma.crmJob.update({
      where: { id: leadJob },
      data: { status: 'processing', attempts: 1, lockedUntil: new Date(Date.now() - 1000) },
    });

    const started = Date.now();
    await run((await enqueueTestRideSync(prisma, await makeRide(leadId)))!);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(crm.rideCount).toBe(1);
  });

  it('holds a ride while the customer’s new number is unverified, then sends it with the new one', async () => {
    const leadId = await makeLead();
    const jobId = (await enqueueTestRideSync(prisma, await makeRide(leadId)))!;
    await changeNumber(leadId, '+919123456780');

    const at = soon();
    const held = await run(jobId, crm, at);
    expect(held).toMatchObject({ state: 'retry' });
    expect(held.error).toContain('not verified');
    expect(crm.calls).toHaveLength(0);

    await verify(leadId);
    expect(await run(jobId, crm, new Date(at.getTime() + 61_000))).toMatchObject({ state: 'done' });
    expect(sent('test_ride')[0]!.Phone).toBe('+919123456780');
  });

  it('lets a lead wait for its customer’s ride in flight, too', async () => {
    const leadId = await makeLead();
    const rideJob = (await enqueueTestRideSync(prisma, await makeRide(leadId)))!;
    const leadJob = (await enqueueLeadSync(prisma, leadId))!;
    await prisma.crmJob.update({
      where: { id: rideJob },
      data: { status: 'processing', attempts: 1, lockedUntil: new Date(Date.now() + 5 * MINUTE) },
    });
    const crmLeadId = '1456765000001700002';
    setTimeout(() => {
      void prisma.$transaction([
        prisma.lead.update({ where: { id: leadId }, data: { crmLeadId } }),
        prisma.crmJob.update({ where: { id: rideJob }, data: { status: 'done', lockedUntil: null } }),
      ]);
    }, 600);

    // Once the ride has landed, the CRM knows the customer: nothing to send.
    expect(await run(leadJob)).toMatchObject({ state: 'done', outcome: 'already_linked' });
    expect(sent('lead')).toHaveLength(0);
  });

  it('leaves a busy job for the next run when told not to wait', async () => {
    const leadId = await makeLead();
    const leadJob = (await enqueueLeadSync(prisma, leadId))!;
    const rideJob = (await enqueueTestRideSync(prisma, await makeRide(leadId)))!;
    await prisma.crmJob.update({
      where: { id: leadJob },
      data: { status: 'processing', attempts: 1, lockedUntil: new Date(Date.now() + 5 * MINUTE) },
    });

    const started = Date.now();
    expect(await runJob(prisma, crm, rideJob, soon(), { waitForSibling: false })).toMatchObject({ state: 'skipped' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect((await job(rideJob)).status).toBe('pending');
  });

  it('does not send a ride that is no longer booked', async () => {
    const rideId = await makeRide(await makeLead(), { status: 'cancelled' });
    expect(await run((await enqueueTestRideSync(prisma, rideId))!)).toMatchObject({ outcome: 'not_booked' });
    expect(crm.calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */

describe('running safely', () => {
  it('sends once when five workers grab the same job', async () => {
    const jobId = (await enqueueTestRideSync(prisma, await makeRide(await makeLead())))!;
    const at = soon();

    const results = await Promise.all(Array.from({ length: 5 }, () => run(jobId, crm, at)));

    expect(results.filter((r) => r.state === 'done')).toHaveLength(1);
    expect(results.filter((r) => r.state === 'skipped')).toHaveLength(4);
    expect(sent('test_ride')).toHaveLength(1);
  });

  it('takes over a job whose worker’s claim ran out', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead()))!;
    await prisma.crmJob.update({
      where: { id: jobId },
      data: { status: 'processing', lockedUntil: new Date(Date.now() - 1000), attempts: 1 },
    });

    const results = await runDueJobs(prisma, crm, { now: () => soon() });
    expect(results).toEqual([expect.objectContaining({ jobId, state: 'done' })]);
  });

  it('does not let a worker that lost its claim overwrite the one that took over', async () => {
    const jobId = (await enqueueLeadSync(prisma, await makeLead()))!;
    const takeover = new Date(Date.now() + 99 * MINUTE);

    // Mid-send, another worker claims the job.
    const slow = stub(async () => {
      await prisma.crmJob.update({ where: { id: jobId }, data: { lockedUntil: takeover } });
      return { kind: 'accepted', message: 'Lead created successfully', leadId: '1', testRideId: null };
    });

    expect(await run(jobId, slow)).toMatchObject({ state: 'skipped' });
    expect(await job(jobId)).toMatchObject({ status: 'processing', lockedUntil: takeover, outcome: null });
  });

  it('runs what is due, oldest first, and leaves what is not', async () => {
    const first = (await enqueueLeadSync(prisma, await makeLead()))!;
    const second = (await enqueueLeadSync(prisma, await makeLead({ phone: '+919123456780' })))!;
    const later = (await enqueueLeadSync(prisma, await makeLead({ phone: '+919123456781' })))!;
    await prisma.crmJob.update({ where: { id: later }, data: { nextAttemptAt: new Date(Date.now() + 60 * MINUTE) } });

    const results = await runDueJobs(prisma, crm, { now: () => soon() });

    expect(results.map((r) => r.jobId)).toEqual([first, second]);
    expect((await job(later)).status).toBe('pending');
  });

  it('respects the limit', async () => {
    for (const phone of ['+919000000001', '+919000000002', '+919000000003']) {
      await enqueueLeadSync(prisma, await makeLead({ phone }));
    }
    expect(await runDueJobs(prisma, crm, { limit: 2, now: () => soon() })).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */

describe('reconcile', () => {
  const tenMinutesOn = () => new Date(Date.now() + 10 * MINUTE);

  it('queues a verified lead and a booked ride that never got a job', async () => {
    const leadId = await makeLead();
    const rideId = await makeRide(leadId);

    expect(await reconcileMissingJobs(prisma, { now: tenMinutesOn() })).toEqual({ leads: 1, testRides: 1 });
    expect(await prisma.crmJob.findMany({ select: { dedupeKey: true } })).toEqual(
      expect.arrayContaining([{ dedupeKey: expect.stringMatching(`^lead:${leadId}:`) }, { dedupeKey: `test_ride:${rideId}` }]),
    );
    expect(await reconcileMissingJobs(prisma, { now: tenMinutesOn() })).toEqual({ leads: 0, testRides: 0 });
  });

  it('leaves alone what should not go, or is not ready', async () => {
    await makeLead({ verified: false });
    await makeLead({ phone: '+919123456780', crmLeadId: '1456765000001736114' });
    await makeRide(await makeLead({ phone: '+919123456781', verified: false }), { status: 'cancelled' });
    const queued = await makeLead({ phone: '+919123456782' });
    await enqueueLeadSync(prisma, queued);

    expect(await reconcileMissingJobs(prisma, { now: tenMinutesOn() })).toEqual({ leads: 0, testRides: 0 });
  });

  it('never sweeps up old records — only a request that died moments ago', async () => {
    const leadId = await makeLead();
    await makeRide(leadId);
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    await prisma.lead.update({ where: { id: leadId }, data: { createdAt: threeDaysAgo } });
    await prisma.$executeRaw`UPDATE leads SET updated_at = ${threeDaysAgo}`;
    await prisma.$executeRaw`UPDATE test_ride_bookings SET created_at = ${threeDaysAgo}`;

    expect(await reconcileMissingJobs(prisma, { now: tenMinutesOn() })).toEqual({ leads: 0, testRides: 0 });
  });

  it('gets the same answer when the database session is not in UTC', async () => {
    await makeRide(await makeLead());
    const queued = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Kolkata'`;
      // Fifty minutes on, well past the grace period.
      return reconcileMissingJobs(tx as unknown as PrismaClient, { now: new Date(Date.now() + 50 * MINUTE), graceMs: 2 * MINUTE });
    });
    expect(queued).toEqual({ leads: 1, testRides: 1 });

    await resetDatabase(prisma);
    await prisma.dealer.create({ data: { dealerCode: 'AMP-S-001', name: 'Ampere Indiranagar', active: true } });
    await makeRide(await makeLead());
    const none = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Kolkata'`;
      // Just created, so inside the grace period. Read with the session's zone
      // wrongly applied, the rows would look 5½ hours old and be swept.
      return reconcileMissingJobs(tx as unknown as PrismaClient, { now: new Date() });
    });
    expect(none).toEqual({ leads: 0, testRides: 0 });
  });

  it('gives a request still in flight its grace period', async () => {
    await makeRide(await makeLead());
    expect(await reconcileMissingJobs(prisma, { now: new Date() })).toEqual({ leads: 0, testRides: 0 });
  });
});
