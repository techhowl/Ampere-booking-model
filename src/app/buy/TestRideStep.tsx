'use client';

import { useEffect, useState } from 'react';
import type { ModelAvailability } from '@/lib/catalog/availability';
import type { NearbyDealer } from '@/lib/schemas/dealer';
import { HELP_TOPIC_LABELS, SHOWN_HELP_TOPICS, type HelpTopic } from '@/lib/schemas/test-ride';
import { getModel } from '@/lib/catalog/catalog';
import { displayPhone } from '@/lib/phone-format';
import { SUPPORT_PHONE } from '@/lib/contact';
import type { OfferedDay } from '@/lib/test-rides/slots';
import { FOCUS, Notice, Pill, PrimaryButton, Skeleton } from '@/components/ui';
import { CheckIcon, PhoneIcon, StoreIcon } from '@/components/Brand';
import { StepActions, StepHeader } from './StepFrame';

/**
 * Step five, test ride: which day, which slot, and anything we can help with
 * on the day.
 *
 * Always at the showroom chosen in step three. Home rides are not offered for
 * now, so the choice is not shown at all — the backend still understands
 * 'home' for when they are.
 *
 * Slots come from the server, computed in IST. Nothing here reads the browser
 * clock — a laptop set to the wrong timezone would otherwise be offered
 * yesterday.
 *
 * Journey document section 03: picking Financing as a help topic does
 * something rather than filing the signal away.
 */

interface Props {
  model: ModelAvailability;
  colourCode: string | null;
  dealer: NearbyDealer | null;
  onBooked: (booking: Booking) => void;
  /** The session timed out; the journey asks for the OTP again. */
  onExpired: () => void;
  onBack: () => void;
}

export interface Booking {
  bookingId: string;
  mode: 'home' | 'dealer';
  modeChangedReason: string | null;
  slot: string;
  dealer: { name: string; phone: string | null; address: string | null };
  modelName: string;
  /** Null when not known — a confirmation shown again after a refresh. */
  dealerNotified: boolean | null;
}

