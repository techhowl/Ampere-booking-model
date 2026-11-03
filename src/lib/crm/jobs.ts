import type { CrmJob, Dealer, Lead, Prisma, PrismaClient, TestRide } from '@prisma/client';
import { getModel } from '@/lib/catalog/catalog';
import { decryptPhone } from '@/lib/crypto/phone';
import {
  buildLeadRecord,
  buildTestRideRecord,
  crmSlotStart,
  type LeadSnapshot,
  type PageLayout,
  type TestRideSnapshot,
} from './payload';
import type { CrmClient, CrmResult } from './types';

/**
 * Delivering leads and test rides to Greaves CRM.Next.
 *
 * A job row is written in the request — cheap, and in our own database — and
 * sent after the response has gone. The customer never waits on the CRM,
 * which has taken 16 seconds to answer, and a CRM outage never fails a
 * booking. Retries back off for about three days; then the job is "dead" and
 * waits for a person (`pnpm crm status`, `pnpm crm requeue`).
 *
 * What makes this safe to run from several places at once — after() in the
 * request, the cron, a second instance:
 *
 *   - claiming a job is one conditional UPDATE, so exactly one worker wins it
 *   - the claim expires, so a worker that dies mid-send does not strand it
 *   - writing the result is fenced on the claim, so a worker whose claim
 *     expired cannot overwrite the one that took over
 *
 * And what makes a retry safe when the CRM has no idempotency at all: before
 * a test ride is sent it is marked in flight, and a ride whose last send was
 * in flight or timed out is LOOKED UP in the CRM before it is sent again.
 */

export const MAX_ATTEMPTS = 12;

/** Minutes to wait after the nth failed attempt. About three days in all. */
const BACKOFF_MINUTES = [1, 5, 15, 30, 60, 120, 240, 480, 720, 1440, 1440];

/** Longer than one attempt can take: a token, a lookup and two sends at 30 s. */
const CLAIM_MS = 10 * 60_000;

/**
 * One customer's jobs never run at the same time. A lead and a ride sent
 * together can each find no lead for the number and each make one: two leads
 * for one customer. A job that finds its sibling in flight waits this long
 * for it, then leaves itself for the next run.
 */
const SIBLING_WAIT_MS = 20_000;
const SIBLING_POLL_MS = 250;

/** A send is not started with less than this left before the caller's deadline. */
const MIN_SEND_MS = 8_000;
/** No time left in this run: try again soon. Not the job's fault, so no attempt is spent. */
const OUT_OF_TIME_DELAY_MS = 60_000;
/**
 * No token: every job is blocked alike. Wait, spend no attempt — a revoked
 * refresh token must not kill three days of leads — and stop the run rather
 * than hammer Zoho's rate-limited token endpoint once per job.
 */
const TOKEN_FAILURE_DELAY_MS = 5 * 60_000;

export function retryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1;
  return (BACKOFF_MINUTES[index] ?? 1440) * 60_000;
}

/* ------------------------------------------------------------------ */
/* Enqueueing                                                          */
/* ------------------------------------------------------------------ */

/**
 * Queue a verified lead. One job per lead and NUMBER: a customer who changes
 * their number and verifies again is a different person to the CRM, whose
 * duplicate check is on the mobile number.
 */
export async function enqueueLeadSync(prisma: PrismaClient, leadId: string): Promise<string | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { phoneVerified: true, phoneHash: true },
  });
  // Unverified numbers stay out of the CRM: it has no "verified" flag, and a
  // dealer would ring a number that may be a typo or someone else's.
  if (!lead?.phoneVerified) return null;

  const dedupeKey = `lead:${leadId}:${lead.phoneHash}`;
  const job = await prisma.crmJob.upsert({
    where: { dedupeKey },
    create: { kind: 'lead', dedupeKey, leadId, phoneHash: lead.phoneHash },
    update: {},
    select: { id: true },
  });
  // A job closed because the number had changed comes back when that number
  // is verified again: A, then B, then A again.
  await prisma.crmJob.updateMany({
    where: { id: job.id, status: 'done', outcome: { in: ['superseded', 'not_verified'] } },
    data: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), outcome: null, completedAt: null },
  });
  return job.id;
}

