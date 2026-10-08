'use client';

import type { ModelAvailability } from '@/lib/catalog/availability';
import { CheckIcon } from '@/components/Brand';
import { Section } from '@/components/ui';

/**
 * The fork. Journey document section 03: once model and colour are chosen, the
 * customer picks Buy Now or Book a Test Ride, and the two branches run their
 * own journeys from there.
 *
 * Spec 4: "Mutual exclusivity is a UI state, not a lock." Both options are
 * always on the page. Choosing one greys the other visibly rather than removing
 * it, and after a completed purchase the test ride re-opens through the
 * cross-sell. A customer is never trapped in a branch.
 */

export type Intent = 'buy' | 'testride';

interface Props {
  model: ModelAvailability;
  /** Null until they choose; set once a branch is running. */
  active: Intent | null;
  /** Set once a purchase has completed — re-opens the test ride. */
  purchased?: boolean;
  onChoose: (intent: Intent) => void;
}

export function IntentFork({ model, active, purchased, onChoose }: Props) {
  // Journey document phase 1: the booking amount is partial, so stock is a
  // lead-time signal rather than a hard gate. We still refuse to sell what we
  // cannot price.
  const canBuy = model.price !== null;

  const buyDisabled = !canBuy || (active === 'testride' && !purchased);
  const rideDisabled = active === 'buy' && !purchased;

  return (
    <Section label="What would you like to do?">

      <div className="grid gap-3 sm:grid-cols-2">
        <IntentCard
          title="Buy now"
          blurb={
            model.price?.partial
              ? `Book it with ${model.price.partial.amount.display}`
              : 'Reserve it online today'
          }
          selected={active === 'buy'}
          disabled={buyDisabled}
          disabledReason={
            !canBuy
              ? 'Not available online in your area yet'
              : 'Finish or leave the test ride first'
          }
          onClick={() => onChoose('buy')}
        />

        <IntentCard
          title="Book a test ride"
          blurb="Free, at home or at the showroom"
          selected={active === 'testride'}
          disabled={rideDisabled}
          disabledReason="Finish your booking first — you can add a test ride after"
          onClick={() => onChoose('testride')}
        />
      </div>

      {!model.inStock && canBuy && (
        // Phase 1 shows a lead time rather than blocking the sale, because the
        // customer is paying a booking amount, not the full price.
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
          {model.name} is in short supply in your area. You can still book one — your dealer
          will confirm the timeline.
        </p>
      )}
    </Section>
  );
}

function IntentCard({
  title,
  blurb,
  selected,
  disabled,
  disabledReason,
  onClick,
}: {
  title: string;
  blurb: string;
  selected: boolean;
  disabled: boolean;
  disabledReason: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      title={disabled ? disabledReason : undefined}
      className={[
        'flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-all duration-200',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amp-accent',
        selected
          ? 'border-amp-accent bg-amp-accent-tint ring-1 ring-amp-accent'
          : 'border-amp-line bg-amp-card hover:border-amp-ink',
        // Greyed and visibly so, not removed.
        disabled
          ? 'cursor-not-allowed opacity-45 hover:border-amp-line'
          : 'cursor-pointer active:scale-[0.995]',
      ].join(' ')}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-[15px] font-semibold text-amp-ink">{title}</span>
        {selected && (
          <span className="flex size-5 items-center justify-center rounded-full bg-amp-accent-fill text-white">
            <CheckIcon className="size-3" />
          </span>
        )}
      </span>
      <span className="text-[13px] leading-relaxed text-amp-muted">
        {disabled ? disabledReason : blurb}
      </span>
    </button>
  );
}
