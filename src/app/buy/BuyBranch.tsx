'use client';

import { useState } from 'react';
import { getModel } from '@/lib/catalog/catalog';
import type { ModelAvailability } from '@/lib/catalog/availability';
import type { NearbyDealer } from '@/lib/schemas/dealer';
import type { CreatedOrderResponse, PaymentTypeCode } from '@/lib/schemas/order';
import { Checkbox, ChoiceCard, Notice, PaymentTrust, PrimaryButton, SelectionDot } from '@/components/ui';
import { LockIcon, StoreIcon } from '@/components/Brand';
import { ProductImage } from '@/components/ProductImage';
import { StepActions, StepHeader } from './StepFrame';

/**
 * Step five, Buy Now: what it costs, how they want to pay, the terms, and the
 * hand-off to Juspay.
 *
 * Phase 1 is a BOOKING journey, not a delivery journey: no delivery date, no
 * tracking, no self-serve cancellation. The confirmation resolves to the
 * dealer they chose, because the dealer is the one who knows.
 *
 * Nothing here computes money. Amounts shown come from the server, and the
 * request that starts a payment carries selections only — spec 12, rule 1.
 */

/**
 * The payment options offered, in display order.
 *
 * EMI is off in the UI for now. Its backend path is untouched — the order
 * route, the schema and the Juspay client all still accept 'emi' — so turning
 * it back on is adding it to this list.
 */
const OFFERED_PAYMENT_TYPES: readonly PaymentTypeCode[] = ['full', 'partial'];

type Price = NonNullable<ModelAvailability['price']>;

interface PaymentOption {
  id: PaymentTypeCode;
  title: string;
  amount: string;
  amountNote: string;
  blurb: string;
}

/** Null means the option does not render — a partial amount nobody has set. */
function describe(id: PaymentTypeCode, price: Price): PaymentOption | null {
  switch (id) {
    case 'full':
      return {
        id,
        title: 'Full Payment',
        amount: price.onRoad.display,
        amountNote: 'on-road',
        blurb: 'Pay the complete on-road price now.',
      };
    case 'partial':
      return price.partial
        ? {
            id,
            title: 'Partial Payment',
            amount: price.partial.amount.display,
            amountNote: 'due now',
            blurb: `Pay a booking amount now. Balance of ${price.partial.balance.display} at the dealer.`,
          }
        : null;
    case 'emi':
      return {
        id,
        title: 'Pay by EMI',
        /*
         * No monthly figure. Juspay runs the EMI journey — their page shows the
         * real lenders, tenures and rates, and we would only be guessing.
         */
        amount: 'At checkout',
        amountNote: '',
        blurb: 'Choose your plan and tenure on the payment page.',
      };
  }
}

interface Props {
  model: ModelAvailability;
  colourCode: string | null;
  dealer: NearbyDealer | null;
  /** The session timed out; the journey asks for the OTP again. */
  onExpired: () => void;
  onBack: () => void;
}

