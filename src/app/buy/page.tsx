import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { SESSION_COOKIE, parseSession } from '@/lib/crypto/session';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { attributionOf, parsePrefill, type RawSearchParams } from './prefill';
import { JOURNEY_COOKIE } from './journey-state';
import { loadResume } from './resume';
import { BuyJourney } from './BuyJourney';
import { decideGate, pincodeGateActive } from './gate';
import { PincodeGate } from './PincodeGate';

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
 * During the Zoho pilot a new visitor first gets the pincode popup, and is
 * sent on to Goal App from here, by redirect, when no pilot dealer serves the
 * pincode (gate.ts).
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
  const params = await searchParams;
  const prefill = parsePrefill(params, {
    referer: (await headers()).get('referer'),
  });

  // Invalid values are dropped silently for the customer and logged for us.
  // Cut short: they come straight from whoever wrote the link.
  if (prefill.dropped.length > 0) {
    console.warn(
      '[buy] ignored invalid prefill parameters',
      prefill.dropped.slice(0, 10).map((value) => value.slice(0, 80)),
    );
  }

  const cookieStore = await cookies();
  const resume = await loadResume(prisma, {
    session: parseSession(cookieStore.get(SESSION_COOKIE)?.value),
    journeyRaw: cookieStore.get(JOURNEY_COOKIE)?.value,
    prefill,
  });

  // During the Zoho pilot, a new visitor is asked their pincode first, and
  // sent to Goal App if no pilot dealer serves it. A journey already under
  // way is not asked again. See gate.ts.
  const gate = !resume && pincodeGateActive() ? await decideGate(prisma, params, prefill) : null;
  if (gate?.kind === 'goal-app') {
    // A count for the pilot report; nothing about the customer.
    console.info('[gate] sent to goal app');
    redirect(gate.href);
  }
  if (gate?.kind === 'journey') console.info('[gate] pilot dealer');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        {gate?.kind === 'ask' ? (
          <PincodeGate
            carried={gate.carried}
            error={gate.error}
            modelCode={prefill.modelCode}
            colourCode={prefill.colourCode}
          />
        ) : (
          <BuyJourney
            prefill={prefill}
            attribution={attributionOf(prefill)}
            resume={resume}
            idleSeconds={env.sessionIdleSeconds}
            buyEnabled={env.buyNowEnabled}
            otpRequired={env.otpRequired}
            goalAppUrl={env.goalAppUrl}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
