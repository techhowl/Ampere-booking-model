import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Liveness + database reachability, for the droplet's healthcheck and for
 * Caddy/uptime monitoring.
 *
 * Deliberately says very little. This endpoint is public, so it reports whether
 * the database answered and nothing about why it did not — no host, no driver
 * error, no version. Details go to the logs.
 */

// Never cached: a cached health check is worse than none.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();

  let database: 'up' | 'down' = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'up';
  } catch (error) {
    console.error('[health] database check failed', error);
  }

  const healthy = database === 'up';

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      database,
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