export async function enqueueTestRideSync(prisma: PrismaClient, testRideId: string): Promise<string | null> {
  const ride = await prisma.testRide.findUnique({ where: { id: testRideId }, select: { leadId: true } });
  if (!ride) return null;

  const dedupeKey = `test_ride:${testRideId}`;
  const job = await prisma.crmJob.upsert({
    where: { dedupeKey },
    create: { kind: 'test_ride', dedupeKey, leadId: ride.leadId, testRideId },
    update: {},
    select: { id: true },
  });
  return job.id;
}

/* ------------------------------------------------------------------ */
/* Running                                                             */
/* ------------------------------------------------------------------ */

type Step =
  | { state: 'done'; outcome: string; crmLeadId?: string | null; crmTestRideId?: string | null }
  | {
      state: 'retry';
      error: string;
      ambiguous: boolean;
      /** Not the job's fault: wait this long and spend no attempt. */
      free?: { delayMs: number; token?: boolean };
    }
  | { state: 'dead'; error: string };

export interface RunResult {
  jobId: string;
  state: 'skipped' | 'done' | 'retry' | 'dead';
  outcome?: string;
  error?: string;
  /** No Zoho token: the caller should stop starting jobs. */
  tokenFailure?: boolean;
}

export interface RunOptions {
  /**
   * Epoch ms by which this run must be over — a serverless function's time
   * limit. Sends are fitted inside it, and none is started without time to
   * finish: a send cut off mid-flight is one that may or may not have landed.
   */
  deadline?: number;
  /** Wait for a sibling job of the same customer to finish. Default true. */
  waitForSibling?: boolean;
}

interface Context {
  prisma: PrismaClient;
  client: CrmClient;
  job: CrmJob;
  /** Our claim. Every write to the job is fenced on it. */
  lockedUntil: Date;
  deadline: number | null;
}

const done = (outcome: string, ids: { crmLeadId?: string | null; crmTestRideId?: string | null } = {}): Step => ({
  state: 'done',
  outcome,
  ...ids,
});
const retry = (error: string, ambiguous: boolean): Step => ({ state: 'retry', error, ambiguous });
const dead = (error: string): Step => ({ state: 'dead', error });
const outOfTime = (ambiguous: boolean): Step => ({
  state: 'retry',
  error: 'not enough time left in this run to send',
  ambiguous,
  free: { delayMs: OUT_OF_TIME_DELAY_MS },
});

/** A send that failed, as a retry. A token failure spends no attempt. */
function failed(result: CrmResult, ambiguous: boolean): Step {
  if (result.kind === 'unreachable' && result.reason.startsWith('token_')) {
    return { state: 'retry', error: errorOf(result), ambiguous, free: { delayMs: TOKEN_FAILURE_DELAY_MS, token: true } };
  }
  return retry(errorOf(result), ambiguous);
}

/** The timeout for the next request, or 'out' when there is no time to start one. */
function sendTimeout(context: Context): { timeoutMs?: number } | 'out' {
  if (context.deadline === null) return {};
  const left = context.deadline - Date.now();
  return left < MIN_SEND_MS ? 'out' : { timeoutMs: left - 2_000 };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Claim a job — unless another job for the same customer is in flight.
 *
 * The sibling check and the claim run under a per-customer advisory lock, so
 * two workers claiming a lead job and a ride job for one customer at the same
 * instant cannot both see "no sibling" and both go.
 */
async function claimJob(
  prisma: PrismaClient,
  jobId: string,
  now: Date,
  lockedUntil: Date,
): Promise<'claimed' | 'busy' | 'unavailable'> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.crmJob.findUnique({ where: { id: jobId }, select: { leadId: true } });
    if (!row) return 'unavailable';
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm-lead:${row.leadId}`}))::text AS locked`;

    const sibling = await tx.crmJob.count({
      where: { leadId: row.leadId, id: { not: jobId }, status: 'processing', lockedUntil: { gt: now } },
    });
    if (sibling > 0) return 'busy';

    const claimed = await tx.crmJob.updateMany({
      where: {
        id: jobId,
        OR: [
          { status: 'pending', nextAttemptAt: { lte: now } },
          // A claim that ran out: its worker died, or is hopelessly late.
          { status: 'processing', lockedUntil: { lt: now } },
        ],
      },
      data: { status: 'processing', lockedUntil, attempts: { increment: 1 } },
    });
    return claimed.count === 1 ? 'claimed' : 'unavailable';
  });
}

