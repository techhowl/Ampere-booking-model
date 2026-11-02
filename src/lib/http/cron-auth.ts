import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * The scheduler's credential: `Authorization: Bearer CRON_SECRET`. Vercel Cron
 * sends exactly this; on the droplet, crontab's curl does.
 *
 * A shared secret rather than the admin password, because a scheduler holding
 * a human's credential is a bad trade.
 */
export function cronAuthorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  // Unset means closed, never open. A scheduler endpoint that falls open when
  // a variable is missing is a free button for anyone who finds it.
  if (!expected) return false;

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;

  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
