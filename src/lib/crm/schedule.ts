import { after } from 'next/server';
import { prisma } from '@/lib/db';
import { getCrmClient } from './client';
import { enqueueLeadSync, enqueueTestRideSync, LEAD_HOLD_MS, runDueJobs, runJob } from './jobs';

/**
 * The request-side half of the CRM sync: queue a job, then send it once the
 * response has gone.
 *
 * Nothing here may fail the customer's request. Queueing errors are logged
 * and left to the reconcile pass in /api/cron/crm-sync, which finds verified
 * leads and booked rides that have no job.
 */

/**
 * The routes that queue jobs run for at most 60 seconds (maxDuration), and
 * after() runs inside that. Everything here finishes by 50 s, so no send is
 * cut off mid-flight by the platform.
 */
const DEADLINE_MS = 50_000;

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : 'unknown';
}

function sendAfterResponse(jobId: string | null): void {
  if (!jobId) return;
  after(async () => {
    const deadline = Date.now() + DEADLINE_MS;
    try {
      const client = getCrmClient();
      // Held: queued, and sent once the real CRM is switched on.
      if (!client) return;
      await runJob(prisma, client, jobId, new Date(), { deadline });
      // Low-traffic deployments have no minute-by-minute cron; let each
      // request carry a few retries that have come due, in the time left.
      await runDueJobs(prisma, client, { limit: 3, deadline });
    } catch (error) {
      console.error('[crm] background send failed; the cron will retry', { jobId, error: describe(error) });
    }
  });
}

/**
 * Not sent now: it waits for the booking, which sends it with everything the
 * customer chose. See LEAD_HOLD_MS. The run after this response still carries
 * any jobs that have come due.
 */
export async function queueLeadSync(leadId: string): Promise<void> {
  try {
    sendAfterResponse(await enqueueLeadSync(prisma, leadId, { holdMs: LEAD_HOLD_MS }));
  } catch (error) {
    console.error('[crm] could not queue a lead; reconcile will', { error: describe(error) });
  }
}

export async function queueTestRideSync(testRideId: string): Promise<void> {
  try {
    sendAfterResponse(await enqueueTestRideSync(prisma, testRideId));
  } catch (error) {
    console.error('[crm] could not queue a test ride; reconcile will', { error: describe(error) });
  }
}
