'use client';

import type { ReactNode } from 'react';
import { ArrowLeftIcon } from '@/components/Brand';
import { FOCUS } from '@/components/ui';

/**
 * The pieces every step shares: a heading with a line under it, and a footer
 * with Back on the left and the step's one primary action filling the rest.
 *
 * The heading takes focus when a step opens (BuyJourney does that), so a
 * screen reader announces where the customer has arrived rather than staying
 * on a button that no longer exists.
 */

export function StepHeader({ title, text }: { title: string; text?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1.5">
      <h2
        tabIndex={-1}
        data-step-heading
        className="text-[24px] font-bold leading-tight tracking-tight text-amp-ink outline-none sm:text-[28px]"
      >
        {title}
      </h2>
      {text && <p className="text-[15px] leading-relaxed text-amp-muted">{text}</p>}
    </header>
  );
}

export function StepActions({
  onBack,
  children,
}: {
  onBack?: () => void;
  /** The primary action. Takes the remaining width. */
  children: ReactNode;
}) {
  return (
    <div className="flex items-stretch gap-3 pt-1">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className={[
            'inline-flex min-h-13 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-amp-line bg-white px-4',
            'text-[15px] font-medium text-amp-ink transition-all duration-200 hover:border-amp-ink active:scale-[0.99] sm:px-5',
            FOCUS,
          ].join(' ')}
        >
          <ArrowLeftIcon className="size-4" />
          Back
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col [&>button]:w-full">{children}</div>
    </div>
  );
}
