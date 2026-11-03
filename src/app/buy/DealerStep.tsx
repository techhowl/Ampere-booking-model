'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { displayPhone, isValidPincode } from '@/lib/phone-format';
import { PINCODE_INVALID_MESSAGE } from '@/lib/schemas/lead';
import type { NearbyDealer, NearbyDealersResponse } from '@/lib/schemas/dealer';
import { Notice, PrimaryButton, SelectionDot, Skeleton, inputClass } from '@/components/ui';
import { PhoneIcon, PinIcon, StoreIcon } from '@/components/Brand';
import { SUPPORT_PHONE } from '@/lib/contact';
import { StepActions, StepHeader } from './StepFrame';

/**
 * Step three: up to three dealers near the customer's pincode.
 *
 * The list comes from the server, nearest first, never padded. The choice is
 * written onto the lead before moving on, so the order or test ride that
 * follows goes to this dealer — and so does the call, if they stop here.
 */

interface Props {
  pincode: string;
  /** The last list fetched for this pincode, so Back and forward do not refetch. */
  cached: NearbyDealersResponse | null;
  onLoaded: (data: NearbyDealersResponse) => void;
  /** Already chosen, or carried in from the dealer locator. */
  preferredCode: string | null;
  onConfirmed: (dealer: NearbyDealer) => void;
  /** The session timed out; the journey asks for the OTP again. */
  onExpired: () => void;
  onBack: () => void;
  /**
   * "Change location": no dealership near this pincode, so try another. Moves
   * the lead to it and resolves to null, or to a message to show.
   */
  onChangePincode: (pincode: string) => Promise<string | null>;
}

const NETWORK_ERROR = 'We couldn’t process your request. Please try again in a moment.';

export function DealerStep({
  pincode,
  cached,
  onLoaded,
  preferredCode,
  onConfirmed,
  onExpired,
  onBack,
  onChangePincode,
}: Props) {
  const [data, setData] = useState<NearbyDealersResponse | null>(
    cached?.pincode === pincode ? cached : null,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  // Once the customer has chosen, a "Great choice!" line names their dealer.
  // Every card stays on screen, so changing their mind is one more tap.
  const [chosen, setChosen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One key per dealer: retrying the same choice replays, a new choice is new.
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    setLoadFailed(false);
    (async () => {
      try {
        const res = await fetch(`/api/dealers/nearby?pincode=${encodeURIComponent(pincode)}`);
        if (!res.ok) throw new Error('nearby failed');
        const body = (await res.json()) as NearbyDealersResponse;
        if (cancelled) return;
        setData(body);
        onLoaded(body);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data, pincode, attempt, onLoaded]);

  // Preselect once the list is in: their earlier choice, else the dealer they
  // came from, else the nearest.
  useEffect(() => {
    if (!data || selectedCode) return;
    const codes = data.dealers.map((d) => d.code);
    const returning = !!preferredCode && codes.includes(preferredCode);
    setSelectedCode(returning ? preferredCode : (codes[0] ?? null));
    // Coming back to a choice already made: show it as made.
    setChosen(returning);
  }, [data, preferredCode, selectedCode]);

  async function confirm() {
    const dealer = data?.dealers.find((d) => d.code === selectedCode);
    if (!dealer) return;

    let key = keys.current.get(dealer.code);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(dealer.code, key);
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/leads/dealer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ dealerCode: dealer.code }),
      });
      if (res.ok) {
        onConfirmed(dealer);
        return;
      }
      if (res.status === 401) return onExpired();
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? 'Something went wrong. Please try again.');
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setSaving(false);
    }
  }

  const dealers = data?.dealers ?? [];
  const selected = dealers.find((d) => d.code === selectedCode) ?? null;

  return (
    <div className="flex flex-col gap-7">
      <StepHeader
        eyebrow="Find your nearest dealer"
        title="Choose an authorised Ampere dealership near you and take the next step towards your new ride."
      />

      {!data && !loadFailed && (
        <div className="flex flex-col gap-3" aria-busy>
          <p className="text-[13px] text-amp-muted">Finding dealerships near you…</p>
          <Skeleton className="h-6 w-56 rounded-full" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      )}

      {loadFailed && (
        <Notice tone="error">
          Something went wrong. Please try again.{' '}
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="cursor-pointer font-semibold underline underline-offset-4"
          >
            Try again
          </button>
        </Notice>
      )}

      {data && dealers.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="inline-flex items-center gap-1.5 text-[13px] text-amp-muted">
            <PinIcon className="size-4" />
            Your nearest Ampere experience centres:
          </p>

          <div role="group" aria-label="Dealers" className="flex flex-col gap-3">
            {dealers.map((dealer) => (
              <DealerCard
                key={dealer.code}
                dealer={dealer}
                nearest={dealer.code === dealers[0]?.code && data.basis !== 'region' && dealers.length > 1}
                selected={dealer.code === selectedCode}
                onSelect={() => {
                  setSelectedCode(dealer.code);
                  setChosen(true);
                }}
              />
            ))}
          </div>

          <p className="text-[14px] text-amp-ink" aria-live="polite">
            {chosen && selected && (
              <span key={selected.code} className="amp-rise block">
                Great choice! Your preferred dealership is{' '}
                <span className="font-semibold">{selected.name}</span>.
              </span>
            )}
          </p>
        </div>
      )}

      {data && dealers.length === 0 && <NoDealership pincode={pincode} onChangePincode={onChangePincode} />}

      {error && <Notice tone="error">{error}</Notice>}

      <StepActions onBack={onBack}>
        <PrimaryButton onClick={() => void confirm()} loading={saving} disabled={!selectedCode}>
          Continue to Test Ride
        </PrimaryButton>
      </StepActions>
    </div>
  );
}

