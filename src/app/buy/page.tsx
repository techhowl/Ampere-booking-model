import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { attributionOf, parsePrefill, type RawSearchParams } from './prefill';
import { BuyJourney } from './BuyJourney';

/**
 * /buy — the one page.
 *
 * A server component, so prefill is parsed before anything renders. No client
 * redirect, no flash of an empty form: a customer arriving from the Nexus EX+
 * page sees the Nexus EX+ on first paint.
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
  const prefill = parsePrefill(await searchParams);

  // Invalid values are dropped silently for the customer and logged for us.
  if (prefill.dropped.length > 0) {
    console.warn('[buy] ignored invalid prefill parameters', prefill.dropped);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <BuyJourney prefill={prefill} attribution={attributionOf(prefill)} />
      </main>
      <SiteFooter />
    </div>
  );
}
