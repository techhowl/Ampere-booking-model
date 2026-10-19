'use client';

import type { ReactNode } from 'react';
import { CheckIcon, LockIcon } from './Brand';

/**
 * The controls the Figma uses throughout: fully-rounded pills, white fill,
 * thin border, blue when selected. Defined once so every step looks the same
 * and a design change lands in one place.
 *
 * Three rules every control here honours:
 *   - a 44px minimum touch target, because this is a mobile-first page
 *   - a visible focus ring, so the journey is completable by keyboard
 *   - cursor-pointer on anything clickable
 */

/** Focus ring applied to every interactive control. */
export const FOCUS =
  'outline-none focus-visible:ring-4 focus-visible:ring-amp-accent/25 focus-visible:border-amp-accent';

export function Pill({
  selected,
  disabled,
  onClick,
  children,
  className,
  title,
}: {
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      title={title}
      className={[
        'min-h-11 rounded-full border px-5 text-[14px] transition-all duration-200',
        FOCUS,
        selected
          ? 'border-amp-accent-fill bg-amp-accent-fill font-semibold text-white shadow-[0_1px_2px_rgba(16,21,28,0.08)]'
          : 'border-amp-line bg-white text-amp-ink hover:border-amp-ink',
        disabled
          ? 'cursor-not-allowed opacity-40 hover:border-amp-line'
          : 'cursor-pointer active:scale-[0.98]',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/**
 * The black primary action. Square-ish, not a pill — the design is specific.
 *
 * `loading` keeps the label and adds a spinner, so the button does not change
 * width under the customer's thumb while a request is in flight.
 */
export function PrimaryButton({
  disabled,
  loading,
  onClick,
  type = 'button',
  children,
  className,
}: {
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  children: ReactNode;
  className?: string;
}) {
  disabled = disabled || loading;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex min-h-13 items-center justify-center gap-2.5 rounded-xl bg-amp-cta px-6',
        'text-[15px] font-semibold tracking-wide text-white',
        'shadow-[0_1px_2px_rgba(16,21,28,0.16),0_8px_24px_-12px_rgba(16,21,28,0.5)]',
        'transition-all duration-200 hover:bg-amp-cta-hover hover:shadow-[0_2px_4px_rgba(16,21,28,0.2),0_12px_28px_-10px_rgba(16,21,28,0.55)]',
        FOCUS,
        disabled
          ? 'cursor-not-allowed bg-amp-disabled text-white/70 shadow-none hover:bg-amp-disabled hover:shadow-none'
          : 'cursor-pointer active:scale-[0.99]',
        className ?? '',
      ].join(' ')}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

/** Secondary action — same footprint, quieter. */
export function SecondaryButton({
  onClick,
  children,
  className,
}: {
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex min-h-13 cursor-pointer items-center justify-center gap-2 rounded-xl',
        'border border-amp-line bg-white px-6 text-[15px]',
        'font-medium text-amp-ink transition-all duration-200 hover:border-amp-ink active:scale-[0.99]',
        FOCUS,
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={htmlFor} className="cursor-pointer text-[13px] font-medium text-amp-ink">
          {label}
        </label>
      )}
      {children}
      {/* Reserve the line so revealing an error does not shift the layout. */}
      {error ? (
        <p role="alert" className="text-[13px] leading-snug text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] leading-snug text-amp-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function inputClass(invalid?: boolean): string {
  return [
    'w-full min-h-13 rounded-xl border bg-white px-4 text-[15px] text-amp-ink',
    'placeholder:text-amp-muted/60 outline-none transition-all duration-200',
    'focus:border-amp-accent focus:ring-4 focus:ring-amp-accent/15',
    'disabled:cursor-not-allowed disabled:bg-amp-page/60 disabled:text-amp-ink/70',
    invalid
      ? 'border-red-400 bg-red-50/40'
      : 'border-amp-line hover:border-amp-ink/35',
  ].join(' ');
}

export function Section({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-3 ${className ?? ''}`}>
      {label && <h2 className="amp-label">{label}</h2>}
      {children}
    </section>
  );
}

export function Checkbox({
  checked,
  onChange,
  invalid,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1 text-[13px] leading-relaxed text-amp-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-invalid={invalid}
        className={[
          'mt-0.5 size-[18px] shrink-0 cursor-pointer rounded accent-amp-accent',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amp-accent',
          invalid ? 'outline outline-1 outline-red-400' : '',
        ].join(' ')}
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * Trust marks beside the pay button.
 *
 * Not decoration. The page asks for money on a phone, from a customer who has
 * never seen it before, and these three facts are all true: the connection is
 * encrypted, Juspay runs the payment, and no card details touch Ampere.
 * Saying so is the cheapest conversion work available on a checkout.
 */
export function PaymentTrust() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-white px-4 py-3">
      <LockIcon className="mt-px size-4 shrink-0 text-amp-muted" />
      <p className="text-[12px] leading-relaxed text-amp-muted">
        Payment is handled by <strong className="font-semibold text-amp-ink">Juspay</strong> on
        their secure page. Ampere never sees or stores your card details.
      </p>
    </div>
  );
}

/**
 * A selectable card — dealers, buy-or-ride, payment options. One look for every
 * "pick one of these" on the page, so selected always means the same thing.
 *
 * A toggle button rather than a radio input: the whole card is the target,
 * and it works with Tab and Space like everything else here.
 */
export function ChoiceCard({
  selected,
  disabled,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={[
        'relative w-full rounded-2xl border bg-white text-left transition-all duration-200',
        FOCUS,
        selected
          ? 'border-amp-accent bg-amp-accent-tint/50 ring-1 ring-amp-accent shadow-[0_10px_30px_-18px_rgba(47,110,212,0.55)]'
          : 'border-amp-line hover:border-amp-ink/35 hover:shadow-[0_6px_20px_-14px_rgba(16,21,28,0.35)]',
        disabled ? 'cursor-not-allowed opacity-50 hover:border-amp-line hover:shadow-none' : 'cursor-pointer active:scale-[0.995]',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/** The circle in a ChoiceCard's corner: empty, or filled with a tick. */
export function SelectionDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={[
        'flex size-5 shrink-0 items-center justify-center rounded-full border transition-all duration-200',
        selected
          ? 'border-amp-accent-fill bg-amp-accent-fill text-white'
          : 'border-amp-line bg-white text-transparent',
      ].join(' ')}
    >
      <CheckIcon className="size-3" />
    </span>
  );
}

const NOTICE_TONES = {
  info: 'border-amp-accent/25 bg-amp-accent-tint text-amp-ink',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-700',
} as const;

/** A short message in a tinted box. Errors are announced; the rest are not. */
export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: keyof typeof NOTICE_TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={`rounded-xl border px-4 py-3 text-[13px] leading-relaxed ${NOTICE_TONES[tone]} ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`animate-spin ${className ?? ''}`}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Keeps a block's height while it loads, so nothing jumps when it arrives. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-xl bg-amp-line/50 ${className ?? ''}`}
    />
  );
}
