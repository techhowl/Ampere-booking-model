'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getModel } from '@/lib/catalog/catalog';
import { PAYMENT_TYPE_LABELS, type PaymentTypeCode } from '@/lib/schemas/order';
import { PrimaryButton } from '@/components/ui';

/**
 * Resolving what actually happened, then saying so.
 *
 * Three states, and the third is the one that matters:
 *
 *   paid     confirmation, from our record — never from the query string
 *   failed   retry, reusing the same order_id
 *   unknown  "confirming your payment", and we poll. We do NOT guess.
 *
 * Spec 9: "never show a bare error to someone whose money may have left their
 * account." An unresolved payment is a waiting state, not a failure.
 */

interface Status {
  orderId: string;
  status: 'paid' | 'failed' | 'pending' | 'unknown';
  amountCharged: string;
  amountPaid: string | null;
  paymentType: string;
  modelCode: string;
  colourCode: string | null;
  dealer: { code: string; name: string; phone: string | null } | null;
}

const POLL_MS = 3000;
const GIVE_UP_AFTER_MS = 90_000;

export function ReturnResolver({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stillWaiting, setStillWaiting] = useState(false);
  const startedAt = useRef(Date.now());

  const check = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`);
      if (res.status === 404) {
        setError('We could not find that booking.');
        return true;
      }
      if (!res.ok) return false;

      const data = (await res.json()) as Status;
      setStatus(data);

      // Keep polling only while the answer is genuinely not known yet.
      return data.status === 'paid' || data.status === 'failed';
    } catch {
      return false;
    }
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const settled = await check();
      if (cancelled || settled) return;

      if (Date.now() - startedAt.current > GIVE_UP_AFTER_MS) {
        setStillWaiting(true);
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [check]);

  if (error) {
    return <Card>{error}</Card>;
  }

  if (!status || status.status === 'pending' || status.status === 'unknown') {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-1 size-3 shrink-0 animate-pulse rounded-full bg-amp-accent"
          />
          <div>
            <p className="text-[17px] font-bold text-amp-ink">Confirming your payment</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-amp-muted">
              This takes a few seconds. Please don&apos;t close this page or pay again.
            </p>
            {stillWaiting && (
              <p className="mt-3 rounded-xl bg-amp-page px-4 py-3 text-[13px] leading-relaxed text-amp-ink">
                It&apos;s taking longer than usual. Your booking is safe — we&apos;ll send a
                confirmation by message the moment it clears, and your dealer can see it
                either way. Reference{' '}
                <strong className="font-mono font-semibold">{orderId}</strong>.
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  if (status.status === 'failed') {
    return (
      <Card>
        <p className="text-[17px] font-bold text-amp-ink">That payment didn&apos;t go through</p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-amp-muted">
          Nothing has been charged. You can try again with the same booking — your scooter is
          still held.
        </p>
        <div className="mt-5 flex flex-col gap-2.5">
          {/* Spec 12 rule 2: the retry reuses this order, never opens a second. */}
          <PrimaryButton onClick={() => (window.location.href = `/pay/${status.orderId}`)}>
            Try again
          </PrimaryButton>
          <Link
            href="/buy"
            className="min-h-12 rounded-lg border border-amp-line bg-white px-5 text-center text-[14px] font-medium leading-[3rem] text-amp-ink transition-colors hover:border-amp-ink"
          >
            Back to the scooters
          </Link>
        </div>
        {status.dealer && (
          <p className="mt-4 text-[13px] leading-relaxed text-amp-muted">
            Or call {status.dealer.name}
            {status.dealer.phone ? ` on ${status.dealer.phone}` : ''} and they&apos;ll take it
            from here.
          </p>
        )}
      </Card>
    );
  }

  const model = getModel(status.modelCode);
  const colour = model?.colours.find((c) => c.code === status.colourCode);
  const paid = status.amountPaid ?? status.amountCharged;

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-amp-accent/30 bg-amp-accent-tint">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amp-accent-dark">
          Booking confirmed
        </p>
        <p className="mt-2 text-[22px] font-bold leading-tight text-amp-ink">
          Your {model?.name ?? status.modelCode} is booked
        </p>
        <p className="mt-1.5 text-[14px] text-amp-ink/80">
          {colour ? `${colour.name} · ` : ''}
          {PAYMENT_TYPE_LABELS[status.paymentType as PaymentTypeCode]}
        </p>
      </Card>

      <Card>
        <dl className="flex flex-col gap-2.5 text-[14px]">
          <Row label="Order number" value={status.orderId} mono />
          <Row label="Paid now" value={`₹${Number(paid).toLocaleString('en-IN')}`} emphasis />
        </dl>

        {status.dealer && (
          <div className="mt-5 border-t border-amp-line pt-4">
            <p className="amp-label">Your dealer</p>
            <p className="mt-2 text-[15px] font-semibold text-amp-ink">{status.dealer.name}</p>
            {status.dealer.phone && (
              <a
                href={`tel:${status.dealer.phone}`}
                className="mt-1 inline-block text-[14px] font-semibold text-amp-accent underline-offset-4 hover:underline"
              >
                {status.dealer.phone}
              </a>
            )}
            {/* Phase 1 promises no date, because nobody here can keep one. */}
            <p className="mt-2 text-[13px] leading-relaxed text-amp-muted">
              Your dealer will call to confirm availability and the delivery timeline.
            </p>
          </div>
        )}
      </Card>

      {/* Spec 6: the cross-sell. A purchase re-opens the test ride. */}
      <Card>
        <p className="text-[15px] font-semibold text-amp-ink">Want to ride it first?</p>
        <p className="mt-1 text-[13px] leading-relaxed text-amp-muted">
          Book a free test ride before delivery — at home or at the showroom.
        </p>
        <Link
          href="/buy?intent=testride"
          className="mt-4 inline-flex min-h-12 items-center rounded-lg border border-amp-ink bg-white px-5 text-[14px] font-semibold text-amp-ink transition-colors hover:bg-amp-page"
        >
          Book a test ride
        </Link>
      </Card>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-amp-line bg-amp-card p-5 ${className ?? ''}`}>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
  mono,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-amp-muted">{label}</dt>
      <dd
        className={[
          emphasis ? 'text-[18px] font-bold text-amp-ink' : 'text-amp-ink',
          mono ? 'font-mono text-[13px]' : '',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
