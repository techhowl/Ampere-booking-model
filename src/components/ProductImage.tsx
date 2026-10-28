'use client';

import { useEffect, useRef, useState } from 'react';
import { angleCount, photoSrc, type Model } from '@/lib/catalog/catalog';

/**
 * The scooter, in one colour, from one angle.
 *
 * Photography lives in `public/models/<image>/<colour>-<n>.webp`, one file per
 * angle, in the order the main site shows them — see photoSrc() and the
 * `angles` counts in the catalog. WebP with a transparent background.
 *
 * A missing angle falls back to the colour's first angle; a missing colour
 * falls back to a placeholder in that colour, deliberately obviously one.
 */

interface Props {
  model: Model;
  colourCode: string | null;
  /** Which photograph of the colour, from 0. Out-of-range values wrap. */
  angle?: number;
  className?: string;
  priority?: boolean;
}

type LoadState = 'angle' | 'first' | 'placeholder';

export function ProductImage({ model, colourCode, angle = 0, className, priority }: Props) {
  const [state, setState] = useState<LoadState>('angle');

  // There is always a colour to show, even before the customer picks one —
  // the model's first.
  const colour = model.colours.find((c) => c.code === colourCode) ?? model.colours[0];
  const count = angleCount(model, colour?.code);
  const index = ((angle % count) + count) % count;

  const img = useRef<HTMLImageElement>(null);
  const fail = () =>
    setState((current) => (current === 'angle' && index > 0 ? 'first' : 'placeholder'));

  useEffect(() => {
    setState('angle');
  }, [colour?.code, model.code, index]);

  // A server-rendered image can 404 before React hydrates and starts
  // listening, and then onError never fires. Check for that on mount.
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth === 0) fail();
  });

  if (state === 'placeholder' || !colour) {
    return <ProductPlaceholder model={model} hex={colour?.hex ?? '#394150'} className={className} />;
  }

  return (
    // Plain <img>: the photographs are already sized for the panel, and
    // next/image would add a round trip through the optimiser for nothing.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={img}
      src={photoSrc(model, colour.code, state === 'first' ? 0 : index)}
      alt={`Ampere ${model.name} in ${colour.name}`}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={fail}
    />
  );
}

/**
 * Stands in for the photography. A silhouette rather than a grey box, so the
 * layout reads correctly at every breakpoint while the real images are awaited.
 */
function ProductPlaceholder({
  model,
  hex,
  className,
}: {
  model: Model;
  hex: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center ${className ?? ''}`}
      role="img"
      aria-label={`${model.name} — product photography to come`}
    >
      <svg viewBox="0 0 320 180" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id={`g-${model.code}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={hex} stopOpacity="0.95" />
            <stop offset="100%" stopColor={hex} stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {/* A scooter, suggested rather than drawn. */}
        <path
          d="M74 128 C78 96 96 84 120 84 L186 84 C204 84 214 76 218 62 L236 62 C242 62 246 66 246 72 L246 84 C246 100 236 110 220 112 L150 120 C130 122 118 128 112 128 Z"
          fill={`url(#g-${model.code})`}
        />
        <circle cx="94" cy="132" r="22" fill="none" stroke={hex} strokeWidth="7" opacity="0.9" />
        <circle cx="236" cy="132" r="22" fill="none" stroke={hex} strokeWidth="7" opacity="0.9" />
        <rect x="208" y="48" width="44" height="7" rx="3.5" fill={hex} opacity="0.75" />

        <text
          x="160"
          y="170"
          textAnchor="middle"
          fontSize="11"
          letterSpacing="1.5"
          fill="currentColor"
          opacity="0.45"
        >
          PRODUCT IMAGE TO COME
        </text>
      </svg>
    </div>
  );
}
