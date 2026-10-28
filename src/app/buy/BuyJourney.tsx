'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MAIN_SITE, getModel } from '@/lib/catalog/catalog';
import type { ModelAvailability } from '@/lib/catalog/availability';
import type { LeadCreatedResponse } from '@/lib/schemas/lead';
import type { NearbyDealer, NearbyDealersResponse } from '@/lib/schemas/dealer';
import { SESSION_EXPIRED_MESSAGE } from '@/lib/http/session-messages';
import { IdentityStep, VerifiedDetails } from './IdentityStep';
import { ScooterPicker } from './ScooterPicker';
import { DealerStep } from './DealerStep';
import { IntentFork, type Intent } from './IntentFork';
import { BuyBranch } from './BuyBranch';
import { TestRideConfirmation, TestRideStep, type Booking } from './TestRideStep';
import { ProductPanel, SelectionSummary } from './ProductPanel';
import { Stepper } from './Stepper';
import {
  STEPS,
  clearJourneyCookie,
  prefillSignature,
  writeJourneyCookie,
  type StepId,
} from './journey-state';
import type { Resume } from './resume';
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
 *
 * A refresh loses nothing either. The server reads the journey back (see
 * resume.ts) and this starts from it; every change is bookmarked in the
 * amp_journey cookie. After SESSION_IDLE_MINUTES without activity the server
 * stops honouring the session, and the customer verifies their number again —
 * with everything they chose still in place.
 *
 * With Buy Now switched off (BUY_NOW_ENABLED, off for launch) step 4 drops
 * out: every journey is a test ride, and the dealer step leads straight to
 * the slot picker. Nothing of the buy branch is removed — it comes back with
 * the setting.
 */

interface Props {
  prefill: Prefill;
  attribution: Record<string, unknown>;
  resume: Resume | null;
  idleSeconds: number;
  buyEnabled: boolean;
}

