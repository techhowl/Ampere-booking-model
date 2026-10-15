'use client';

import { useEffect, useState } from 'react';
import type { ModelAvailability } from '@/lib/catalog/availability';
import type { LeadCreatedResponse } from '@/lib/schemas/lead';
import { HELP_TOPICS, HELP_TOPIC_LABELS } from '@/lib/schemas/test-ride';
import type { OfferedDay } from '@/lib/test-rides/slots';
import { Checkbox, Pill, PrimaryButton, Section } from '@/components/ui';
import { ArrowLeftIcon } from '@/components/Brand';

/**
 * The test ride branch: mode, date, slot, help topics.
 *
 * Slots come from the server, computed in IST. Nothing here reads the browser
 * clock — a laptop set to the wrong timezone would otherwise be offered
 * yesterday.
 *
 * Journey document section 03: picking Financing as a help topic opens the EMI
 * widget. That intent signal is collected on the current form and acted on by
 * nobody; here it does something.
 */

interface Props {
  lead: LeadCreatedResponse;
  model: ModelAvailability;
  colourCode: string | null;
  onBooked: (booking: Booking) => void;
  onBack: () => void;
}

export interface Booking {
  bookingId: string;
  mode: 'home' | 'dealer';
  modeChangedReason: string | null;
  slot: string;
  dealer: { name: string; phone: string | null; address: string | null };
  modelName: string;
  dealerNotified: boolean;
}

export function TestRideStep({ lead, model, colourCode, onBooked, onBack }: Props) {
  const [days, setDays] = useState<OfferedDay[] | null>(null);
  const [mode, setMode] = useState<'home' | 'dealer'>('dealer');
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

  function toggleTopic(topic: string, on: boolean) {
    setTopics((current) =>
      on ? [...new Set([...current, topic])] : current.filter((t) => t !== topic),
    );
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
          mode,
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
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? 'We could not book that slot. Please try another.');
    } catch {
      setError('We could not reach our servers. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !days) {
    return (
      <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-700">
        {error}
      </p>
    );
  }

  if (!days) {
    return <p className="py-6 text-center text-[14px] text-amp-muted">Loading times…</p>;
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <button
        type="button"
        onClick={onBack}
        className="flex cursor-pointer items-center gap-1.5 self-start rounded-lg py-1 pr-2 text-[13px] font-medium text-amp-muted transition-colors hover:text-amp-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amp-accent"
      >
        <ArrowLeftIcon className="size-4" />
        Back
      </button>

      <Section label="Mode of test ride">
        <div className="grid grid-cols-2 gap-3">
          <Pill selected={mode === 'home'} onClick={() => setMode('home')} className="uppercase">
            Home
          </Pill>
          <Pill selected={mode === 'dealer'} onClick={() => setMode('dealer')} className="uppercase">
            Dealer
          </Pill>
        </div>
        {mode === 'home' && !lead.dealer?.homeServiceable && (
          <p className="text-[13px] leading-relaxed text-amp-muted">
            Home rides may not be available in your area. If not, we&apos;ll book you at the
            showroom and tell you.
          </p>
        )}
      </Section>

      <Section label="Date picker">
        <div className="amp-scroll -mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1">
          {days.map((day) => {
            const isSelected = day.date === date;
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
                  'flex min-w-22 shrink-0 flex-col items-center gap-0.5 rounded-xl border px-4 py-3 transition-all duration-200',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amp-accent',
                  isSelected
                    ? 'border-amp-accent-fill bg-amp-accent-fill text-white'
                    : day.hasAvailability
                      ? 'border-amp-line bg-white text-amp-ink hover:border-amp-ink'
                      : 'border-transparent bg-amp-disabled text-white',
                  day.hasAvailability ? 'cursor-pointer active:scale-[0.98]' : 'cursor-not-allowed',
                ].join(' ')}
              >
                <span className="text-[12px] opacity-80">{day.label.split(' ')[0]}</span>
                <span className="text-[15px] font-bold">
                  {day.date.slice(8)}{' '}
                  {new Date(`${day.date}T00:00:00Z`).toLocaleString('en-GB', {
                    month: 'short',
                    timeZone: 'UTC',
                  })}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {selectedDay && (
        <Section label="Time slot">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {selectedDay.windows.map((window) => (
              <Pill
                key={window.code}
                selected={window.code === slot}
                disabled={!window.available}
                onClick={() => setSlot(window.code)}
              >
                {window.label.replace(/–/g, '-')}
              </Pill>
            ))}
          </div>
          {!selectedDay.hasAvailability && (
            <p className="text-[13px] text-amp-muted">No times left today — pick another day.</p>
          )}
        </Section>
      )}

      <Section label="Is there anything we can help you with?">
        <div className="flex flex-wrap gap-x-6 gap-y-2.5">
          {HELP_TOPICS.map((topic) => (
            <Checkbox
              key={topic}
              checked={topics.includes(topic)}
              onChange={(on) => toggleTopic(topic, on)}
            >
              {HELP_TOPIC_LABELS[topic]}
            </Checkbox>
          ))}
        </div>
      </Section>

      {/*
        Picking Financing does something, rather than filing the signal away —
        but what it does is set an expectation, not quote a rate. We do not
        know this customer's lender, and the dealer will.
      */}
      {wantsFinancing && (
        <div className="amp-rise rounded-2xl border border-amp-accent/30 bg-amp-accent-tint px-4 py-3">
          <p className="text-[13px] leading-relaxed text-amp-ink">
            We&apos;ll have someone go through the finance options with you on the day — EMI plans,
            tenures and what you&apos;d need to bring.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {error}
        </p>
      )}

      <PrimaryButton type="submit" disabled={submitting || !date || !slot}>
        {submitting ? 'Booking…' : 'Book a test ride'}
      </PrimaryButton>

      <p className="text-center text-[12px] leading-relaxed text-amp-muted">
        Free, and no obligation to buy.
      </p>
    </form>
  );
}

/* ------------------------------------------------------------------ */

export function TestRideConfirmation({ booking }: { booking: Booking }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-amp-accent/30 bg-amp-accent-tint p-4">
        <p className="text-[16px] font-bold text-amp-ink">Your test ride is booked</p>
        <p className="mt-1 text-[14px] leading-relaxed text-amp-ink/80">
          {booking.modelName}, {booking.slot},{' '}
          {booking.mode === 'home' ? 'at your home' : `at ${booking.dealer.name}`}.
        </p>
      </div>

      {/* Never silently move someone's test ride. */}
      {booking.modeChangedReason && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
          {booking.modeChangedReason}
        </p>
      )}

      <div className="rounded-2xl border border-amp-line bg-amp-card p-4">
        <p className="text-[13px] font-semibold text-amp-ink">{booking.dealer.name}</p>
        {booking.dealer.address && (
          <p className="mt-0.5 text-[13px] leading-relaxed text-amp-muted">
            {booking.dealer.address}
          </p>
        )}
        {booking.dealer.phone && (
          <a
            href={`tel:${booking.dealer.phone}`}
            className="mt-2 inline-block text-[13px] font-semibold text-amp-accent underline-offset-4 hover:underline"
          >
            {booking.dealer.phone}
          </a>
        )}
      </div>

      <p className="text-[13px] leading-relaxed text-amp-muted">
        {booking.dealerNotified
          ? 'The dealer has been notified and will confirm with you shortly.'
          : 'We are still passing this to the dealer. Your booking is confirmed either way.'}
      </p>
    </div>
  );
}
