'use client';

import { CheckIcon } from '@/components/Brand';

/**
 * Where the customer is in the journey: "Step 2 of 5", a segmented bar, and on
 * wider screens the five names beneath it.
 *
 * Steps already done are buttons, so a customer can go back to any of them in
 * one tap. Steps ahead are not — each one depends on the answers before it.
 */

export interface StepperItem {
  id: string;
  label: string;
}

interface Props {
  steps: StepperItem[];
  currentIndex: number;
  onJump: (index: number) => void;
}

export function Stepper({ steps, currentIndex, onJump }: Props) {
  const current = steps[currentIndex];

  return (
    <nav aria-label="Booking progress" className="flex flex-col gap-3">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-amp-muted">
        Step {currentIndex + 1} of {steps.length}
        <span className="text-amp-ink sm:hidden"> · {current?.label}</span>
      </p>

      <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          const content = (
            <>
              <span
                aria-hidden
                className={[
                  'block h-1 w-full rounded-full transition-colors duration-300',
                  done || active ? 'bg-amp-accent-fill' : 'bg-amp-line',
                ].join(' ')}
              />
              <span
                className={[
                  'mt-2 hidden items-center gap-1 text-[12px] sm:flex',
                  active ? 'font-semibold text-amp-ink' : done ? 'text-amp-ink/80' : 'text-amp-muted',
                ].join(' ')}
              >
                {done && <CheckIcon className="size-3 text-amp-accent-fill" />}
                {step.label}
              </span>
              <span className="sr-only">
                {step.label}
                {done ? ', completed' : active ? ', current step' : ''}
              </span>
            </>
          );

          return (
            <li key={step.id} aria-current={active ? 'step' : undefined}>
              {done ? (
                <button
                  type="button"
                  onClick={() => onJump(index)}
                  className="block w-full cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-amp-accent/40 sm:hover:[&>span:nth-child(2)]:text-amp-accent-fill"
                >
                  {content}
                </button>
              ) : (
                <div>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