/**
 * No dealership within reach of this pincode. The customer can try another
 * — where they work, say — without leaving the step.
 */
function NoDealership({
  pincode,
  onChangePincode,
}: {
  pincode: string;
  onChangePincode: (pincode: string) => Promise<string | null>;
}) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!isValidPincode(value)) return setMessage(PINCODE_INVALID_MESSAGE);
    if (value === pincode) return setMessage('That is the pincode we just searched. Try another.');
    setBusy(true);
    setMessage(null);
    const problem = await onChangePincode(value);
    setBusy(false);
    if (problem) setMessage(problem);
  }

  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-amp-line bg-amp-page/50 px-6 py-9 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-white text-amp-ink shadow-sm">
        <StoreIcon className="size-6" />
      </span>
      <p className="mt-4 text-[16px] font-semibold text-amp-ink">
        No dealerships available in your area right now
      </p>
      <p className="mt-1.5 max-w-[38ch] text-[14px] leading-relaxed text-amp-muted">
        Try another location or pincode to discover an Ampere dealership near you.
      </p>

      <form onSubmit={submit} noValidate className="mt-5 flex w-full max-w-sm flex-col gap-2 sm:flex-row">
        <label htmlFor={inputId} className="sr-only">
          Pincode
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          placeholder="Enter another pincode"
          className={`${inputClass(!!message)} text-center sm:text-left`}
          aria-invalid={!!message}
          aria-describedby={`${inputId}-message`}
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-amp-cta px-5 text-[14px] font-semibold text-white transition-colors hover:bg-amp-cta-hover disabled:cursor-wait disabled:opacity-70"
        >
          <PinIcon className="size-4" />
          {busy ? 'Processing your request…' : 'Change Location'}
        </button>
      </form>
      <p id={`${inputId}-message`} role={message ? 'alert' : undefined} className="mt-2 min-h-5 text-[13px] text-red-600">
        {message}
      </p>

      <a
        href={`tel:${SUPPORT_PHONE.tel}`}
        className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-amp-ink underline-offset-4 hover:underline"
      >
        <PhoneIcon className="size-3.5" />
        Or call us on {SUPPORT_PHONE.display}
      </a>
    </div>
  );
}

function DealerCard({
  dealer,
  nearest,
  selected,
  onSelect,
}: {
  dealer: NearbyDealer;
  nearest: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    // The tel: link sits outside the select button — one control inside
    // another is invalid HTML and confuses screen readers.
    <div
      className={[
        'rounded-2xl border transition-all duration-200',
        selected
          ? 'border-amp-accent bg-amp-accent-tint/50 ring-1 ring-amp-accent shadow-[0_10px_30px_-18px_rgba(47,110,212,0.55)]'
          : 'border-amp-line bg-white hover:border-amp-ink/35',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full cursor-pointer items-start gap-3.5 rounded-2xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amp-accent/60"
      >
        <span
          aria-hidden
          className={[
            'flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors',
            selected ? 'bg-amp-accent-fill text-white' : 'bg-amp-page text-amp-ink',
          ].join(' ')}
        >
          <StoreIcon className="size-5" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold leading-snug text-amp-ink">{dealer.name}</span>
            {nearest && (
              <span className="rounded-full bg-amp-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                Nearest
              </span>
            )}
          </span>
          {dealer.address && (
            <span className="mt-1 block text-[13px] leading-relaxed text-amp-muted">
              {dealer.address}
            </span>
          )}
          {/* No "home test rides" badge: rides are at the showroom for now. */}
          {dealer.distanceKm !== null && (
            <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-amp-ink">
              <PinIcon className="size-3.5" />
              {formatDistance(dealer.distanceKm)}
            </span>
          )}
        </span>

        <SelectionDot selected={selected} />
      </button>

      {/* Every card carries a number: the dealer's own, or customer care when
          the dealer master has none, so the customer always has someone to call. */}
      <div className="border-t border-amp-line/70 px-4 py-2.5 pl-17.5">
        <a
          href={`tel:${dealer.phone ?? SUPPORT_PHONE.tel}`}
          className="inline-flex items-center gap-1.5 rounded text-[13px] font-semibold text-amp-accent-fill underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-amp-accent"
        >
          <PhoneIcon className="size-3.5" />
          {dealer.phone ? displayPhone(dealer.phone) : `Customer care · ${SUPPORT_PHONE.display}`}
        </a>
      </div>
    </div>
  );
}

function formatDistance(km: number): string {
  if (km < 1) return 'Under 1 km away';
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}
