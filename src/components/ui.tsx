'use client';

import type { ReactNode } from 'react';
import { LockIcon } from './Brand';

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
const FOCUS =
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

/** The black primary action. Square-ish, not a pill — the design is specific. */
export function PrimaryButton({
  disabled,
  onClick,
  type = 'button',
  children,
  className,
}: {
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        'min-h-13 rounded-xl bg-amp-cta px-6 text-[15px] font-semibold tracking-wide text-white',
        'shadow-[0_1px_2px_rgba(16,21,28,0.16),0_8px_24px_-12px_rgba(16,21,28,0.5)]',
        'transition-all duration-200 hover:bg-amp-cta-hover hover:shadow-[0_2px_4px_rgba(16,21,28,0.2),0_12px_28px_-10px_rgba(16,21,28,0.55)]',
        FOCUS,
        disabled
          ? 'cursor-not-allowed bg-amp-disabled text-white/70 shadow-none hover:bg-amp-disabled hover:shadow-none'
          : 'cursor-pointer active:scale-[0.99]',
        className ?? '',
      ].join(' ')}
    >
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
        'min-h-13 cursor-pointer rounded-xl border border-amp-line bg-white px-6 text-[15px]',
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
        <label htmlFor={htmlFor} className="amp-label cursor-pointer">
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

/** Keeps a block's height while it loads, so nothing jumps when it arrives. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-xl bg-amp-line/50 ${className ?? ''}`}
    />
  );
}
