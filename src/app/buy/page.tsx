import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { SESSION_COOKIE, parseSession } from '@/lib/crypto/session';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { attributionOf, parsePrefill, type RawSearchParams } from './prefill';
import { JOURNEY_COOKIE } from './journey-state';
import { loadResume } from './resume';
import { BuyJourney } from './BuyJourney';

/**
 * /buy — the one page.
 *
 * A server component, so prefill is parsed before anything renders. No client
 * redirect, no flash of an empty form: a customer arriving from the Nexus EX+
 * page sees the Nexus EX+ on first paint.
 *
 * The same goes for a refresh: a journey still within its idle limit is read
 * back here and rendered on the step the customer was on.
 *
 * Reading cookies makes this page dynamic, so Next serves it
 * Cache-Control: private, no-store — a resumed page carries a name and must
 * never be cached by anything between us and the customer.
 */

export const metadata: Metadata = {
  title: 'Book your Ampere scooter',
  description: 'Buy online or book a free test ride on your Ampere electric scooter.',
  robots: { index: false, follow: false },
};

export default async function BuyPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const prefill = parsePrefill(await searchParams, {
    referer: (await headers()).get('referer'),
  });

  // Invalid values are dropped silently for the customer and logged for us.
  if (prefill.dropped.length > 0) {
    console.warn('[buy] ignored invalid prefill parameters', prefill.dropped);
  }

  const cookieStore = await cookies();
  const resume = await loadResume(prisma, {
    session: parseSession(cookieStore.get(SESSION_COOKIE)?.value),
    journeyRaw: cookieStore.get(JOURNEY_COOKIE)?.value,
    prefill,
  });

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <BuyJourney
          prefill={prefill}
          attribution={attributionOf(prefill)}
          resume={resume}
          idleSeconds={env.sessionIdleSeconds}
          buyEnabled={env.buyNowEnabled}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
