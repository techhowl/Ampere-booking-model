'use client';

import { useEffect, useState } from 'react';
import type { Model } from '@/lib/catalog/catalog';
import { ProductImage } from '@/components/ProductImage';
import { CloseIcon, ExpandIcon } from '@/components/Brand';

/**
 * The scooter, on a light card with a colour carousel — the Figma's left
 * column.
 *
 * Arrows step through the model's colours rather than through a gallery of
 * shots: there is one photograph per colour, so paging the carousel and
 * picking a swatch are the same action. That keeps the control honest instead
 * of implying images we do not have.
 */

interface Props {
  model: Model | null;
  colourCode: string | null;
  onColourChange?: (colourCode: string) => void;
}

export function ProductPanel({ model, colourCode, onColourChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (!model) {
    return (
      <div className="flex min-h-[260px] items-center justify-center rounded-2xl bg-white p-8 lg:min-h-[420px]">
        <p className="max-w-[28ch] text-center text-[15px] leading-relaxed text-amp-muted">
          Pick a scooter and it appears here.
        </p>
      </div>
    );
  }

  const index = Math.max(
    0,
    model.colours.findIndex((c) => c.code === colourCode),
  );

  const step = (delta: number) => {
    const next = model.colours[(index + delta + model.colours.length) % model.colours.length];
    if (next) onColourChange?.(next.code);
  };

  const multiple = model.colours.length > 1;

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl bg-white">
        <ProductImage
          model={model}
          colourCode={colourCode}
          priority
          className="mx-auto h-[240px] w-full object-contain p-6 lg:h-[420px] lg:p-10"
        />

        {multiple && (
          <>
            <CarouselButton side="left" onClick={() => step(-1)} />
            <CarouselButton side="right" onClick={() => step(1)} />
          </>
        )}

        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="View larger"
          className="absolute bottom-4 right-4 flex size-9 cursor-pointer items-center justify-center rounded-full bg-white/90 text-amp-ink shadow-sm backdrop-blur transition-all hover:bg-white hover:shadow-md"
        >
          <ExpandIcon className="size-4" />
        </button>
      </div>

      {expanded && (
        <div
          role="dialog"
          aria-modal
          aria-label={`${model.name}, larger view`}
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-amp-ink/90 p-6"
        >
          <ProductImage
            model={model}
            colourCode={colourCode}
            className="max-h-full w-full max-w-4xl object-contain"
          />
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Close"
            className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>
      )}
    </>
  );
}

function CarouselButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous colour' : 'Next colour'}
      className={[
        'absolute top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full',
        'cursor-pointer bg-white/90 text-amp-ink shadow-sm backdrop-blur transition-all hover:bg-white hover:shadow-md',
        side === 'left' ? 'left-3' : 'right-3',
      ].join(' ')}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path
          d={side === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
