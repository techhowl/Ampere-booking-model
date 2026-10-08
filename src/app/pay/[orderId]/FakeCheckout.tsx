'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The outcome picker on the stand-in checkout.
 *
 * Each button fires the webhook Juspay would have sent, then returns the
 * customer to our return URL — the real sequence, in the real order. That is
 * what makes this worth building rather than faking the confirmation screen:
 * the webhook-first path, the return-first path and the never-arrives path all
 * get exercised for real.
 */

type Outcome = 'success' | 'failure' | 'silent';

const OUTCOMES: { id: Outcome; label: string; blurb: string }[] = [
  {
    id: 'success',
    label: 'Pay successfully',
    blurb: 'Webhook fires CHARGED, then you return. The usual happy path.',
  },
  {
    id: 'failure',
    label: 'Payment fails',
    blurb: 'Webhook fires AUTHORIZATION_FAILED. You should see the retry screen.',
  },
  {
    id: 'silent',
    label: 'Return without a webhook',
    blurb:
      'Nothing is sent. The return page has to ask Juspay directly — the reconciler path.',
  },
];

export function FakeCheckout({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Outcome | null>(null);

  async function choose(outcome: Outcome) {
    setBusy(outcome);

    if (outcome !== 'silent') {
      // Exactly the payload shape Juspay's webhook documentation describes.
      await fetch('/api/webhooks/juspay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The fake client accepts this and rejects everything else.
          'x-juspay-signature': 'valid-signature',
        },
        body: JSON.stringify({
          event_name: 'ORDER_SUCCEEDED',
          content: {
            order: {
              order_id: orderId,
              status: outcome === 'success' ? 'CHARGED' : 'AUTHORIZATION_FAILED',
            },
          },
        }),
      }).catch(() => {
        // A dropped webhook is a real scenario; the return path recovers.
      });
    }

    // Juspay returns order_id, dealer and amount — identical on success and
    // failure. We send the same, and the return page ignores all but the id.
    router.push(`/buy/return?order_id=${encodeURIComponent(orderId)}&dealer=&amount=`);
  }

  return (
    <div className="mt-6 flex flex-col gap-2.5">
      {OUTCOMES.map((outcome) => (
        <button
          key={outcome.id}
          type="button"
          disabled={busy !== null}
          onClick={() => void choose(outcome.id)}
          className="rounded-xl border border-amp-line p-3.5 text-left transition-colors hover:border-amp-ink disabled:opacity-50"
        >
          <span className="block text-[14px] font-semibold text-amp-ink">
            {busy === outcome.id ? 'Working…' : outcome.label}
          </span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-amp-muted">
            {outcome.blurb}
          </span>
        </button>
      ))}
    </div>
  );
}
