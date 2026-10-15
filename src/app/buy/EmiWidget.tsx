'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  EMI_DISCLAIMER,
  EMI_VS_LOAN_NOTE,
  MIN_DOWN_PAYMENT_RATIO,
  TENURES_MONTHS,
  calculateEmi,
  type Tenure,
} from '@/lib/emi/emi';

/**
 * The EMI widget, in-journey variant.
 *
 * Journey document section 02: it sits inside /buy after the price summary and
 * exists to set the expectation the customer will meet inside Juspay. It never
 * applies for credit and never promises approval.
 *
 * Two things build spec 10 insists on and most sites omit:
 *   - the TOTAL amount payable, not just the monthly figure
 *   - that this is checkout EMI, a different product from the dealership
 *     vehicle loan advertised at ~6.99%
 */

interface Props {
  onRoadPrice: number;
  /** Lets the chosen figure carry forward into the order. */
  onChange?: (quote: { tenureMonths: number; downPayment: number; monthly: number }) => void;
  /** Opened automatically when the customer picks Financing as their help topic. */
  defaultOpen?: boolean;
}

const formatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function EmiWidget({ onRoadPrice, onChange, defaultOpen }: Props) {
  const sliderId = useId();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [tenure, setTenure] = useState<Tenure>(24);

  const minDown = Math.round(onRoadPrice * MIN_DOWN_PAYMENT_RATIO);
  const maxDown = Math.round(onRoadPrice * 0.8);
  const [downPayment, setDownPayment] = useState(minDown);

  const quote = useMemo(
    () => calculateEmi({ onRoadPrice, downPayment, tenureMonths: tenure }),
    [onRoadPrice, downPayment, tenure],
  );

  /*
   * Publish every quote, including the first.
   *
   * Without this the payment option still shows the server's "EMI from"
   * figure — computed at the minimum down payment — while the widget shows
   * what the customer actually chose. Two different numbers on one screen,
   * both correct, and no way for them to tell which they will be charged.
   */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    onChangeRef.current?.({
      tenureMonths: tenure,
      downPayment,
      monthly: quote.monthlyInstalment,
    });
  }, [tenure, downPayment, quote.monthlyInstalment]);

  function update(next: { tenure?: Tenure; down?: number }) {
    if (next.tenure) setTenure(next.tenure);
    if (next.down !== undefined) setDownPayment(next.down);
    // The effect above publishes the result — no second notification here.
  }

  return (
    <section className="rounded-2xl border border-amp-line bg-amp-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-amp-page/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-amp-accent"
      >
        <span>
          <span className="block text-[14px] font-semibold text-amp-ink">
            EMI from {formatter.format(quote.monthlyInstalment)}/month
          </span>
          <span className="mt-0.5 block text-[12px] text-amp-muted">
            {tenure} months · indicative
          </span>
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-amp-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-amp-line p-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={sliderId} className="flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-amp-ink">Down payment</span>
              <span className="text-[14px] font-semibold text-amp-ink">
                {formatter.format(downPayment)}
              </span>
            </label>
            <input
              id={sliderId}
              type="range"
              min={minDown}
              max={maxDown}
              step={1000}
              value={downPayment}
              onChange={(e) => update({ down: Number(e.target.value) })}
              className="w-full cursor-pointer accent-amp-accent"
            />
            <div className="flex justify-between text-[11px] text-amp-muted">
              <span>{formatter.format(minDown)}</span>
              <span>{formatter.format(maxDown)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-amp-ink">Tenure</span>
            <div className="grid grid-cols-4 gap-2">
              {TENURES_MONTHS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => update({ tenure: option })}
                  aria-pressed={option === tenure}
                  className={[
                    'min-h-11 cursor-pointer rounded-lg border text-[13px] transition-all duration-200',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amp-accent',
                    option === tenure
                      ? 'border-amp-accent bg-amp-accent-tint font-medium text-amp-ink'
                      : 'border-amp-line text-neutral-700 hover:border-neutral-400',
                  ].join(' ')}
                >
                  {option}m
                </button>
              ))}
            </div>
          </div>

          <dl className="flex flex-col gap-1.5 rounded-lg bg-amp-page p-3 text-[13px]">
            <Row label="Loan amount" value={formatter.format(quote.principal)} />
            <Row label="Monthly instalment" value={formatter.format(quote.monthlyInstalment)} />
            <Row label="Interest" value={formatter.format(quote.totalInterest)} />
            {/* The figure most sites hide. Build spec 10 requires it. */}
            <div className="mt-1 border-t border-amp-line pt-1.5">
              <Row
                label="Total amount payable"
                value={formatter.format(quote.totalPayable + quote.downPayment)}
                emphasis
              />
            </div>
          </dl>

          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] leading-relaxed text-amp-muted">{EMI_DISCLAIMER}</p>
            {/* Two different products. Conflating them is how a customer who
                saw 6.99% on the product page ends up feeling misled. */}
            <p className="text-[11px] leading-relaxed text-amp-muted">{EMI_VS_LOAN_NOTE}</p>
          </div>
        </div>
      )}
    </section>
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
      <dt className={emphasis ? 'font-medium text-amp-ink' : 'text-amp-muted'}>
        {label}
      </dt>
      <dd className={emphasis ? 'font-semibold text-amp-ink' : 'text-amp-ink'}>
        {value}
      </dd>
    </div>
  );
}