export async function runJob(
  prisma: PrismaClient,
  client: CrmClient,
  jobId: string,
  now: Date = new Date(),
  options: RunOptions = {},
): Promise<RunResult> {
  const deadline = options.deadline ?? null;
  const lockedUntil = new Date(now.getTime() + CLAIM_MS);

  let claim = await claimJob(prisma, jobId, now, lockedUntil);
  if (options.waitForSibling !== false) {
    const waitUntil = Math.min(Date.now() + SIBLING_WAIT_MS, (deadline ?? Infinity) - MIN_SEND_MS);
    while (claim === 'busy' && Date.now() < waitUntil) {
      await sleep(SIBLING_POLL_MS);
      claim = await claimJob(prisma, jobId, now, lockedUntil);
    }
  }
  // Busy past the wait: left pending and due, for the next run.
  if (claim !== 'claimed') return { jobId, state: 'skipped' };

  const job = await prisma.crmJob.findUniqueOrThrow({ where: { id: jobId } });
  const context: Context = { prisma, client, job, lockedUntil, deadline };

  let step: Step;
  try {
    if (job.kind === 'lead') step = await processLead(context);
    else if (job.kind === 'test_ride') step = await processTestRide(context);
    else step = dead(`unknown job kind "${job.kind}"`);
  } catch (error) {
    // Our own failure: the database, a decrypt, a payload check. Retried in
    // case it is passing, and logged loudly because it may well not be.
    // Ambiguous if a send was marked in flight before the throw.
    const current = await prisma.crmJob.findUnique({ where: { id: jobId }, select: { ambiguous: true } });
    step = retry(`internal: ${describe(error)}`, current?.ambiguous ?? job.ambiguous);
  }

  return finish(context, step, now);
}

/**
 * Everything that is due, oldest first. `budgetMs` stops it STARTING new jobs
 * once spent, so a caller inside a platform time limit can bound itself.
 */