export function BuyJourney({ prefill, attribution, resume, idleSeconds, buyEnabled }: Props) {
  const [step, setStep] = useState<StepId>(resume?.step ?? 'details');

  const [lead, setLead] = useState<LeadCreatedResponse | null>(resume?.lead ?? null);
  const [customerName, setCustomerName] = useState(resume?.name ?? '');
  const [verified, setVerified] = useState(resume?.verified ?? false);
  // Where they were when the session timed out, so verifying again puts them
  // straight back there.
  const [expiredAt, setExpiredAt] = useState<StepId | null>(null);

  const [catalog, setCatalog] = useState<ModelAvailability[] | null>(resume?.catalog ?? null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [modelCode, setModelCode] = useState<string | null>(
    resume ? resume.modelCode : prefill.modelCode,
  );
  const [colourCode, setColourCode] = useState<string | null>(
    resume ? resume.colourCode : prefill.colourCode,
  );

  const [nearby, setNearby] = useState<NearbyDealersResponse | null>(resume?.nearby ?? null);
  const [dealer, setDealer] = useState<NearbyDealer | null>(resume?.dealer ?? null);

  // Arriving from a "Book a test ride" button preselects that card at step 4.
  // With Buy Now off there is no step 4: every journey is a test ride.
  const [intent, setIntent] = useState<Intent | null>(
    !buyEnabled
      ? 'testride'
      : resume
        ? resume.intent
        : prefill.intent === 'buy' || prefill.intent === 'testride'
          ? prefill.intent
          : null,
  );
  const [booking, setBooking] = useState<Booking | null>(resume?.booking ?? null);

  const model = getModel(modelCode);
  const availability = catalog?.find((m) => m.code === modelCode) ?? null;
  const colourName = model?.colours.find((c) => c.code === colourCode)?.name ?? null;
  const pincode = lead?.pincode ?? null;
  const signature = prefillSignature(prefill);

  /* The catalog needs a region, which needs a pincode, which arrives with the
     lead. Fetched while the customer types their code, so step 2 is ready.
     A resumed page arrives with it already. */
  const catalogFor = useRef<string | null>(resume?.catalog ? resume.lead.pincode : null);
  useEffect(() => {
    if (!pincode || catalogFor.current === pincode) return;
    let cancelled = false;
    setCatalogFailed(false);

    (async () => {
      try {
        const res = await fetch(`/api/catalog?pincode=${encodeURIComponent(pincode)}`);
        if (!res.ok) throw new Error('catalog unavailable');
        const data = (await res.json()) as { models: ModelAvailability[] };
        if (cancelled) return;

        catalogFor.current = pincode;
        setCatalog(data.models);
        // Keep the product they came from. Arriving from a product page means
        // that product; arriving from anywhere else means they choose — we
        // do not choose for them.
        setModelCode((current) =>
          current && data.models.some((m) => m.code === current) ? current : null,
        );
      } catch {
        if (!cancelled) setCatalogFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pincode, catalogAttempt]);

  // Dealers belong to a pincode. A NEW pincode means a new list and no choice;
  // the one a resumed page arrived with stays.
  const dealersFor = useRef(pincode);
  useEffect(() => {
    if (dealersFor.current === pincode) return;
    dealersFor.current = pincode;
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

  // Switching between versions of one scooter keeps the colour when the new
  // one comes in it — Standard to Intellipack should not lose Steel Grey.
  const onSelectModel = useCallback((entry: ModelAvailability) => {
    setModelCode(entry.code);
    setColourCode((current) =>
      current && entry.colours.some((c) => c.code === current) ? current : null,
    );
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
  // The steps on offer. Without Buy Now, step 4 (buy or test ride) is not one.
  const steps = STEPS.filter((id) => buyEnabled || id !== 'journey');
  const wanted: StepId = steps.includes(step) ? step : 'finish';
  const current: StepId = ready[wanted]
    ? wanted
    : ([...steps].reverse().find((id) => ready[id] && steps.indexOf(id) < steps.indexOf(wanted)) ??
      'details');
  const currentIndex = steps.indexOf(current);
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  });

  const go = (next: StepId) => setStep(next);

  /* ---------------------------------------------------------------- */
  /* Session: bookmark, keep alive, time out                            */
  /* ---------------------------------------------------------------- */

  // Every change is bookmarked, so a refresh comes back to exactly here.
  useEffect(() => {
    if (!lead) return;
    writeJourneyCookie(
      {
        step: current,
        model: modelCode,
        colour: colourCode,
        dealer: dealer?.code ?? null,
        intent,
        booking: booking?.bookingId ?? null,
        from: signature,
      },
      idleSeconds,
    );
  }, [lead, current, modelCode, colourCode, dealer, intent, booking, signature, idleSeconds]);

  // The server has stopped honouring this session. Keep every choice, and ask
  // for the number again.
  const expire = useCallback(() => {
    setVerified(false);
    setExpiredAt((at) => at ?? currentRef.current);
    setStep('details');
  }, []);

  // Moving between steps is activity, and so is coming back to the tab. Both
  // tell the server, which also tells us if the session has already lapsed —
  // a customer who left the tab for two hours finds out now, not at Pay.
  useEffect(() => {
    if (!verified) return;
    let stale = false;
    const touch = async () => {
      try {
        const res = await fetch('/api/session', { method: 'POST' });
        const body = (await res.json()) as { active?: boolean; verified?: boolean };
        if (!stale && !(body.active && body.verified)) expire();
      } catch {
        // Offline is not expired. The next real request will say.
      }
    };
    void touch();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void touch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stale = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [verified, current, expire]);

  // "Not you?" — forget this browser's lead and journey. For a shared phone.
  const startOver = useCallback(async () => {
    await fetch('/api/session', { method: 'DELETE' }).catch(() => undefined);
    clearJourneyCookie();
    window.location.reload();
  }, []);

  /* ---------------------------------------------------------------- */
  /* Focus and scroll                                                  */
  /* ---------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------- */

  let content: ReactNode = null;
  switch (current) {
    case 'details':
      content =
        verified && lead ? (
          <VerifiedDetails
            name={customerName}
            lead={lead}
            onContinue={() => go('scooter')}
            onStartOver={() => void startOver()}
          />
        ) : (
          <IdentityStep
            prefill={prefill}
            attribution={attribution}
            lead={lead}
            initialName={customerName}
            notice={
              expiredAt
                ? SESSION_EXPIRED_MESSAGE
                : lead && resume && !resume.verified
                  ? 'Welcome back. Verify your number to carry on.'
                  : null
            }
            onSaved={(saved, name) => {
              setLead(saved);
              setCustomerName(name);
            }}
            onVerified={() => {
              setVerified(true);
              go(expiredAt ?? 'scooter');
              setExpiredAt(null);
            }}
            onEdit={() => {
              clearJourneyCookie();
              setExpiredAt(null);
              setLead(null);
            }}
            onStartOver={lead ? () => void startOver() : undefined}
          />
        );
      break;

    case 'scooter':
      content = (
        <ScooterPicker
          models={catalog}
          loadFailed={catalogFailed}
          onRetry={() => setCatalogAttempt((n) => n + 1)}
          layout={prefill.layout}
          showStock={buyEnabled}
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
            go(buyEnabled ? 'journey' : 'finish');
          }}
          onExpired={expire}
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
      if (intent === 'buy' && buyEnabled) {
        content = (
          <BuyBranch
            model={availability}
            colourCode={colourCode}
            dealer={dealer}
            onExpired={expire}
            onBack={() => go('journey')}
          />
        );
      } else if (booking) {
        content = (
          <TestRideConfirmation
            booking={booking}
            canBuy={buyEnabled && availability.price !== null}
            // Spec 4: a completed test ride re-opens the buy branch.
            onBuy={() => {
              setBooking(null);
              setIntent('buy');
            }}
            // Back to the page they came from on the main site — this
            // scooter's own.
            backHref={model?.pageUrl ?? MAIN_SITE}
          />
        );
      } else {
        content = (
          <TestRideStep
            model={availability}
            colourCode={colourCode}
            dealer={dealer}
            onBooked={setBooking}
            onExpired={expire}
            onBack={() => go(buyEnabled ? 'journey' : 'dealer')}
          />
        );
      }
      break;
  }

  const stepperItems = steps.map((id) => ({
    id,
    label: {
      details: 'Details',
      scooter: 'Scooter',
      dealer: 'Dealer',
      journey: 'Journey',
      finish: intent === 'testride' ? 'Test ride' : 'Payment',
    }[id],
  }));

  return (
    <div
      ref={rootRef}
      className="mx-auto grid max-w-7xl scroll-mt-16 grid-cols-1 gap-4 px-3 py-4 sm:gap-6 sm:px-5 sm:py-6 lg:scroll-mt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:gap-10 lg:py-10"
    >
      {/* The scooter. Sticky beside the form once there is room. */}
      <aside aria-label="Your scooter" className="lg:sticky lg:top-24 lg:self-start">
        {/* The chosen scooter; before one is chosen, the whole range. */}
        <ProductPanel model={model} colourCode={colourCode} onColourChange={setColourCode} />
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
            const target = steps[index];
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
