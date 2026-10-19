'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MODELS, getModel } from '@/lib/catalog/catalog';
import type { ModelAvailability } from '@/lib/catalog/availability';
import type { LeadCreatedResponse } from '@/lib/schemas/lead';
import type { NearbyDealer, NearbyDealersResponse } from '@/lib/schemas/dealer';
import { IdentityStep, VerifiedDetails } from './IdentityStep';
import { ScooterPicker } from './ScooterPicker';
import { DealerStep } from './DealerStep';
import { IntentFork, type Intent } from './IntentFork';
import { BuyBranch } from './BuyBranch';
import { TestRideConfirmation, TestRideStep, type Booking } from './TestRideStep';
import { ProductPanel, SelectionSummary } from './ProductPanel';
import { Stepper } from './Stepper';
import type { Prefill } from './prefill';

/**
 * The whole /buy experience, as five steps beside the scooter.
 *
 *   1 details   name, phone, pincode → lead written, before OTP → OTP
 *   2 scooter   model and colour, preselected from the product page
 *   3 dealer    up to three near the pincode; the choice goes on the lead
 *   4 journey   BUY NOW or TEST RIDE
 *   5 finish    payment (Juspay) or date and slot
 *
 * One step on screen at a time, with Back on every step and earlier steps one
 * tap away in the progress bar. Everything answered lives here, not in the
 * steps, so going back and forward loses nothing.
 */

const STEPS = ['details', 'scooter', 'dealer', 'journey', 'finish'] as const;
type StepId = (typeof STEPS)[number];

interface Props {
  prefill: Prefill;
  attribution: Record<string, unknown>;
}

