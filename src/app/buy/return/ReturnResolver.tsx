'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getModel } from '@/lib/catalog/catalog';
import { displayPhone } from '@/lib/phone-format';
import { SUPPORT_PHONE } from '@/lib/contact';
import type { CreatedOrderResponse } from '@/lib/schemas/order';
import { ProductImage } from '@/components/ProductImage';
import { Notice, PrimaryButton, Spinner } from '@/components/ui';
import { CheckIcon, PhoneIcon, StoreIcon } from '@/components/Brand';

/**
 * Resolving what actually happened, then saying so.
 *
 * Three states, and the third is the one that matters:
 *
 *   paid     congratulations, from our record — never from the query string
 *   failed   reassurance, and a retry that reuses the same order
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
  amountTotal: string;
  balanceDue: string | null;
  paymentType: string;
  modelCode: string;
  colourCode: string | null;
  dealer: { code: string; name: string; phone: string | null } | null;
  firstName: string | null;
}

const POLL_MS = 3000;
const GIVE_UP_AFTER_MS = 90_000;

/** ₹5,000 for whole rupees; ₹76,398.90 — never ₹76,398.9 — when there are paise. */
function rupees(amount: string): string {
  const n = Number(amount);
  const paise = !Number.isInteger(n);
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: paise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function ReturnResolver({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stillWaiting, setStillWaiting] = useState(false);
  const startedAt = useRef(Date.now());

  const check = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`);
      if (res.status === 404) {
        setNotFound(true);
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

  if (notFound) return <NotFound />;
  if (!status || status.status === 'pending' || status.status === 'unknown') {
    return <Confirming orderId={orderId} stillWaiting={stillWaiting} />;
  }
  if (status.status === 'failed') return <Failed status={status} />;
  return <Paid status={status} />;
}

/* ------------------------------------------------------------------ */

function Paid({ status }: { status: Status }) {
  const model = getModel(status.modelCode);
  const colour = model?.colours.find((c) => c.code === status.colourCode);
  const paid = status.amountPaid ?? status.amountCharged;
  const name = model?.name ?? status.modelCode;
  const balance = status.balanceDue && Number(status.balanceDue) > 0 ? status.balanceDue : null;

  return (
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center pt-2 text-center">
          <span className="amp-pop flex size-16 items-center justify-center rounded-full bg-amp-offer text-amp-offer-ink">
            <CheckIcon className="size-8" />
          </span>
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-amp-offer-ink">
            Booking confirmed
          </p>
          <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight text-amp-ink sm:text-[34px]">
            Congratulations{status.firstName ? `, ${status.firstName}` : ''}!
          </h1>
          <p className="mt-2 max-w-[42ch] text-[15px] leading-relaxed text-amp-muted">
            Your {name}
            {colour ? ` in ${colour.name}` : ''} is booked. Welcome to the Ampere family.
          </p>
        </div>

        {model && (
          <div className="mt-6 h-44 rounded-2xl bg-amp-page/70 sm:h-56">
            <ProductImage
              model={model}
              colourCode={status.colourCode}
              className="h-full w-full object-contain p-5"
            />
          </div>
        )}

        <dl className="mt-6 flex flex-col gap-2.5 text-[14px]">
          <Row label="Booking ID" value={status.orderId} mono />
          <Row
            label="Payment"
            value={status.paymentType === 'partial' ? 'Partial payment' : 'Full payment'}
          />
          <Row label="Paid now" value={rupees(paid)} emphasis />
          {balance && <Row label="Balance at the dealership" value={rupees(balance)} />}
        </dl>
      </Card>

      {status.dealer && (
        <Card>
          <div className="flex items-start gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amp-page text-amp-ink">
              <StoreIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-amp-muted">
                Your dealer
              </p>
              <p className="mt-1 text-[16px] font-semibold text-amp-ink">{status.dealer.name}</p>
              {status.dealer.phone ? (
                <CallLink phone={status.dealer.phone} />
              ) : (
                <CallLink phone={SUPPORT_PHONE.tel} label="Customer care" />
              )}
            </div>
          </div>
        </Card>
      )}

      <Card>
        <p className="text-[16px] font-semibold text-amp-ink">What happens next</p>
        {/* Phase 1 promises no date, because nobody here can keep one. */}
        <ol className="mt-4 flex flex-col gap-4">
          <NextStep n={1} title="Your dealer calls you">
            To confirm availability and your delivery timeline.
          </NextStep>
          {balance ? (
            <NextStep n={2} title="Pay the balance at the dealership">
              {rupees(balance)}, when you complete the paperwork.
            </NextStep>
          ) : (
            <NextStep n={2} title="Complete the paperwork">
              Registration and insurance, at the dealership.
            </NextStep>
          )}
          <NextStep n={3} title={`Ride home on your ${name}`}>
            Keep your booking ID handy: {status.orderId}
          </NextStep>
        </ol>
      </Card>

      {/* Spec 6: the cross-sell. A purchase re-opens the test ride. */}
      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[15px] font-semibold text-amp-ink">Want to ride it first?</p>
          <p className="mt-1 text-[13px] leading-relaxed text-amp-muted">
            Book a free test ride at your dealer&apos;s showroom before delivery.
          </p>
        </div>
        <a
          href={bookingLink(status, 'testride')}
          className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl border border-amp-ink bg-white px-5 text-[14px] font-semibold text-amp-ink transition-colors hover:bg-amp-page"
        >
          Book a test ride
        </a>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Failed({ status }: { status: Status }) {
  const [retrying, setRetrying] = useState(false);
  const [problem, setProblem] = useState<'expired' | 'error' | null>(null);
  const model = getModel(status.modelCode);

  /*
   * Spec 12 rule 2: the retry reuses this order, never opens a second. The
   * order route does that itself for a failed order with the same choices,
   * and hands back a fresh payment page — Juspay's or, until it is live, ours.
   */
  async function retry() {
    setRetrying(true);
    setProblem(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          modelCode: status.modelCode,
          colourCode: status.colourCode,
          paymentType: status.paymentType,
          emiContext: null,
        }),
      });
      if (res.ok) {
        window.location.href = ((await res.json()) as CreatedOrderResponse).redirectUrl;
        return;
      }
      // A session that timed out while they were away paying: verify, then retry.
      setProblem([401, 403, 409].includes(res.status) ? 'expired' : 'error');
    } catch {
      setProblem('error');
    }
    setRetrying(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-col items-center pt-2 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <svg
              viewBox="0 0 24 24"
              className="size-8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M12 8v5m0 3.5v.01" strokeLinecap="round" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </span>
          <h1 className="mt-5 text-[26px] font-bold leading-tight tracking-tight text-amp-ink sm:text-[30px]">
            Your payment didn&apos;t go through
          </h1>
          <p className="mt-2 max-w-[44ch] text-[15px] leading-relaxed text-amp-muted">
            Don&apos;t worry — your {model?.name ?? 'booking'} isn&apos;t lost. This sometimes
            happens when a bank declines a payment, the page times out or the connection drops.
          </p>
        </div>

        <div className="mt-6 rounded-xl bg-amp-page/70 px-4 py-3 text-[13px] leading-relaxed text-amp-ink">
          Nothing has been charged for this booking. If your bank shows a debit, it is reversed
          automatically — usually within 5–7 working days.
        </div>

        {problem === 'expired' && (
          <Notice className="mt-4">
            For your security, please verify your number again to retry.{' '}
            <a href={bookingLink(status, 'buy')} className="font-semibold underline underline-offset-4">
              Continue to your booking
            </a>
          </Notice>
        )}
        {problem === 'error' && (
          <Notice tone="error" className="mt-4">
            We couldn&apos;t start a new payment just now. Please try again in a few minutes.
          </Notice>
        )}

        <div className="mt-5 flex flex-col gap-2.5">
          <PrimaryButton onClick={() => void retry()} loading={retrying}>
            Try again
          </PrimaryButton>
          <a
            href={bookingLink(status, 'buy')}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-amp-line bg-white px-5 text-[14px] font-medium text-amp-ink transition-colors hover:border-amp-ink"
          >
            Choose a different payment option
          </a>
        </div>
      </Card>

      <Card>
        <p className="text-[15px] font-semibold text-amp-ink">Need a hand?</p>
        <p className="mt-1 text-[13px] leading-relaxed text-amp-muted">
          {status.dealer
            ? `${status.dealer.name} can complete your booking over the phone, or call us any time.`
            : 'Our team can complete your booking over the phone.'}
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {status.dealer?.phone && (
            <CallLink phone={status.dealer.phone} label={status.dealer.name} />
          )}
          <CallLink phone={SUPPORT_PHONE.tel} label="Ampere customer care" />
        </div>
        <p className="mt-4 text-[12px] text-amp-muted">
          Booking ID <span className="font-mono">{status.orderId}</span>
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Confirming({ orderId, stillWaiting }: { orderId: string; stillWaiting: boolean }) {
  return (
    <Card>
      <div className="flex flex-col items-center py-4 text-center">
        <Spinner className="size-10 text-amp-accent-fill" />
        <h1 className="mt-5 text-[24px] font-bold leading-tight tracking-tight text-amp-ink">
          Confirming your payment
        </h1>
        <p className="mt-2 max-w-[40ch] text-[15px] leading-relaxed text-amp-muted">
          This takes a few seconds. Please don&apos;t close this page or pay again.
        </p>
        {stillWaiting && (
          <p className="mt-5 rounded-xl bg-amp-page px-4 py-3 text-left text-[13px] leading-relaxed text-amp-ink">
            It&apos;s taking longer than usual. Your booking is safe — your dealer can see it as
            soon as it clears, and you can call us with your booking ID{' '}
            <strong className="font-mono font-semibold">{orderId}</strong>.
          </p>
        )}
      </div>
    </Card>
  );
}

function NotFound() {
  return (
    <Card>
      <h1 className="text-[22px] font-bold leading-tight text-amp-ink">
        We couldn&apos;t open this booking here
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-amp-muted">
        A booking can only be viewed on the device it was made on. If you&apos;ve just paid, your
        dealer will call you to confirm — or speak to us now.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <CallLink phone={SUPPORT_PHONE.tel} label="Ampere customer care" />
        <a href="/buy" className="text-[14px] font-semibold text-amp-ink underline underline-offset-4">
          Back to the scooters
        </a>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

/** Back into /buy with this scooter already chosen. */
function bookingLink(status: Status, intent: 'buy' | 'testride'): string {
  const params = new URLSearchParams({ model: status.modelCode, intent });
  if (status.colourCode) params.set('colour', status.colourCode);
  return `/buy?${params.toString()}`;
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl bg-white p-6 ring-1 ring-black/5 sm:p-8 ${className ?? ''}`}>
      {children}
    </div>
  );
}

function NextStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amp-ink text-[13px] font-semibold text-white">
        {n}
      </span>
      <div>
        <p className="text-[14px] font-semibold text-amp-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-amp-muted">{children}</p>
      </div>
    </li>
  );
}

function CallLink({ phone, label }: { phone: string; label?: string }) {
  const shown = displayPhone(phone);
  return (
    <a
      href={`tel:${phone}`}
      className="mt-1 inline-flex items-center gap-1.5 text-[14px] font-semibold text-amp-accent-fill underline-offset-4 hover:underline"
    >
      <PhoneIcon className="size-4" />
      {label ? `${label} · ${shown}` : shown}
    </a>
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
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-amp-line pb-2.5 last:border-0 last:pb-0">
      <dt className="text-amp-muted">{label}</dt>
      <dd
        className={[
          'text-right',
          emphasis ? 'text-[18px] font-bold text-amp-ink' : 'text-amp-ink',
          mono ? 'font-mono text-[13px]' : '',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
