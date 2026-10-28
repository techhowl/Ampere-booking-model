import type { SVGProps } from 'react';

/**
 * Brand marks and icons.
 *
 * The two logos are Ampere's and Greaves' own artwork, in public/brand/. Both
 * are white on transparent, drawn for the near-black header and footer.
 *
 * Icons are inline SVG on a 24x24 grid with a consistent 1.6 stroke. Inline
 * because a dozen small glyphs are not worth a dozen network requests on a
 * mobile page — and never emoji, which render differently on every device and
 * read as placeholder.
 */

export function AmpereLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 6KB static mark; next/image adds nothing
    <img
      src="/brand/ampere-logo.png"
      alt="Ampere"
      width={680}
      height={98}
      className={`h-4.5 w-auto lg:h-5 ${className ?? ''}`}
    />
  );
}

export function GreavesLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static mark, as above
    <img
      src="/brand/greaves-logo.png"
      alt="Greaves Electric Mobility"
      width={713}
      height={280}
      loading="lazy"
      className={`h-12 w-auto ${className ?? ''}`}
    />
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

export function ArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M5 12h14m0 0-6-6m6 6-6 6" {...s} strokeWidth={1.8} />
    </svg>
  );
}

/** Buy now. */
export function BagIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M5.5 8.5h13l-1 11a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4z" {...s} />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" {...s} />
    </svg>
  );
}

/** Test ride. */
export function CalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" {...s} />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" {...s} />
      <path d="m9.5 15 1.8 1.7 3.4-3.4" {...s} />
    </svg>
  );
}

/** A dealership. */
export function StoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M4.5 9.5 6 4.5h12l1.5 5" {...s} />
      <path d="M4.5 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" {...s} />
      <path d="M5.5 12v7.5h13V12M10 19.5v-4h4v4" {...s} />
    </svg>
  );
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="m4 11 8-6.5 8 6.5" {...s} />
      <path d="M6 9.5v10h12v-10M10 19.5v-5h4v5" {...s} />
    </svg>
  );
}

export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" {...s} strokeWidth={1.8} />
    </svg>
  );
}

/** A document — the brochure card. */
export function DocumentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path d="M7 3.5h7l4.5 4.5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15.5a1 1 0 0 1 1-1Z" {...s} />
      <path d="M13.5 3.5V8.5h5M9 13h6M9 16.5h4" {...s} />
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
