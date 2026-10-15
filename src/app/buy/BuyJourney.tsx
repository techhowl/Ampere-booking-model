'use client';

import { useCallback, useEffect, useState } from 'react';
import { getModel } from '@/lib/catalog/catalog';
import type { ModelAvailability } from '@/lib/catalog/availability';
import type { LeadCreatedResponse } from '@/lib/schemas/lead';
import { PrimaryButton, SecondaryButton, Skeleton } from '@/components/ui';
import { IdentityStep } from './IdentityStep';
import { ScooterPicker } from './ScooterPicker';
import { IntentFork, type Intent } from './IntentFork';
import { BuyBranch } from './BuyBranch';
import { ProductPanel } from './ProductPanel';
import { TestRideConfirmation, TestRideStep, type Booking } from './TestRideStep';
import type { Prefill } from './prefill';

/**
 * The whole /buy experience.
 *
 * Flow, from the purchase journey document section 03, with the identity step
 * first as the spec requires:
 *
 *   name, phone, pincode  →  lead written, before OTP
 *   OTP, inline under the phone field
 *   scooter and colour
 *   INTENT ─┬─ BUY NOW      price, EMI, dealer, booking amount, terms, Juspay
 *           └─ TEST RIDE    mode, date, slot, help topics
 *
 * One scrolling column, progressively revealed — the Figma's shape — rather
 * than a wizard that replaces the screen. Everything already answered stays
 * visible and editable above.
 */

interface Props {
  prefill: Prefill;
  attribution: Record<string, unknown>;
}

export function BuyJourney({ prefill, attribution }: Props) {
  const [lead, setLead] = useState<LeadCreatedResponse | null>(null);
  const [verified, setVerified] = useState(false);

  const [catalog, setCatalog] = useState<ModelAvailability[] | null>(null);
  const [modelCode, setModelCode] = useState<string | null>(prefill.modelCode);
  const [colourCode, setColourCode] = useState<string | null>(prefill.colourCode);

  const [intent, setIntent] = useState<Intent | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [purchased] = useState(false);

  const model = getModel(modelCode);
  const availability = catalog?.find((m) => m.code === modelCode) ?? null;

  /* The catalog needs a region, which needs a pincode, which arrives with the
     lead. Before that there is nothing to price. */
  useEffect(() => {
    if (!lead) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/catalog?pincode=${encodeURIComponent(lead.pincode)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { models: ModelAvailability[] };
        if (cancelled) return;

        setCatalog(data.models);
        setModelCode((current) => {
          if (current && data.models.some((m) => m.code === current)) return current;
          return data.models.find((m) => m.purchasable)?.code ?? data.models[0]?.code ?? null;
        });
      } catch {
        // The picker shows its own empty state; a failed fetch is not fatal.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lead]);

  // Default the colour once a model is known, so the panel always has a scooter.
  useEffect(() => {
    if (!model) return;
    setColourCode((current) =>
      current && model.colours.some((c) => c.code === current)
        ? current
        : (model.colours[0]?.code ?? null),
    );
  }, [model]);

  const onSelectModel = useCallback((entry: ModelAvailability) => {
    setModelCode(entry.code);
    setColourCode(null);
  }, []);

  const price = availability?.price ?? null;

  return (
    <>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-12 lg:py-10">
        {/* Product. Sticky alongside the form once there is room. */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <ProductPanel
            model={model}
            colourCode={colourCode}
            onColourChange={lead ? setColourCode : undefined}
          />
        </div>

        {/* Form, one column, revealed as it is answered. */}
        <div className="flex flex-col gap-8 pb-28">
          <IdentityStep
            prefill={prefill}
            attribution={attribution}
            lead={lead}
            verified={verified}
            onSaved={setLead}
            onVerified={() => setVerified(true)}
          />

          {verified && !catalog && (
            <div className="flex flex-col gap-3" aria-busy>
              <Skeleton className="h-11 w-56" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          )}

          {verified && catalog && (
            <div className="amp-rise">
              <ScooterPicker
                models={catalog}
                selectedModelCode={modelCode}
                selectedColourCode={colourCode}
                onSelectModel={onSelectModel}
                onSelectColour={setColourCode}
              />
            </div>
          )}

          {verified && availability && !booking && (
            <div className="amp-rise">
              <IntentFork
                model={availability}
                active={intent}
                purchased={purchased}
                onChoose={setIntent}
              />
            </div>
          )}

          {verified && lead && availability && intent === 'buy' && !booking && (
            <div className="amp-rise">
              <BuyBranch
                lead={lead}
                model={availability}
                colourCode={colourCode}
                onBack={() => setIntent(null)}
              />
            </div>
          )}

          {verified && lead && availability && intent === 'testride' && !booking && (
            <div className="amp-rise">
              <TestRideStep
                lead={lead}
                model={availability}
                colourCode={colourCode}
                onBack={() => setIntent(null)}
                onBooked={setBooking}
              />
            </div>
          )}

          {booking && (
            <div className="amp-rise flex flex-col gap-5">
              <TestRideConfirmation booking={booking} />

              {/* Spec 4: the cross-sell re-opens the other branch. A completed
                  test ride is not the end of the journey. */}
              {availability?.price && (
                <PrimaryButton
                  onClick={() => {
                    setBooking(null);
                    setIntent('buy');
                  }}
                >
                  Book your {booking.modelName} now
                </PrimaryButton>
              )}
              <SecondaryButton
                onClick={() => {
                  setBooking(null);
                  setIntent(null);
                }}
              >
                Back to the scooters
              </SecondaryButton>
            </div>
          )}
        </div>
      </div>

      {/* The sticky price bar, always on screen. */}
      {model && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-amp-line bg-amp-card/95 shadow-[0_-4px_24px_-12px_rgba(16,21,28,0.3)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div>
              <p className="text-[21px] font-bold leading-none tracking-tight text-amp-ink">
                {price ? price.exShowroom.display : '—'}
              </p>
              <p className="mt-1 text-[12px] text-amp-muted">
                {/* No instalment figure — Juspay quotes EMI, we do not. */}
                {price ? 'Ex-showroom · EMI available' : 'Enter your pincode for pricing'}
              </p>
            </div>
            <p className="text-right text-[12px] leading-snug text-amp-muted">
              {!lead
                ? 'Start with your details'
                : !verified
                  ? 'Verify your number to continue'
                  : !intent
                    ? 'Choose buy or test ride'
                    : intent === 'buy'
                      ? 'Complete your booking'
                      : 'Pick a date and time'}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
