'use client';

import { useState } from 'react';
import type { ModelAvailability } from '@/lib/catalog/availability';
import type { LeadCreatedResponse } from '@/lib/schemas/lead';
import type { CreatedOrderResponse, PaymentTypeCode } from '@/lib/schemas/order';
import { Checkbox, PaymentTrust, PrimaryButton, Section } from '@/components/ui';
import { ArrowLeftIcon, CheckIcon } from '@/components/Brand';

/**
 * The Buy Now branch, as laid out in the journey document section 03:
 *
 *   price summary → EMI widget → add-ons → dealer card → payment option
 *   → terms and cancellation → enter Juspay
 *
 * Phase 1 is a BOOKING journey, not a delivery journey: no delivery date, no
 * tracking, no self-serve cancellation. The confirmation resolves to the
 * dealer, by name and phone, because the dealer is the one who knows.
 *
 * Nothing here computes money. Amounts shown come from the server, and the
 * request that starts a payment carries selections only — spec 12, rule 1.
 */

interface Props {
  lead: LeadCreatedResponse;
  model: ModelAvailability;
  colourCode: string | null;
  onBack: () => void;
}

export function BuyBranch({ lead, model, colourCode, onBack }: Props) {
  const [paymentType, setPaymentType] = useState<PaymentTypeCode>('partial');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = model.price;
  if (!price) {
    return (
      <p className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
        We don&apos;t sell the {model.name} online in your area yet. Book a test ride and your
        dealer will take it from there.
      </p>
    );
  }

  const colour = model.colours.find((c) => c.code === colourCode) ?? null;

  const options: { id: PaymentTypeCode; title: string; amount: string; blurb: string }[] = [
    {
      id: 'partial',
      title: 'Book with a deposit',
      amount: price.partial?.amount.display ?? '—',
      blurb: price.partial
        ? `Balance of ${price.partial.balance.display} at the dealer`
        : 'The booking amount has not been set yet',
    },
    {
      id: 'full',
      title: 'Pay in full',
      amount: price.onRoad.display,
      blurb: 'The whole on-road price now',
    },
    {
      id: 'emi',
      title: 'Pay by EMI',
      /*
       * No monthly figure. Juspay runs the EMI journey — their page shows the
       * real lenders, tenures and rates, and we would only be guessing. A
       * number here that differs from the one at checkout costs more trust
       * than showing none.
       */
      amount: 'At checkout',
      blurb: 'Choose your plan and tenure on the payment page',
    },
  ];

  async function pay() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          modelCode: model.code,
          colourCode,
          paymentType,
          // Nothing to record: we no longer quote an instalment, so there is
          // no figure the customer could later say they were shown.
          emiContext: null,
        }),
      });

      if (res.ok) {
        const order = (await res.json()) as CreatedOrderResponse;
        // Leaving for Juspay. Everything after this is their page.
        window.location.href = order.redirectUrl;
        return;
      }

      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? 'We could not start your payment. Please try again.');
    } catch {
      setError('We could not reach our servers. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const partialUnavailable = paymentType === 'partial' && !price.partial;

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={onBack}
        className="flex cursor-pointer items-center gap-1.5 self-start rounded-lg py-1 pr-2 text-[13px] font-medium text-amp-muted transition-colors hover:text-amp-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amp-accent"
      >
        <ArrowLeftIcon className="size-4" />
        Back
      </button>

      {/* 1. Price summary */}
      <Section label="Price">
        <div className="rounded-2xl border border-amp-line bg-amp-card p-4">
          <dl className="flex flex-col gap-1.5 text-[14px]">
            <Row label="Ex-showroom" value={price.exShowroom.display} />
            <Row label="RTO and registration" value={price.rtoCharges.display} />
            <div className="mt-1 border-t border-amp-line pt-2">
              <Row label="On-road price" value={price.onRoad.display} emphasis />
            </div>
          </dl>
          {colour && (
            <p className="mt-3 border-t border-amp-line pt-3 text-[13px] text-amp-muted">
              {model.name} · {colour.name}
            </p>
          )}
        </div>
      </Section>

      {/* 2. What happens after the button, said before they press it. */}
      {paymentType === 'emi' && (
        <p className="amp-rise rounded-2xl border border-amp-accent/30 bg-amp-accent-tint px-4 py-3 text-[13px] leading-relaxed text-amp-ink">
          You&apos;ll choose your EMI plan, lender and tenure on the secure payment page. Approval
          is decided there.
        </p>
      )}

      {/* 3. Optional add-ons — awaiting the list from Ampere */}
      <p className="rounded-2xl border border-dashed border-amp-line bg-amp-card px-4 py-3 text-[12px] leading-relaxed text-amp-muted">
        Optional add-ons appear here once Ampere supplies the list and prices.
      </p>

      {/* 4. Dealer card — no delivery date in phase 1 */}
      {lead.dealer && (
        <Section label="Your dealer">
          <div className="rounded-2xl border border-amp-line bg-amp-card p-4">
            <p className="text-[15px] font-semibold text-amp-ink">{lead.dealer.name}</p>
            {lead.dealer.phone && (
              <a
                href={`tel:${lead.dealer.phone}`}
                className="mt-1 inline-block text-[13px] font-semibold text-amp-accent underline-offset-4 hover:underline"
              >
                {lead.dealer.phone}
              </a>
            )}
            {/* Phase 1 promises no date, because nobody here can keep one. */}
            <p className="mt-2 text-[13px] leading-relaxed text-amp-muted">
              Your dealer will confirm availability and the delivery timeline.
            </p>
          </div>
        </Section>
      )}

      {/* 5. How they want to pay */}
      <Section label="How would you like to pay?">
        <div className="flex flex-col gap-2.5">
          {options.map((option) => {
            const selected = option.id === paymentType;
            const unavailable = option.id === 'partial' && !price.partial;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setPaymentType(option.id)}
                disabled={unavailable}
                aria-pressed={selected}
                className={[
                  'flex items-start justify-between gap-4 rounded-2xl border p-4 text-left transition-all duration-200',
                  selected
                    ? 'border-amp-accent bg-amp-accent-tint ring-1 ring-amp-accent'
                    : 'border-amp-line bg-amp-card hover:border-amp-ink',
                  unavailable ? 'cursor-not-allowed opacity-45' : 'cursor-pointer active:scale-[0.995]',
                ].join(' ')}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-amp-ink">
                      {option.title}
                    </span>
                    {selected && (
                      <span className="flex size-4 items-center justify-center rounded-full bg-amp-accent-fill text-white">
                        <CheckIcon className="size-2.5" />
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-amp-muted">
                    {option.blurb}
                  </span>
                </span>
                <span className="shrink-0 text-[16px] font-bold text-amp-ink">
                  {option.amount}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* 6. Terms and cancellation, before payment */}
      <div className="flex flex-col gap-2.5 rounded-2xl border border-amp-line bg-amp-card p-3.5">
        <Checkbox checked={termsAccepted} onChange={setTermsAccepted}>
          I accept the booking terms and the cancellation policy.{' '}
          <span className="text-amp-muted">Required</span>
        </Checkbox>
        {/* Spec 15 and the journey document both require this before payment.
            Legal owes us the wording. */}
        <p className="text-[11px] leading-relaxed text-amp-muted">
          Cancellation policy text to be supplied by Legal. It must appear here, before
          payment, not after.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {error}
        </p>
      )}

      <PrimaryButton
        onClick={() => void pay()}
        disabled={submitting || !termsAccepted || partialUnavailable}
      >
        {submitting
          ? 'Starting payment…'
          : paymentType === 'partial' && price.partial
            ? `Pay ${price.partial.amount.display} to book`
            : paymentType === 'full'
              ? `Pay ${price.onRoad.display}`
              : `Continue to EMI — ${price.onRoad.display} financed`}
      </PrimaryButton>

      {paymentType === 'emi' && (
        <p className="rounded-2xl bg-amp-card px-4 py-3 text-[12px] leading-relaxed text-amp-muted">
          Your plan, rate and eligibility are decided by the lender on the next screen. Nothing is
          agreed here.
        </p>
      )}

      <PaymentTrust />
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={emphasis ? 'font-medium text-amp-ink' : 'text-amp-muted'}>{label}</dt>
      <dd className={emphasis ? 'text-[17px] font-bold text-amp-ink' : 'text-amp-ink'}>
        {value}
      </dd>
    </div>
  );
}
