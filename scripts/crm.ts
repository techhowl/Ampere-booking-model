import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { MODELS } from '../src/lib/catalog/catalog';
import { crmSettings } from '../src/lib/crm/config';
import { syncDealers } from '../src/lib/crm/dealers';
import { FakeCrmClient } from '../src/lib/crm/fake';
import { reconcileMissingJobs, requeueDeadJobs, runDueJobs } from '../src/lib/crm/jobs';
import { buildLeadRecord, buildTestRideRecord, crmSlotStart } from '../src/lib/crm/payload';
import { PrismaTokenProvider } from '../src/lib/crm/token-store';
import type { CrmClient } from '../src/lib/crm/types';
import { ZohoCrmClient } from '../src/lib/crm/zoho';

/**
 * Greaves CRM.Next, by hand.
 *
 *   pnpm crm status                    what is queued, stuck or dead; what is unmapped
 *   pnpm crm send                      send everything due now (what the cron does)
 *   pnpm crm requeue [jobId ...]       dead jobs get a fresh set of attempts
 *   pnpm crm sync-models               read the CRM's vehicle ids into crm_vehicle_models
 *   pnpm crm sync-dealers [--dry-run] [--force]
 *                                      make our dealers match the CRM's dealer master
 *   pnpm crm link-dealer <code> <id>   set one dealer's CRM account id
 *   pnpm crm smoke                     SANDBOX ONLY: one real lead + test ride, end to end
 *
 * Uses whatever CRM_PROVIDER and ZOHO_* the environment has. Prints no phone
 * numbers and no secrets.
 */

const prisma = new PrismaClient();

function zohoClient(): ZohoCrmClient {
  const settings = crmSettings();
  if (settings.provider !== 'zoho') {
    throw new Error('CRM_PROVIDER is not "zoho" — this command talks to the real CRM.');
  }
  return new ZohoCrmClient(settings.zoho, new PrismaTokenProvider(prisma, settings.zoho));
}

function configuredClient(): CrmClient {
  if (crmSettings().provider === 'zoho') return zohoClient();
  // Outside development the fake HOLDS jobs (lib/crm/client.ts). Sending them
  // to a fake here would mark real leads delivered.
  if (process.env.APP_ENV !== 'development') {
    throw new Error('CRM_PROVIDER is fake here, so jobs are held until it is zoho. Nothing sent.');
  }
  return new FakeCrmClient();
}

const normalise = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

async function status(): Promise<void> {
  const settings = crmSettings();
  console.log(`CRM: ${settings.provider === 'zoho' ? (settings.sandbox ? 'Zoho SANDBOX' : 'Zoho PRODUCTION') : 'fake'}\n`);

  const groups = await prisma.crmJob.groupBy({ by: ['kind', 'status'], _count: true, orderBy: [{ kind: 'asc' }] });
  if (groups.length === 0) console.log('No jobs yet.');
  for (const g of groups) console.log(`  ${g.kind.padEnd(10)} ${g.status.padEnd(11)} ${g._count}`);

  const trouble = await prisma.crmJob.findMany({
    // Pending with an error: retrying — including token failures, which spend no attempt.
    where: { OR: [{ status: 'dead' }, { status: 'pending', lastError: { not: null } }] },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  });
  if (trouble.length > 0) {
    console.log('\nNeeds attention (newest first):');
    for (const j of trouble) {
      const when = j.status === 'dead' ? 'DEAD' : `retry ${j.nextAttemptAt.toISOString()}`;
      console.log(`  ${j.id}  ${j.kind.padEnd(9)} attempt ${j.attempts}  ${when}\n      ${j.lastError ?? ''}`);
    }
  }

  const mapped = new Set((await prisma.crmVehicleModel.findMany()).map((v) => v.modelCode));
  const unmapped = MODELS.filter((m) => !mapped.has(m.code)).map((m) => m.code);
  const dealersWithout = await prisma.dealer.count({ where: { active: true, crmId: null } });
  console.log(`\nVehicle models without a CRM id: ${unmapped.length ? unmapped.join(', ') : 'none'}`);
  console.log(`Active dealers without a CRM id: ${dealersWithout}`);
}

async function send(): Promise<void> {
  const queued = await reconcileMissingJobs(prisma);
  const results = await runDueJobs(prisma, configuredClient(), { limit: 200 });
  console.log(`queued ${queued.leads} lead(s), ${queued.testRides} test ride(s) that had no job`);
  for (const r of results) console.log(`  ${r.jobId}  ${r.state}  ${r.outcome ?? r.error ?? ''}`);
  if (results.length === 0) console.log('Nothing was due.');
}

async function requeue(ids: string[]): Promise<void> {
  const count = await requeueDeadJobs(prisma, ids.length ? ids : undefined);
  console.log(`${count} dead job(s) requeued. Run \`pnpm crm send\`, or wait for the cron.`);
}

