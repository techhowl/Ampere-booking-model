'use client';

import type { ReactNode } from 'react';
import type { ModelAvailability } from '@/lib/catalog/availability';
import type { NearbyDealer } from '@/lib/schemas/dealer';
import { BagIcon, CalendarIcon, CheckIcon } from '@/components/Brand';
import { ChoiceCard, Notice, PrimaryButton, SelectionDot } from '@/components/ui';
import { StepActions, StepHeader } from './StepFrame';

/**
 * Step four, the fork. Journey document section 03: once model, colour and
 * dealer are chosen, the customer picks Buy Now or Book a Test Ride, and each
 * branch runs its own journey from there.
 *
 * Spec 4: "Mutual exclusivity is a UI state, not a lock." Either can be
 * chosen, and coming back here to choose the other is always allowed. The only
 * thing that disables Buy Now is not being able to price it.
 */

export type Intent = 'buy' | 'testride';

interface Props {
  model: ModelAvailability;
  colourName: string | null;
  dealer: NearbyDealer | null;
  selected: Intent | null;
  onSelect: (intent: Intent) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function IntentFork({
  model,
  colourName,
  dealer,
  selected,
  onSelect,
  onBack,
  onContinue,
}: Props) {
  // We refuse to sell what we cannot price. Stock is a lead-time signal, not a
  // gate — phase 1 takes a booking amount, not the whole price.
  const canBuy = model.price !== null;
  const choice = selected === 'buy' && !canBuy ? null : selected;

  return (
    <div className="flex flex-col gap-7">
      <StepHeader
        title="How Would You Like to Proceed?"
        text={`Your ${model.name}${colourName ? ` in ${colourName}` : ''} is ready. Buy it online, or ride it first.`}
      />

      <div role="group" aria-label="Buy or test ride" className="grid gap-3 sm:grid-cols-2">
        <IntentCard
          icon={<BagIcon className="size-6" />}
          title="Buy Now"
          blurb={
            !canBuy
              ? 'Not available online in your area yet.'
              : model.price?.partial
                ? `Book yours online from ${model.price.partial.amount.display}.`
                : 'Pay online and reserve yours today.'
          }
          points={['Full or partial payment', dealer ? `Through ${dealer.name}` : 'Through your dealer']}
          selected={choice === 'buy'}
          disabled={!canBuy}
          onSelect={() => onSelect('buy')}
        />
        <IntentCard
          icon={<CalendarIcon className="size-6" />}
          title="Book a Test Ride"
          blurb="Feel it on the road before you decide."
          points={[
            'Free, no obligation',
            dealer?.homeServiceable ? 'At home or at the showroom' : 'At the showroom',
          ]}
          selected={choice === 'testride'}
          onSelect={() => onSelect('testride')}
        />
      </div>

      {!model.inStock && canBuy && (
        <Notice tone="warn">
          {model.name} is in short supply in your area. You can still book one — your dealer will
          confirm the timeline.
        </Notice>
      )}

      <StepActions onBack={onBack}>
        <PrimaryButton onClick={onContinue} disabled={!choice}>
          {choice === 'testride' ? 'Continue to Test Ride' : choice === 'buy' ? 'Continue to Payment' : 'Continue'}
        </PrimaryButton>
      </StepActions>
    </div>
  );
}

function IntentCard({
  icon,
  title,
  blurb,
  points,
  selected,
  disabled,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  blurb: string;
  points: string[];
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <ChoiceCard selected={selected} disabled={disabled} onClick={onSelect} className="h-full">
      <span className="flex h-full flex-col gap-4 p-5">
        <span className="flex items-start justify-between">
          <span
            aria-hidden
            className={[
              'flex size-12 items-center justify-center rounded-2xl transition-colors duration-200',
              selected ? 'bg-amp-accent-fill text-white' : 'bg-amp-ink text-white',
            ].join(' ')}
          >
            {icon}
          </span>
          <SelectionDot selected={selected} />
        </span>

        <span className="flex flex-col gap-1">
          <span className="text-[17px] font-bold text-amp-ink">{title}</span>
          <span className="text-[13px] leading-relaxed text-amp-muted">{blurb}</span>
        </span>

        {!disabled && (
          <span className="mt-auto flex flex-col gap-1.5 border-t border-amp-line/70 pt-3">
            {points.map((point) => (
              <span key={point} className="flex items-start gap-2 text-[12px] leading-snug text-amp-ink">
                <CheckIcon className="mt-px size-3.5 shrink-0 text-amp-accent-fill" />
                {point}
              </span>
            ))}
          </span>
        )}
      </span>
    </ChoiceCard>
  );
}
