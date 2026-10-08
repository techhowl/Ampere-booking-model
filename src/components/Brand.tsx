import type { SVGProps } from 'react';

/**
 * Brand marks and icons.
 *
 * ASSET SLOT: `AmpereLogo` draws a stand-in wordmark. Replace its body with
 * Ampere's real mark and every header and footer picks it up.
 *
 * Icons are inline SVG on a 24x24 grid with a consistent 1.6 stroke. Inline
 * because a dozen small glyphs are not worth a dozen network requests on a
 * mobile page — and never emoji, which render differently on every device and
 * read as placeholder.
 */

export function AmpereLogo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-2 ${className ?? ''}`}>
      <BoltMark className="size-[1.15em] translate-y-[0.1em]" />
      <span className="text-[15px] font-bold uppercase tracking-[0.18em]">Ampere</span>
    </span>
  );
}

export function BoltMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M13.5 2 4 14h6l-1.5 8L20 10h-6.5z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */

const s = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function RangeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <circle cx="12" cy="10" r="2.6" {...s} />
      <path d="M12 21s6.5-5.9 6.5-10.6a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21Z" {...s} />
    </svg>
  );
}

export function SpeedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M4.5 17.5a8 8 0 1 1 15 0" {...s} />
      <path d="M12 17.5 16 12" {...s} />
      <circle cx="12" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChargeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M13 3 6.5 13H11l-1 8 7-10.5h-4.5z" {...s} />
    </svg>
  );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="m5 13 4.2 4.2L19 7.4" {...s} strokeWidth={2.2} />
    </svg>
  );
}

/** The offers strip. Replaces the emoji that was standing in for it. */
export function TagIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1a1 1 0 0 1 .7.3l7 7a1 1 0 0 1 0 1.4l-8.1 8.1a1 1 0 0 1-1.4 0l-7-7a1 1 0 0 1-.3-.7Z" {...s} />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Trust mark beside the pay button. */
export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" {...s} />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" {...s} />
    </svg>
  );
}

export function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M12 3 5 5.8v5.4c0 4.3 2.9 8.2 7 9.3 4.1-1.1 7-5 7-9.3V5.8Z" {...s} />
      <path d="m9.2 12 2 2 3.6-3.8" {...s} />
    </svg>
  );
}

export function ChevronIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="m7 10 5 5 5-5" {...s} strokeWidth={2} />
    </svg>
  );
}

export function ArrowLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" {...s} strokeWidth={1.8} />
    </svg>
  );
}

export function PhoneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M6.3 3.5h3l1.5 3.8-1.9 1.1a11 11 0 0 0 5.7 5.7l1.1-1.9 3.8 1.5v3a1.8 1.8 0 0 1-2 1.8A15.8 15.8 0 0 1 4.5 5.5a1.8 1.8 0 0 1 1.8-2Z" {...s} />
    </svg>
  );
}

export function PinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <circle cx="12" cy="10.5" r="2.4" {...s} />
      <path d="M12 21s6.3-5.7 6.3-10.5a6.3 6.3 0 1 0-12.6 0C5.7 15.3 12 21 12 21Z" {...s} />
    </svg>
  );
}

export function ExpandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M4 9V4.8A.8.8 0 0 1 4.8 4H9M20 9V4.8a.8.8 0 0 0-.8-.8H15M4 15v4.2c0 .4.4.8.8.8H9M20 15v4.2a.8.8 0 0 1-.8.8H15" {...s} />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M6 6l12 12M18 6 6 18" {...s} strokeWidth={1.8} />
    </svg>
  );
}