export function TestRideStep({ model, colourCode, dealer, onBooked, onExpired, onBack }: Props) {
  const [days, setDays] = useState<OfferedDay[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/test-rides');
        if (!res.ok) throw new Error('slots unavailable');
        const data = (await res.json()) as { days: OfferedDay[] };
        if (cancelled) return;
        setDays(data.days);
        // Default to the first day with anything left — today if it is early,
        // tomorrow once today has run out.
        setDate(data.days.find((d) => d.hasAvailability)?.date ?? null);
      } catch {
        if (!cancelled) setError('We could not load available times. Please refresh.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedDay = days?.find((d) => d.date === date) ?? null;
  const wantsFinancing = topics.includes('financing');

  function toggleTopic(topic: HelpTopic) {
    const on = !topics.includes(topic);
    setTopics((current) => (on ? [...current, topic] : current.filter((t) => t !== topic)));
    // Asking for the brochure hands it over there and then, rather than
    // promising to send it. Ours download; a main-site leaflet opens in a tab.
    if (topic === 'brochure' && on) downloadBrochure();
  }

  function downloadBrochure() {
    const url = getModel(model.code)?.brochureUrl;
    if (!url) return;
    if (url.startsWith('/')) {
      const link = document.createElement('a');
      link.href = url;
      link.download = url.slice(url.lastIndexOf('/') + 1);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!date || !slot) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/test-rides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          modelCode: model.code,
          colourCode,
          mode: 'dealer',
          slotDate: date,
          slotWindow: slot,
          // The schema takes one topic; send the first chosen. Multi-select is
          // the design's shape and the column holds a single value today.
          helpTopic: topics[0] ?? null,
        }),
      });

      if (res.ok) {
        onBooked((await res.json()) as Booking);
        return;
      }
      if (res.status === 401) return onExpired();
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? 'We could not book that slot. Please try another.');
    } catch {
      setError('We could not reach our servers. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <StepHeader
      title="Book Your Test Ride"
      text="Pick a time that suits you. It’s free, with no obligation to buy."
    />
  );

  if (!days) {
    return (
      <div className="flex flex-col gap-7">
        {header}
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <div className="flex flex-col gap-3" aria-busy aria-label="Loading times">
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        )}
        <StepActions onBack={onBack}>
          <PrimaryButton disabled>Book Test Ride</PrimaryButton>
        </StepActions>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-7">
      {header}

      {dealer && (
        <div className="flex items-start gap-3 rounded-2xl bg-amp-page/70 px-4 py-3">
          <StoreIcon className="mt-0.5 size-5 shrink-0 text-amp-ink" />
          <p className="text-[13px] leading-relaxed text-amp-muted">
            At <span className="font-semibold text-amp-ink">{dealer.name}</span>
            {dealer.address ? <>, {dealer.address}</> : null}
          </p>
        </div>
      )}

      <Group label="Day">
        <div className="amp-scroll -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-8 sm:px-8">
          {days.map((day) => {
            const isSelected = day.date === date;
            const [weekday, ...rest] = day.label.split(' ');
            return (
              <button
                key={day.date}
                type="button"
                disabled={!day.hasAvailability}
                onClick={() => {
                  setDate(day.date);
                  setSlot(null);
                }}
                aria-pressed={isSelected}
                className={[
                  'flex min-w-20 shrink-0 flex-col items-center gap-0.5 rounded-xl border px-3.5 py-2.5 transition-all duration-200',
                  FOCUS,
                  isSelected
                    ? 'border-amp-accent-fill bg-amp-accent-fill text-white shadow-[0_8px_20px_-12px_rgba(47,110,212,0.8)]'
                    : day.hasAvailability
                      ? 'border-amp-line bg-white text-amp-ink hover:border-amp-ink'
                      : 'border-transparent bg-amp-page text-amp-muted/60',
                  day.hasAvailability ? 'cursor-pointer active:scale-[0.98]' : 'cursor-not-allowed',
                ].join(' ')}
              >
                <span className="text-[12px] opacity-80">{weekday}</span>
                <span className="text-[15px] font-bold">
                  {rest.length > 0
                    ? rest.join(' ')
                    : new Date(`${day.date}T00:00:00Z`).toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        timeZone: 'UTC',
                      })}
                </span>
              </button>
            );
          })}
        </div>
      </Group>

      {selectedDay && (
        <Group label="Time">
          <div className="grid grid-cols-2 gap-2.5">
            {selectedDay.windows.map((window) => (
              <Pill
                key={window.code}
                selected={window.code === slot}
                disabled={!window.available}
                onClick={() => setSlot(window.code)}
                // One line even on a narrow phone: the 12-hour labels are long.
                className="whitespace-nowrap rounded-xl px-1.5 text-[12px] sm:px-4 sm:text-[14px]"
              >
                {window.label}
              </Pill>
            ))}
          </div>
          {!selectedDay.hasAvailability && (
            <p className="text-[13px] text-amp-muted">No times left today — pick another day.</p>
          )}
        </Group>
      )}

      <Group label="Anything we can help you with?" hint="Optional">
        <div className="flex flex-wrap gap-2">
          {SHOWN_HELP_TOPICS.map((topic) => {
            const on = topics.includes(topic);
            return (
              <button
                key={topic}
                type="button"
                aria-pressed={on}
                onClick={() => toggleTopic(topic)}
                className={[
                  'inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-[13px] transition-all duration-200',
                  FOCUS,
                  on
                    ? 'border-amp-ink bg-amp-ink font-semibold text-white'
                    : 'border-amp-line bg-white text-amp-ink hover:border-amp-ink',
                ].join(' ')}
              >
                {on && <CheckIcon className="size-3.5" />}
                {HELP_TOPIC_LABELS[topic]}
              </button>
            );
          })}
        </div>
      </Group>

      {/*
        Picking Financing does something, rather than filing the signal away —
        but what it does is set an expectation, not quote a rate.
      */}
      {wantsFinancing && (
        <Notice className="amp-rise">
          We&apos;ll have someone go through the finance options with you on the day — plans,
          tenures and what you&apos;d need to bring.
        </Notice>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-col gap-3">
        <StepActions onBack={onBack}>
          <PrimaryButton type="submit" loading={submitting} disabled={!date || !slot}>
            Book Test Ride
          </PrimaryButton>
        </StepActions>
        {!slot && (
          <p className="text-center text-[12px] text-amp-muted">Pick a time to continue.</p>
        )}
      </div>
    </form>
  );
}

