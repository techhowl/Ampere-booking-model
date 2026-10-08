import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { ReturnResolver } from './ReturnResolver';

/**
 * Where Juspay sends the customer back to.
 *
 * Spec 9, and the journey document's "gap to close": the return carries
 * order_id, dealer and amount — the SAME three fields whether the payment
 * succeeded or failed. Nothing in it says which.
 *
 * So this page reads exactly one thing from the query string: which order to
 * look up. Everything shown comes from our own record after resolution. The
 * amount on a confirmation screen must never come from a parameter the
 * customer could have edited.
 */

export const metadata: Metadata = {
  title: 'Your Ampere booking',
  robots: { index: false, follow: false },
};

export default async function ReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.order_id;
  const orderId = (Array.isArray(raw) ? raw[0] : raw) ?? null;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-5 py-10">
          {orderId ? (
            <ReturnResolver orderId={orderId} />
          ) : (
            <p className="rounded-2xl bg-white px-5 py-6 text-[15px] leading-relaxed text-amp-ink">
              We could not tell which booking this was. If you have just paid, check your
              messages — we send a confirmation as soon as it clears.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