export function BuyJourney({ prefill, attribution }: Props) {
  const [step, setStep] = useState<StepId>('details');

  const [lead, setLead] = useState<LeadCreatedResponse | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [verified, setVerified] = useState(false);

  const [catalog, setCatalog] = useState<ModelAvailability[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [modelCode, setModelCode] = useState<string | null>(prefill.modelCode);
  const [colourCode, setColourCode] = useState<string | null>(prefill.colourCode);

  const [nearby, setNearby] = useState<NearbyDealersResponse | null>(null);
  const [dealer, setDealer] = useState<NearbyDealer | null>(null);

  // Arriving from a "Book a test ride" button preselects that card at step 4.
  const [intent, setIntent] = useState<Intent | null>(
    prefill.intent === 'buy' || prefill.intent === 'testride' ? prefill.intent : null,
  );
  const [booking, setBooking] = useState<Booking | null>(null);

  const model = getModel(modelCode);
  const availability = catalog?.find((m) => m.code === modelCode) ?? null;
  const colourName = model?.colours.find((c) => c.code === colourCode)?.name ?? null;
  const pincode = lead?.pincode ?? null;

  /* The catalog needs a region, which needs a pincode, which arrives with the
     lead. Fetched while the customer types their code, so step 2 is ready. */
  useEffect(() => {
    if (!pincode) return;
    let cancelled = false;
    setCatalogFailed(false);

    (async () => {
      try {
        const res = await fetch(`/api/catalog?pincode=${encodeURIComponent(pincode)}`);
        if (!res.ok) throw new Error('catalog unavailable');
        const data = (await res.json()) as { models: ModelAvailability[] };
        if (cancelled) return;

        setCatalog(data.models);
        // Keep the product they came from. Only pick one if they came from none.
        setModelCode((current) => {
          if (current && data.models.some((m) => m.code === current)) return current;
          return data.models.find((m) => m.purchasable)?.code ?? data.models[0]?.code ?? null;
        });
      } catch {
        if (!cancelled) setCatalogFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pincode, catalogAttempt]);

  // Dealers belong to a pincode. A new pincode means a new list and no choice.
  useEffect(() => {
    setNearby(null);
    setDealer(null);
  }, [pincode]);

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

  /* ---------------------------------------------------------------- */
  /* Steps                                                             */
  /* ---------------------------------------------------------------- */

  // What each step needs before it can be shown. A step whose inputs have gone
  // (a new pincode clears the dealer, say) falls back to the last one that can.
  const ready: Record<StepId, boolean> = {
    details: true,
    scooter: verified && !!lead,
    dealer: verified && !!lead && !!availability && !!colourCode,
    journey: verified && !!lead && !!availability && !!colourCode && !!dealer,
    finish: verified && !!lead && !!availability && !!colourCode && !!dealer && !!intent,
  };
  const current: StepId = ready[step]
    ? step
    : ([...STEPS].reverse().find((id) => ready[id] && STEPS.indexOf(id) < STEPS.indexOf(step)) ??
      'details');
  const currentIndex = STEPS.indexOf(current);

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const mounted = useRef(false);

  // A new step: bring its top into view if the customer had scrolled past it,
  // and move focus to its heading so a screen reader announces it.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const root = rootRef.current;
    if (root && root.getBoundingClientRect().top < 0) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      root.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
    panelRef.current
      ?.querySelector<HTMLElement>('[data-step-heading]')
      ?.focus({ preventScroll: true });
  }, [current, booking]);

  const go = (next: StepId) => setStep(next);

  let content: ReactNode = null;
  switch (current) {
    case 'details':
      content =
        verified && lead ? (
          <VerifiedDetails name={customerName} lead={lead} onContinue={() => go('scooter')} />
        ) : (
          <IdentityStep
            prefill={prefill}
            attribution={attribution}
            lead={lead}
            onSaved={(saved, name) => {
              setLead(saved);
              setCustomerName(name);
            }}
            onVerified={() => {
              setVerified(true);
              go('scooter');
            }}
            onEdit={() => setLead(null)}
          />
        );
      break;

    case 'scooter':
      content = (
        <ScooterPicker
          models={catalog}
          loadFailed={catalogFailed}
          onRetry={() => setCatalogAttempt((n) => n + 1)}
          selectedModelCode={modelCode}
          selectedColourCode={colourCode}
          onSelectModel={onSelectModel}
          onSelectColour={setColourCode}
          onBack={() => go('details')}
          onContinue={() => go('dealer')}
        />
      );
      break;

    case 'dealer':
      content = lead && (
        <DealerStep
          pincode={lead.pincode}
          cached={nearby}
          onLoaded={setNearby}
          preferredCode={dealer?.code ?? prefill.dealerCode}
          onConfirmed={(chosen) => {
            setDealer(chosen);
            go('journey');
          }}
          onBack={() => go('scooter')}
        />
      );
      break;

    case 'journey':
      content = availability && (
        <IntentFork
          model={availability}
          colourName={colourName}
          dealer={dealer}
          selected={intent}
          onSelect={setIntent}
          onBack={() => go('dealer')}
          onContinue={() => go('finish')}
        />
      );
      break;

    case 'finish':
      if (!availability) break;
      if (intent === 'buy') {
        content = (
          <BuyBranch
            model={availability}
            colourCode={colourCode}
            dealer={dealer}
            onBack={() => go('journey')}
          />
        );
      } else if (booking) {
        content = (
          <TestRideConfirmation
            booking={booking}
            canBuy={availability.price !== null}
            // Spec 4: a completed test ride re-opens the buy branch.
            onBuy={() => {
              setBooking(null);
              setIntent('buy');
            }}
            onDone={() => {
              setBooking(null);
              go('scooter');
            }}
          />
        );
      } else {
        content = (
          <TestRideStep
            model={availability}
            colourCode={colourCode}
            dealer={dealer}
            onBooked={setBooking}
            onBack={() => go('journey')}
          />
        );
      }
      break;
  }

  const stepperItems = STEPS.map((id) => ({
    id,
    label: {
      details: 'Details',
      scooter: 'Scooter',
      dealer: 'Dealer',
      journey: 'Journey',
      finish: intent === 'testride' ? 'Test ride' : 'Payment',
    }[id],
  }));

  // Before anything is chosen, the range's lead scooter stands in on the left.
  const shown = model ?? MODELS[0]!;

  return (
    <div
      ref={rootRef}
      className="mx-auto grid max-w-7xl scroll-mt-16 grid-cols-1 gap-4 px-3 py-4 sm:gap-6 sm:px-5 sm:py-6 lg:scroll-mt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:gap-10 lg:py-10"
    >
      {/* The scooter. Sticky beside the form once there is room. */}
      <aside aria-label="Your scooter" className="lg:sticky lg:top-24 lg:self-start">
        <ProductPanel
          model={shown}
          colourCode={colourCode}
          preview={!model}
          onColourChange={model ? setColourCode : undefined}
        />
        <SelectionSummary
          className="mt-4 hidden lg:grid"
          model={model}
          colourName={colourName}
          price={availability?.price?.exShowroom.display ?? null}
          dealer={dealer}
        />
      </aside>

      {/* The journey, one step at a time. */}
      <section
        ref={panelRef}
        aria-label="Book your Ampere"
        className="rounded-3xl bg-white px-4 py-6 shadow-[0_1px_2px_rgba(16,21,28,0.04),0_24px_48px_-32px_rgba(16,21,28,0.25)] ring-1 ring-black/5 sm:p-8"
      >
        <Stepper
          steps={stepperItems}
          currentIndex={currentIndex}
          onJump={(index) => {
            const target = STEPS[index];
            if (target && index < currentIndex) go(target);
          }}
        />

        <div className="my-6 h-px bg-amp-line/70" />

        <div key={`${current}${booking ? ':booked' : ''}`} className="amp-rise">
          {content}
        </div>
      </section>
    </div>
  );
}
