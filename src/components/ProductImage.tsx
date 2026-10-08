'use client';

import { useEffect, useState } from 'react';
import type { Model } from '@/lib/catalog/catalog';

/**
 * The scooter.
 *
 * ASSET SLOT. Drop photography into `public/models/` and this starts using it
 * with no code change:
 *
 *   public/models/nexus-ex-plus-carbon-knight.webp  per colour, preferred
 *   public/models/nexus-ex-plus.webp                one image for the model
 *
 * WebP with a transparent background — the panel behind is near-black, so an
 * opaque background shows as a box. Until a file exists, a placeholder in the
 * selected colour stands in, deliberately obviously a placeholder.
 */

interface Props {
  model: Model;
  colourCode: string | null;
  className?: string;
  priority?: boolean;
}

type LoadState = 'colour' | 'model' | 'placeholder';

export function ProductImage({ model, colourCode, className, priority }: Props) {
  const [state, setState] = useState<LoadState>('colour');

  // Photography is shot per colour, so there is always a colour to show even
  // before the customer picks one — the model's first. Falling back to a
  // colourless `<model>.webp` would 404, because no such file is shot.
  const colour = model.colours.find((c) => c.code === colourCode) ?? model.colours[0];

  useEffect(() => {
    setState('colour');
  }, [colourCode, model.code]);

  if (state === 'placeholder' || !colour) {
    return <ProductPlaceholder model={model} hex={colour?.hex ?? '#394150'} className={className} />;
  }

  const src =
    state === 'colour'
      ? `/models/${model.image}-${colour.code}.webp`
      : `/models/${model.image}.webp`;

  return (
    // Plain <img>: next/image wants the file to exist at build time, and these
    // do not yet. Swap to next/image once the photography is committed.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`Ampere ${model.name}${colour ? ` in ${colour.name}` : ''}`}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      onError={() => setState((current) => (current === 'colour' ? 'model' : 'placeholder'))}
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