export function BuyBranch({ model, colourCode, dealer, onExpired, onBack }: Props) {
  const price = model.price;
  const options = price
    ? OFFERED_PAYMENT_TYPES.map((id) => describe(id, price)).filter(
        (o): o is PaymentOption => o !== null,
      )
    : [];

  const [paymentType, setPaymentType] = useState<PaymentTypeCode | null>(
    () => options.find((o) => o.id === 'partial')?.id ?? options[0]?.id ?? null,
  );
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const header = (
    <StepHeader
      title="Choose Your Payment Option"
      text="Pay securely online. Your dealer takes care of the rest."
    />
  );

  if (!price) {
    return (
      <div className="flex flex-col gap-7">
        {header}
        <Notice tone="warn">
          We don&apos;t sell the {model.name} online in your area yet. Book a test ride and your
          dealer will take it from there.
        </Notice>
        <StepActions onBack={onBack}>
          <PrimaryButton disabled>Pay securely</PrimaryButton>
        </StepActions>
      </div>
    );
  }

  const definition = getModel(model.code);
  const colour = model.colours.find((c) => c.code === colourCode) ?? null;
  const chosen = options.find((o) => o.id === paymentType) ?? null;

  async function pay() {
    if (!paymentType) return;
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
          // Nothing to record: we do not quote an instalment, so there is no
          // figure the customer could later say they were shown.
          emiContext: null,
        }),
      });

      if (res.ok) {
        const order = (await res.json()) as CreatedOrderResponse;
        // Leaving for Juspay. Everything after this is their page.
        window.location.href = order.redirectUrl;
        return;
      }

      if (res.status === 401) return onExpired();
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? 'We could not start your payment. Please try again.');
      setSubmitting(false);
    } catch {
      setError('We could not reach our servers. Check your connection and try again.');
      setSubmitting(false);
    }
    // On success the button stays busy until the browser has left the page.
  }

  return (
    <div className="flex flex-col gap-7">
      {header}

      {/* What they are buying, from whom, and what it costs. */}
      <div className="rounded-2xl border border-amp-line bg-white">
        <div className="flex items-center gap-4 p-4">
          <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-xl bg-amp-page/80">
            {definition && (
              <ProductImage
                model={definition}
                colourCode={colourCode}
                className="h-14 w-22 object-contain"
              />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[16px] font-bold text-amp-ink">{model.name}</p>
            {colour && <p className="mt-0.5 text-[13px] text-amp-muted">{colour.name}</p>}
          </div>
        </div>

        {dealer && (
          <div className="flex items-start gap-2.5 border-t border-amp-line/70 px-4 py-3">
            <StoreIcon className="mt-0.5 size-4 shrink-0 text-amp-muted" />
            <p className="text-[13px] leading-relaxed text-amp-muted">
              <span className="font-semibold text-amp-ink">{dealer.name}</span>
              {/* Phase 1 promises no date, because nobody here can keep one. */}
              <br />
              Your dealer will confirm availability and the delivery timeline.
            </p>
          </div>
        )}

        <dl className="flex flex-col gap-1.5 border-t border-amp-line/70 px-4 py-3.5 text-[14px]">
          <Row label="Ex-showroom" value={price.exShowroom.display} />
          <Row label="RTO and registration" value={price.rtoCharges.display} />
          <div className="mt-1 border-t border-dashed border-amp-line pt-2">
            <Row label="On-road price" value={price.onRoad.display} emphasis />
          </div>
        </dl>
      </div>

      <section aria-labelledby="payment-heading" className="flex flex-col gap-3">
        <h3 id="payment-heading" className="text-[13px] font-medium text-amp-ink">
          Payment option
        </h3>
        <div role="group" aria-labelledby="payment-heading" className="flex flex-col gap-3">
          {options.map((option) => {
            const selected = option.id === paymentType;
            return (
              <ChoiceCard key={option.id} selected={selected} onClick={() => setPaymentType(option.id)}>
                <span className="flex items-start gap-3.5 p-4">
                  <span className="pt-0.5">
                    <SelectionDot selected={selected} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-amp-ink">{option.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-amp-muted">
                      {option.blurb}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[17px] font-bold leading-tight text-amp-ink">
                      {option.amount}
                    </span>
                    {option.amountNote && (
                      <span className="block text-[11px] uppercase tracking-wide text-amp-muted">
                        {option.amountNote}
                      </span>
                    )}
                  </span>
                </span>
              </ChoiceCard>
            );
          })}
        </div>
      </section>

      {/* Terms and cancellation, before payment. */}
      <div className="flex flex-col gap-1.5 rounded-xl bg-amp-page/70 px-3.5 py-3">
        <Checkbox checked={termsAccepted} onChange={setTermsAccepted}>
          I accept the booking terms and the cancellation policy.{' '}
          <span className="text-amp-muted">Required</span>
        </Checkbox>
        {/* Spec 15 and the journey document both require this before payment.
            Legal owes us the wording. */}
        <p className="pl-7.5 text-[11px] leading-relaxed text-amp-muted">
          Cancellation policy text to be supplied by Legal. It must appear here, before payment,
          not after.
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-col gap-3">
        <StepActions onBack={onBack}>
          <PrimaryButton
            onClick={() => void pay()}
            loading={submitting}
            disabled={!termsAccepted || !chosen}
          >
            {!submitting && <LockIcon className="size-4" />}
            {chosen?.id === 'emi'
              ? 'Continue to EMI'
              : chosen
                ? `Pay ${chosen.amount} securely`
                : 'Pay securely'}
          </PrimaryButton>
        </StepActions>
        <PaymentTrust />
      </div>
    </div>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={emphasis ? 'font-semibold text-amp-ink' : 'text-amp-muted'}>{label}</dt>
      <dd className={emphasis ? 'text-[17px] font-bold text-amp-ink' : 'text-amp-ink'}>{value}</dd>
    </div>
  );
}
