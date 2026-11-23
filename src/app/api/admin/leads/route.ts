import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { ADMIN_ATTEMPTS_PER_HOUR, adminIpAllowed, isAdminAuthorised } from '@/lib/admin/auth';
import { exportLeads, toCsv, type LeadSegment } from '@/lib/exports/leads-export';
import { clientIp } from '@/lib/http/request';
import { consume } from '@/lib/rate-limit/rate-limit';

/**
 * GET /api/admin/leads?segment=verified|unverified|all&format=json|csv
 *
 * Spec 14: searchable, filterable by verified, exportable for the call centre.
 *
 * This response contains full phone numbers. It is behind the admin password,
 * never cached, and every call is logged — see the note in leads-export.ts
 * about why a Google Sheet mirror of this needs Legal's sign-off.
 *
 * One request is the whole customer list, so the password is not the only
 * thing in the way (security audit V-06): ADMIN_ALLOWED_IPS, when set, limits
 * who may ask at all, and each address gets ADMIN_ATTEMPTS_PER_HOUR tries.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = clientIp(request);

  if (!adminIpAllowed(ip)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Counted before the password is checked, so guessing costs attempts.
  if (ip) {
    const decision = await consume(prisma, 'admin', [
      { kind: 'ip', subject: ip, max: ADMIN_ATTEMPTS_PER_HOUR, windowSeconds: 3600 },
    ]);
    if (!decision.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
      );
    }
  }

  if (!isAdminAuthorised(request.headers.get('authorization'))) {
    console.warn('[admin] refused lead export', { ip });
    return NextResponse.json(
      { error: 'unauthorised', message: 'Admin credentials required.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }

  const params = request.nextUrl.searchParams;
  const segment = (params.get('segment') ?? 'all') as LeadSegment;
  const format = params.get('format') ?? 'json';
  const sinceRaw = params.get('since');
  const since = sinceRaw ? new Date(sinceRaw) : undefined;

  if (!['verified', 'unverified', 'all'].includes(segment)) {
    return NextResponse.json({ error: 'invalid_segment' }, { status: 400 });
  }

  const rows = await exportLeads(prisma, {
    segment,
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
  });

  // The credential is shared, so the address is the only clue to who asked.
  console.info('[admin] lead export', { segment, format, count: rows.length, ip });

  if (format === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ampere-leads-${segment}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json(
    { segment, count: rows.length, leads: rows },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
