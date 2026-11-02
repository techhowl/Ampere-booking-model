import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCrmClient } from '@/lib/crm/client';
import { reconcileMissingJobs, runDueJobs } from '@/lib/crm/jobs';
import { cronAuthorised } from '@/lib/http/cron-auth';

/**
 * POST /api/cron/crm-sync
 *
 * The scheduled half of the CRM sync. Each run:
 *
 *   1. queues any verified lead or booked test ride that has no job — a
 *      request that died between saving and queueing
 *   2. sends every job that is due, oldest first, within the time limit
 *
 * Every minute on the droplet (deploy/README.md). Vercel's plan allows a
 * daily cron, so on UAT most retries ride along with ordinary requests
 * instead — see lib/crm/schedule.ts.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Every send fits inside this, well within maxDuration. */
const DEADLINE_MS = 50_000;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  if (!cronAuthorised(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const deadline = Date.now() + DEADLINE_MS;
  try {
    const queued = await reconcileMissingJobs(prisma);
    const client = getCrmClient();
    if (!client) {
      // CRM_PROVIDER is fake outside development: everything waits in the
      // queue for the real CRM. See lib/crm/client.ts.
      return NextResponse.json({ queued, held: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const results = await runDueJobs(prisma, client, { limit: 50, deadline });

    const count = (state: string) => results.filter((r) => r.state === state).length;
    if (queued.leads + queued.testRides > 0) {
      console.warn('[cron] crm-sync queued work that had no job', queued);
    }

    return NextResponse.json(
      {
        queued,
        sent: results.length,
        done: count('done'),
        retrying: count('retry'),
        dead: count('dead'),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[cron] crm-sync failed', {
      name: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
