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
        <div className="mx-auto max-w-2xl px-3 py-6 sm:px-5 sm:py-12">
          {orderId ? (
            <ReturnResolver orderId={orderId} />
          ) : (
            <div className="rounded-3xl bg-white p-6 ring-1 ring-black/5 sm:p-8">
              <h1 className="text-[22px] font-bold leading-tight text-amp-ink">
                We couldn&apos;t tell which booking this was
              </h1>
              <p className="mt-2 text-[14px] leading-relaxed text-amp-muted">
                If you&apos;ve just paid, your dealer will call you to confirm. You can also
                start again from the scooters.
              </p>
              <a
                href="/buy"
                className="mt-4 inline-block text-[14px] font-semibold text-amp-ink underline underline-offset-4"
              >
                Back to the scooters
              </a>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