function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-3 w-full">
        <span className="flex items-baseline justify-between text-[13px] font-medium text-amp-ink">
          {label}
          {hint && <span className="text-[12px] font-normal text-amp-muted">{hint}</span>}
        </span>
      </legend>
      {children}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */

export function TestRideConfirmation({
  booking,
  canBuy,
  onBuy,
  backHref,
}: {
  booking: Booking;
  canBuy: boolean;
  onBuy: () => void;
  /** The scooter's own page on ampere-electric.com — where they came from. */
  backHref: string;
}) {
  const phone = booking.dealer.phone;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <span className="amp-pop flex size-14 items-center justify-center rounded-full bg-amp-offer text-amp-offer-ink">
          <CheckIcon className="size-7" />
        </span>
        <h2
          tabIndex={-1}
          data-step-heading
          className="text-[24px] font-bold leading-tight tracking-tight text-amp-ink outline-none sm:text-[28px]"
        >
          Your Test Ride Is Booked
        </h2>
        <p className="max-w-[40ch] text-[15px] leading-relaxed text-amp-muted">
          {booking.modelName}, {booking.slot},{' '}
          {booking.mode === 'home' ? 'at your home' : `at ${booking.dealer.name}`}.
        </p>
      </div>

      {/* Never silently move someone's test ride. */}
      {booking.modeChangedReason && <Notice tone="warn">{booking.modeChangedReason}</Notice>}

      <div className="flex items-start gap-3.5 rounded-2xl border border-amp-line bg-white p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amp-page text-amp-ink">
          <StoreIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-amp-ink">{booking.dealer.name}</p>
          {booking.dealer.address && (
            <p className="mt-0.5 text-[13px] leading-relaxed text-amp-muted">
              {booking.dealer.address}
            </p>
          )}
          {/* The number itself, so it can be read and saved, not just tapped.
              Customer care when the dealer master has none. */}
          <a
            href={`tel:${phone ?? SUPPORT_PHONE.tel}`}
            className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-amp-accent-fill underline-offset-4 hover:underline"
          >
            <PhoneIcon className="size-3.5" />
            {phone ? displayPhone(phone) : `Customer care · ${SUPPORT_PHONE.display}`}
          </a>
        </div>
      </div>

      <p className="text-center text-[13px] leading-relaxed text-amp-muted">
        {booking.dealerNotified === true
          ? 'The dealer has been notified and will confirm with you shortly.'
          : booking.dealerNotified === false
            ? 'We are still passing this to the dealer. Your booking is confirmed either way.'
            : 'Your dealer will confirm with you shortly.'}
      </p>

      {/* Spec 4: the cross-sell re-opens the other branch. A completed test
          ride is not the end of the journey. */}
      <div className="flex flex-col gap-3">
        {canBuy && <PrimaryButton onClick={onBuy}>Buy your {booking.modelName} now</PrimaryButton>}
        <a
          href={backHref}
          className={`flex min-h-11 items-center justify-center rounded-xl text-[14px] font-medium text-amp-muted transition-colors hover:text-amp-ink ${FOCUS}`}
        >
          Back to the scooters
        </a>
      </div>
    </div>
  );
}