export async function runDueJobs(
  prisma: PrismaClient,
  client: CrmClient,
  options: { limit?: number; budgetMs?: number; now?: () => Date; deadline?: number } = {},
): Promise<RunResult[]> {
  const { limit = 25, budgetMs = Number.POSITIVE_INFINITY, now = () => new Date(), deadline } = options;
  const started = Date.now();
  const at = now();

  const due = await prisma.crmJob.findMany({
    where: {
      OR: [
        { status: 'pending', nextAttemptAt: { lte: at } },
        { status: 'processing', lockedUntil: { lt: at } },
      ],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const results: RunResult[] = [];
  for (const { id } of due) {
    if (Date.now() - started > budgetMs) break;
    if (deadline !== undefined && deadline - Date.now() < MIN_SEND_MS) break;
    // A busy job is not waited for here; the next run picks it up.
    const result = await runJob(prisma, client, id, now(), { deadline, waitForSibling: false });
    results.push(result);
    // Without a token every job fails alike. Stop, rather than ask Zoho for a
    // token once per job.
    if (result.tokenFailure) break;
  }
  return results;
}

async function finish(context: Context, step: Step, now: Date): Promise<RunResult> {
  const { prisma, job, lockedUntil } = context;
  let state: RunResult['state'] = step.state;
  let data: Prisma.CrmJobUpdateManyMutationInput;

  if (step.state === 'done') {
    data = {
      status: 'done',
      outcome: step.outcome,
      crmLeadId: step.crmLeadId ?? null,
      crmTestRideId: step.crmTestRideId ?? null,
      lockedUntil: null,
      ambiguous: false,
      lastError: null,
      // The real moment, not the run's clock: the send itself can take seconds.
      completedAt: new Date(),
    };
  } else if (step.state === 'retry' && step.free) {
    data = {
      status: 'pending',
      attempts: { decrement: 1 },
      nextAttemptAt: new Date(now.getTime() + step.free.delayMs),
      lockedUntil: null,
      ambiguous: step.ambiguous,
      lastError: step.error,
    };
  } else if (step.state === 'retry' && job.attempts < MAX_ATTEMPTS) {
    data = {
      status: 'pending',
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(job.attempts)),
      lockedUntil: null,
      ambiguous: step.ambiguous,
      lastError: step.error,
    };
  } else {
    state = 'dead';
    data = {
      status: 'dead',
      lockedUntil: null,
      ambiguous: step.state === 'retry' ? step.ambiguous : false,
      lastError: step.error,
      completedAt: new Date(),
    };
  }

  const written = await prisma.crmJob.updateMany({
    where: { id: job.id, status: 'processing', lockedUntil },
    data,
  });
  const log = { jobId: job.id, kind: job.kind, attempts: job.attempts };

  if (written.count !== 1) {
    // Our claim expired and another worker has the job. Its result stands.
    console.warn('[crm] lost the claim before finishing; result discarded', log);
    return { jobId: job.id, state: 'skipped' };
  }

  if (step.state === 'done') {
    if (process.env.NODE_ENV !== 'test') console.info(`[crm] ${job.kind} ${step.outcome}`, log);
    return { jobId: job.id, state, outcome: step.outcome };
  }
  const tokenFailure = step.state === 'retry' && step.free?.token === true;
  if (state === 'dead') {
    console.error('[crm] gave up — needs a person: pnpm crm status', { ...log, error: step.error });
  } else if (tokenFailure) {
    console.error('[crm] no Zoho token — check the ZOHO_* credentials; nothing is sent until one is had', {
      ...log,
      error: step.error,
    });
  } else {
    console.warn('[crm] will retry', { ...log, error: step.error });
  }
  return { jobId: job.id, state, error: step.error, ...(tokenFailure ? { tokenFailure } : {}) };
}

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */

async function processLead(context: Context): Promise<Step> {
  const { prisma, client, job } = context;
  const lead = await prisma.lead.findUnique({ where: { id: job.leadId }, include: { dealer: true } });
  if (!lead) return dead('the lead no longer exists');

  // The customer changed their number after this job was queued. The new
  // number, once verified, has its own job.
  if (job.phoneHash && lead.phoneHash !== job.phoneHash) return done('superseded');
  if (!lead.phoneVerified) return done('not_verified');

  // A test ride got there first and the CRM already knows this customer. The
  // id is cleared whenever the number changes, so it is this number's.
  if (lead.crmLeadId) return done('already_linked', { crmLeadId: lead.crmLeadId });

  const timeout = sendTimeout(context);
  if (timeout === 'out') return outOfTime(false);

  const snapshot = await snapshotOf(prisma, lead);
  const result = await client.createLead(buildLeadRecord(snapshot), timeout);

  switch (verdictOf(result)) {
    case 'accepted': {
      const { leadId } = result as Extract<CrmResult, { kind: 'accepted' }>;
      if (leadId) {
        // Only if still empty — a test ride may have linked the active lead
        // meanwhile, and that one is authoritative — and only if the number
        // is still the one this lead was made for.
        await prisma.lead.updateMany({
          where: { id: lead.id, crmLeadId: null, phoneHash: lead.phoneHash },
          data: { crmLeadId: leadId },
        });
      }
      return done('created', { crmLeadId: leadId });
    }
    case 'duplicate': {
      // The CRM already has an active lead for this mobile. Nothing lost. The
      // answer names that lead, so keep it: this customer's test rides then go
      // to it by id, and a ride that times out can be looked up before it is
      // sent again. Same fences as a created lead.
      const existing = (result as Extract<CrmResult, { kind: 'rejected' }>).leadId;
      if (existing) {
        await prisma.lead.updateMany({
          where: { id: lead.id, crmLeadId: null, phoneHash: lead.phoneHash },
          data: { crmLeadId: existing },
        });
      }
      return done('duplicate', { crmLeadId: existing });
    }
    case 'missing_fields':
      return dead(errorOf(result));
    default:
      // Leads cannot be duplicated by a retry — the CRM refuses a second one
      // for the same number — so a lead retry is never ambiguous.
      return failed(result, false);
  }
}

/* ------------------------------------------------------------------ */
/* Test rides                                                          */
/* ------------------------------------------------------------------ */

async function processTestRide(context: Context): Promise<Step> {
  const { prisma, client, job, lockedUntil } = context;
  if (!job.testRideId) return dead('a test ride job without a test ride');
  let previousSettled = !job.ambiguous;

  const ride = await prisma.testRide.findUnique({
    where: { id: job.testRideId },
    include: { dealer: true, lead: { include: { dealer: true } } },
  });
  if (!ride) return dead('the test ride no longer exists');
  if (ride.status !== 'booked') return done('not_booked');
  if (ride.crmTestRideId) {
    return done('already_linked', { crmLeadId: ride.lead.crmLeadId, crmTestRideId: ride.crmTestRideId });
  }

  const lead = ride.lead;
  // The customer changed their number after booking and has not verified the
  // new one. Its owner is unproven, so the ride waits.
  if (!lead.phoneVerified) {
    return retry('the customer changed their number and has not verified it yet', !previousSettled);
  }
  const startsAt = crmSlotStart(ride.slotDate, ride.slotWindow);

  // The last send may have landed. The CRM would make a second ride from a
  // second send, so look first. Only possible once we know the CRM lead.
  if (job.ambiguous && lead.crmLeadId) {
    const timeout = sendTimeout(context);
    if (timeout === 'out') return outOfTime(true);
    const found = await client.findTestRides(lead.crmLeadId, startsAt, timeout);
    const landed = found?.[0];
    if (landed) return linkRide(prisma, ride, lead.phoneHash, lead.crmLeadId, landed, 'recovered');
    // An empty answer settles it. A failed lookup does not — but the ride is
    // sent anyway: a duplicate is a nuisance for the dealer, a lost ride is a
    // customer turned away at the showroom.
    previousSettled = found !== null;
  }

  const snapshot = await snapshotOf(prisma, lead, {
    modelCode: ride.modelCode,
    colourCode: ride.colourCode,
    dealer: ride.dealer,
    helpTopics: topicsOf(ride),
  });
  if (!snapshot.vehicleCrmId) {
    return retry(`no CRM vehicle id for ${ride.modelCode}; run: pnpm crm sync-models`, !previousSettled);
  }

  const record: TestRideSnapshot = {
    ...snapshot,
    mode: ride.mode === 'home' ? 'home' : 'dealer',
    slotDate: ride.slotDate,
    windowCode: ride.slotWindow,
    crmLeadId: lead.crmLeadId,
  };

  const timeout = sendTimeout(context);
  if (timeout === 'out') return outOfTime(!previousSettled);

  // From here until the answer is recorded, the ride may exist in the CRM.
  const marked = await prisma.crmJob.updateMany({
    where: { id: job.id, status: 'processing', lockedUntil },
    data: { ambiguous: true },
  });
  // Our claim is gone; the worker that holds it does the sending.
  if (marked.count !== 1) return retry('lost the claim before sending', !previousSettled);

  let result = await client.createTestRide(buildTestRideRecord(record), timeout);

  // The CRM no longer knows the lead we linked — merged, or deleted. Forget
  // it and let the CRM match the customer by number instead.
  if (verdictOf(result) === 'stale_lead_id' && record.crmLeadId) {
    await prisma.lead.updateMany({
      where: { id: lead.id, crmLeadId: record.crmLeadId },
      data: { crmLeadId: null },
    });
    const again = sendTimeout(context);
    if (again === 'out') return outOfTime(true);
    result = await client.createTestRide(buildTestRideRecord({ ...record, crmLeadId: null }), again);
  }

  switch (verdictOf(result)) {
    case 'accepted': {
      const accepted = result as Extract<CrmResult, { kind: 'accepted' }>;
      return linkRide(prisma, ride, lead.phoneHash, accepted.leadId, accepted.testRideId, rideOutcome(accepted.message));
    }
    case 'missing_fields':
      return dead(errorOf(result));
    default: {
      // A rejection is the CRM saying no to THIS send, so it settles nothing
      // about an earlier one that was in doubt.
      const thisInDoubt = result.kind === 'unreachable' && result.ambiguous;
      return failed(result, thisInDoubt || !previousSettled);
    }
  }
}

async function linkRide(
  prisma: PrismaClient,
  ride: TestRide,
  /** The number the ride was sent with. The CRM lead id belongs to it. */
  sentWithPhoneHash: string,
  crmLeadId: string | null,
  crmTestRideId: string | null,
  outcome: string,
): Promise<Step> {
  await prisma.$transaction([
    prisma.testRide.update({ where: { id: ride.id }, data: { crmTestRideId } }),
    // The CRM's answer names the customer's ACTIVE lead, which is the one to
    // link from now on even if we held a different id before — unless the
    // customer has changed their number since.
    ...(crmLeadId
      ? [prisma.lead.updateMany({ where: { id: ride.leadId, phoneHash: sentWithPhoneHash }, data: { crmLeadId } })]
      : []),
  ]);
  return done(outcome, { crmLeadId, crmTestRideId });
}

function rideOutcome(message: string): string {
  const text = message.toLowerCase();
  if (text.startsWith('existing lead updated')) return 'linked';
  // The same answer, as worded since 2026-11-03.
  if (text.startsWith('test ride created and mapped to the existing lead')) return 'linked';
  if (text.startsWith('duplicate lead')) return 'mapped_to_existing_lead';
  return 'created';
}

function topicsOf(ride: TestRide): string[] {
  if (ride.helpTopics.length > 0) return ride.helpTopics;
  return ride.helpTopic ? [ride.helpTopic] : [];
}

/* ------------------------------------------------------------------ */
/* Reading our records                                                 */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function layoutOf(sourceRaw: unknown): PageLayout {
  return isRecord(sourceRaw) && sourceRaw.view === 'variants' ? 'variants' : 'list';
}

async function snapshotOf(
  prisma: PrismaClient,
  lead: Lead & { dealer: Dealer | null },
  over: { modelCode?: string | null; colourCode?: string | null; dealer?: Dealer | null; helpTopics?: string[] } = {},
): Promise<LeadSnapshot> {
  const modelCode = over.modelCode !== undefined ? over.modelCode : lead.modelCode;
  const colourCode = over.colourCode !== undefined ? over.colourCode : lead.colourCode;
  const dealer = over.dealer !== undefined ? over.dealer : lead.dealer;

  const model = getModel(modelCode);
  const vehicle = modelCode
    ? await prisma.crmVehicleModel.findUnique({ where: { modelCode } })
    : null;

  return {
    websiteLeadId: lead.id,
    name: lead.name,
    // Decrypted here, in memory, for this one request body. Never logged.
    phoneE164: decryptPhone(lead.phoneEnc),
    pincode: lead.pincode,
    vehicleCrmId: vehicle?.crmId ?? null,
    colourName: model?.colours.find((c) => c.code === colourCode)?.name ?? null,
    dealerName: dealer?.name ?? null,
    dealerCrmId: dealer?.crmId ?? null,
    helpTopics: over.helpTopics ?? [],
    utm: isRecord(lead.utm) ? lead.utm : null,
    layout: layoutOf(lead.sourceRaw),
  };
}

/* ------------------------------------------------------------------ */
/* The CRM's answers                                                   */
/* ------------------------------------------------------------------ */

type Verdict = 'accepted' | 'duplicate' | 'missing_fields' | 'stale_lead_id' | 'retry';

/**
 * The CRM answers in prose, so its sentences are the contract. Anything not
 * recognised is retried — the sandbox returns its catch-all "technical
 * reasons" for problems that are on its side.
 */
export function verdictOf(result: CrmResult): Verdict {
  if (result.kind === 'accepted') return 'accepted';
  if (result.kind === 'unreachable') return 'retry';
  const message = result.message.toLowerCase();
  if (message.startsWith('duplicate lead')) return 'duplicate';
  if (message.includes('mandatory fields')) return 'missing_fields';
  if (message.includes('lead id is not available')) return 'stale_lead_id';
  return 'retry';
}

/**
 * Long runs of digits are blanked before anything is stored or logged. The
 * CRM's text comes from Greaves' code, which has already leaked its debug log
 * once; a mobile number must not ride along into last_error.
 */
function scrub(text: string): string {
  return text.replace(/\d{7,}/g, '[number]');
}

function errorOf(result: CrmResult): string {
  if (result.kind === 'rejected') return scrub(`${result.category}: ${result.message}`).slice(0, 500);
  if (result.kind === 'unreachable') return `unreachable: ${result.reason}`;
  return scrub(result.message);
}

function describe(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return scrub(text).slice(0, 300);
}

/* ------------------------------------------------------------------ */
/* Housekeeping                                                        */
/* ------------------------------------------------------------------ */

/**
 * Jobs that should exist and do not: a request that died between saving and
 * queueing. That happens within seconds of the save, so the look-back is
 * short — 36 hours covers a daily cron with room to spare. A long one is
 * dangerous: switching the CRM on would sweep up every old record that
 * predates the queue (which is exactly what a 7-day window once did to a
 * developer's local test data). Anything younger than the grace period is
 * left to the request that is presumably still running.
 */
export async function reconcileMissingJobs(
  prisma: PrismaClient,
  options: { now?: Date; lookbackHours?: number; graceMs?: number } = {},
): Promise<{ leads: number; testRides: number }> {
  const { now = new Date(), lookbackHours = 36, graceMs = 2 * 60_000 } = options;
  // Our columns are timestamp WITHOUT time zone, holding UTC. Prisma sends a
  // Date as timestamptz, which Postgres would shift by the session's time
  // zone; an ISO string cast to timestamp compares as the UTC it is.
  const since = new Date(now.getTime() - lookbackHours * 3_600_000).toISOString();
  const before = new Date(now.getTime() - graceMs).toISOString();

  const leads = await prisma.$queryRaw<{ id: string }[]>`
    SELECT l.id::text AS id FROM leads l
    WHERE l.phone_verified AND l.crm_lead_id IS NULL
      AND l.created_at >= ${since}::timestamp AND l.updated_at <= ${before}::timestamp
      AND NOT EXISTS (
        SELECT 1 FROM crm_jobs j WHERE j.dedupe_key = 'lead:' || l.id::text || ':' || l.phone_hash
      )
    LIMIT 200`;
  const rides = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t.id::text AS id FROM test_ride_bookings t
    WHERE t.status = 'booked' AND t.crm_test_ride_id IS NULL
      AND t.created_at >= ${since}::timestamp AND t.created_at <= ${before}::timestamp
      AND NOT EXISTS (
        SELECT 1 FROM crm_jobs j WHERE j.dedupe_key = 'test_ride:' || t.id::text
      )
    LIMIT 200`;

  for (const { id } of leads) await enqueueLeadSync(prisma, id);
  for (const { id } of rides) await enqueueTestRideSync(prisma, id);
  return { leads: leads.length, testRides: rides.length };
}

/** Give dead jobs another full run of attempts — after the cause is fixed. */
export async function requeueDeadJobs(prisma: PrismaClient, ids?: string[]): Promise<number> {
  const { count } = await prisma.crmJob.updateMany({
    where: { status: 'dead', ...(ids ? { id: { in: ids } } : {}) },
    data: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), completedAt: null },
  });
  return count;
}
