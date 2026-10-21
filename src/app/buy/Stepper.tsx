'use client';

/**
 * Where the customer is in the journey: a segmented bar, and the current
 * step's name at the far right. No "step 2 of 5" — the bar already says it.
 *
 * Segments for steps already done are buttons, so a customer can go back to
 * any of them in one tap. Steps ahead are not — each one depends on the
 * answers before it.
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
    <nav aria-label="Booking progress" className="flex items-center gap-4">
      <ol className="grid flex-1 gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          const bar = (
            <span
              aria-hidden
              className={[
                'block h-1 w-full rounded-full transition-colors duration-300',
                done || active ? 'bg-amp-accent-fill' : 'bg-amp-line',
              ].join(' ')}
            />
          );

          return (
            <li key={step.id} aria-current={active ? 'step' : undefined}>
              {done ? (
                <button
                  type="button"
                  onClick={() => onJump(index)}
                  aria-label={`Back to ${step.label}`}
                  className="-my-2.5 block w-full cursor-pointer rounded py-2.5 outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-amp-accent/40"
                >
                  {bar}
                </button>
              ) : (
                <div className="-my-2.5 py-2.5">
                  {bar}
                  <span className="sr-only">
                    {step.label}
                    {active ? ', current step' : ''}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p aria-hidden className="shrink-0 text-[13px] font-semibold text-amp-ink">
        {current?.label}
      </p>
    </nav>
  );
}