async function syncModels(): Promise<void> {
  const crm = await zohoClient().listVehicleModels();
  console.log(`The CRM has ${crm.length} vehicle model(s).\n`);

  let problems = 0;
  for (const model of MODELS) {
    const matches = crm.filter((v) => normalise(v.name) === normalise(model.name));
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match) {
      problems += 1;
      console.log(`  ${model.code.padEnd(26)} ${matches.length === 0 ? 'NOT FOUND' : 'AMBIGUOUS'} in the CRM`);
      continue;
    }
    await prisma.crmVehicleModel.upsert({
      where: { modelCode: model.code },
      create: { modelCode: model.code, crmId: match.id, crmName: match.name },
      update: { crmId: match.id, crmName: match.name },
    });
    console.log(`  ${model.code.padEnd(26)} -> ${match.id}  "${match.name}"`);
  }

  const ours = new Set(MODELS.map((m) => normalise(m.name)));
  const extra = crm.filter((v) => !ours.has(normalise(v.name))).map((v) => v.name);
  if (extra.length) console.log(`\nIn the CRM but not on the page (ignored): ${extra.join(', ')}`);
  if (problems) {
    process.exitCode = 1;
    console.log(`\n${problems} model(s) unmatched. Test rides for them cannot be sent.`);
  }
}

async function syncDealerMaster(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const { dealers, skipped } = await zohoClient().listDealers();
  console.log(`The CRM lists ${dealers.length} active dealer(s).`);
  for (const s of skipped) console.log(`  skipped row ${s.row}: ${s.reason}`);

  const summary = await syncDealers(prisma, dealers, { dryRun, force: args.includes('--force') });
  console.log(`${dryRun ? 'Would create' : 'Created'} ${summary.created}, ${dryRun ? 'would update' : 'updated'} ${summary.updated}.`);
  console.log(`${dryRun ? 'Would retire' : 'Retired'} ${summary.retired.length} dealer(s) not in the CRM list${summary.retired.length ? `: ${summary.retired.join(', ')}` : '.'}`);
  if (summary.unlocated.length) {
    console.log(`\n${summary.unlocated.length} dealer(s) whose pincode has no location, so no radius search finds them:`);
    for (const d of summary.unlocated) console.log(`  ${d.pincode}  ${d.name}  (${d.code})`);
  }
  if (dryRun) console.log('\nDry run: nothing was changed.');
}

async function linkDealer(dealerCode: string | undefined, crmId: string | undefined): Promise<void> {
  if (!dealerCode || !crmId || !/^\d{10,30}$/.test(crmId)) {
    throw new Error('Usage: pnpm crm link-dealer <dealerCode> <crm account id (digits)>');
  }
  const dealer = await prisma.dealer.update({ where: { dealerCode }, data: { crmId } });
  console.log(`${dealer.dealerCode} (${dealer.name}) -> CRM account ${crmId}`);
}

/**
 * One lead and one test ride through the real client and the real payload
 * builders — not through our database — then the ride is looked up again.
 * The number is a dummy in the +91 90000 range and the name says to ignore it.
 */
async function smoke(): Promise<void> {
  const settings = crmSettings();
  if (settings.provider !== 'zoho' || !settings.sandbox) {
    throw new Error('smoke only runs against the Zoho SANDBOX.');
  }
  const client = zohoClient();
  const vehicle = await prisma.crmVehicleModel.findUnique({ where: { modelCode: 'nexus-ex-plus' } });
  const dealer = await prisma.dealer.findFirst({ where: { crmId: { not: null }, active: true } });
  if (!vehicle) throw new Error('No CRM id for nexus-ex-plus. Run: pnpm crm sync-models');

  const phone = `+9190000${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
  const snapshot = {
    websiteLeadId: `SMOKE-${randomUUID()}`,
    name: 'TEST Ampere Website (ignore)',
    phoneE164: phone,
    pincode: '560064',
    vehicleCrmId: vehicle.crmId,
    colourName: 'Carbon Knight',
    dealerName: dealer?.name ?? null,
    dealerCrmId: dealer?.crmId ?? null,
    helpTopics: ['offers', 'brochure'],
    utm: { utm_source: 'smoke_test', utm_campaign: 'sandbox_integration_test' },
    layout: 'list' as const,
  };

  const lead = await client.createLead(buildLeadRecord(snapshot));
  console.log('Create Lead   ', JSON.stringify(lead));
  const crmLeadId = lead.kind === 'accepted' ? lead.leadId : null;

  const slotDate = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 2));
  const ride = await client.createTestRide(
    buildTestRideRecord({ ...snapshot, mode: 'dealer', slotDate, windowCode: 'w2', crmLeadId }),
  );
  console.log('Create Ride   ', JSON.stringify(ride));

  const linkedLead = ride.kind === 'accepted' ? ride.leadId : null;
  if (linkedLead) {
    const found = await client.findTestRides(linkedLead, crmSlotStart(slotDate, 'w2'));
    console.log('Look-up       ', JSON.stringify(found));
  }

  const ok = lead.kind === 'accepted' && ride.kind === 'accepted';
  console.log(ok ? '\nSMOKE PASSED' : '\nSMOKE FAILED');
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'status':
      return status();
    case 'send':
      return send();
    case 'requeue':
      return requeue(args);
    case 'sync-models':
      return syncModels();
    case 'sync-dealers':
      return syncDealerMaster(args);
    case 'link-dealer':
      return linkDealer(args[0], args[1]);
    case 'smoke':
      return smoke();
    default:
      console.log(
        'Usage: pnpm crm <status | send | requeue [id...] | sync-models | sync-dealers [--dry-run] [--force] | link-dealer <code> <id> | smoke>',
      );
      process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
