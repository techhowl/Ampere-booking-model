import type { NextRequest } from 'next/server';

/**
 * The client's address, as seen through Caddy on the droplet.
 *
 * Only ever used for rate limiting and consent records. Never joined to a
 * phone number in a log line.
 */
export function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip');
}
