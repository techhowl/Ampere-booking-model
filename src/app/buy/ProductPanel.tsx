'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FAMILIES, type Model } from '@/lib/catalog/catalog';
import type { NearbyDealer } from '@/lib/schemas/dealer';
import { ProductImage } from '@/components/ProductImage';
import { CloseIcon, ExpandIcon } from '@/components/Brand';

/**
 * The scooter, large, beside every step — the left column.
 *
 * Arrows step through the model's colours rather than through a gallery of
 * shots: there is one photograph per colour, so paging the carousel and
 * picking a swatch are the same action. That keeps the control honest instead
 * of implying images we do not have.
 *
 * Fixed height at each breakpoint, so the panel does not jump as the form
 * beside it changes length from step to step.
 */

interface Props {
  model: Model;
  colourCode: string | null;
  /** Nothing chosen yet: show the range's lead scooter, but claim no choice. */
  preview: boolean;
  onColourChange?: (colourCode: string) => void;
}

export function ProductPanel({ model, colourCode, preview, onColourChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  const index = Math.max(
    0,
    model.colours.findIndex((c) => c.code === colourCode),
  );
  const colour = model.colours[index];
  const family = FAMILIES.find((f) => f.code === model.family)?.name;

  const step = (delta: number) => {
    const next = model.colours[(index + delta + model.colours.length) % model.colours.length];
    if (next) onColourChange?.(next.code);
  };

  const canPage = !preview && !!onColourChange && model.colours.length > 1;

  return (
    <>
      <div className="relative h-64 overflow-hidden rounded-3xl bg-white ring-1 ring-black/5 sm:h-80 lg:h-[min(560px,calc(100dvh-14rem))] lg:min-h-105">
        {/* A soft floor under the scooter, so it sits rather than floats. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-[radial-gradient(60%_55%_at_50%_85%,var(--color-amp-accent-tint),transparent)]"
        />

        <div className="absolute left-5 top-4 z-10 sm:left-7 sm:top-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amp-muted">
            {preview ? 'Ampere electric scooters' : (family ?? 'Ampere')}
          </p>
          {!preview && (
            <p className="mt-0.5 text-[20px] font-bold leading-tight tracking-tight text-amp-ink sm:text-[28px]">
              {model.name}
            </p>
          )}
        </div>

        <div key={`${model.code}-${colour?.code}`} className="amp-fade absolute inset-0">
          <ProductImage
            model={model}
            colourCode={colourCode}
            priority
            className="h-full w-full object-contain px-5 pb-8 pt-16 sm:px-16 sm:pb-10 sm:pt-20 lg:px-14 lg:pb-16 lg:pt-24"
          />
        </div>

        {!preview && colour && (
          <p className="absolute bottom-4 left-5 z-10 inline-flex items-center gap-2 rounded-full bg-white/90 py-1.5 pl-1.5 pr-3 text-[12px] font-semibold text-amp-ink shadow-sm ring-1 ring-black/5 backdrop-blur sm:bottom-6 sm:left-7">
            <span
              aria-hidden
              className="size-4 rounded-full border border-black/10"
              style={{ backgroundColor: colour.hex }}
            />
            {colour.name}
          </p>
        )}

        {canPage && (
          <>
            <CarouselButton side="left" onClick={() => step(-1)} />
            <CarouselButton side="right" onClick={() => step(1)} />
          </>
        )}

        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="View larger"
          className="absolute bottom-4 right-4 z-10 flex size-9 cursor-pointer items-center justify-center rounded-full bg-white/90 text-amp-ink shadow-sm ring-1 ring-black/5 backdrop-blur transition-all hover:bg-white hover:shadow-md sm:bottom-6 sm:right-6"
        >
          <ExpandIcon className="size-4" />
        </button>
      </div>

      {expanded && (
        <Lightbox
          model={model}
          colourCode={colour?.code ?? null}
          family={preview ? null : (family ?? null)}
          onColourChange={canPage ? onColourChange : undefined}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

/**
 * The larger view.
 *
 * Portalled to <body>. Rendered in place it sat inside the sticky column, and
 * a sticky element is its own stacking context — so the form beside it and the
 * header painted over a "full-screen" overlay. At the top of the document
 * nothing can.
 *
 * A white card rather than a dark backdrop: the photography is shot for a
 * light background, and a Carbon Knight scooter on near-black disappears.
 */
function Lightbox({
  model,
  colourCode,
  family,
  onColourChange,
  onClose,
}: {
  model: Model;
  colourCode: string | null;
  family: string | null;
  onColourChange?: (colourCode: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const colours = model.colours;
  const index = Math.max(0, colours.findIndex((c) => c.code === colourCode));
  const colour = colours[index];

  const step = (delta: number) => {
    const next = colours[(index + delta + colours.length) % colours.length];
    if (next) onColourChange?.(next.code);
  };
  // The latest step(), for the key handler registered once below.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') stepRef.current(-1);
      else if (e.key === 'ArrowRight') stepRef.current(1);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-100 flex items-center justify-center p-3 sm:p-8"
    >
      <div
        aria-hidden
        onClick={onClose}
        className="amp-fade absolute inset-0 bg-amp-ink/70 backdrop-blur-sm"
      />

      <div className="amp-rise relative flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-[0_40px_80px_-30px_rgba(4,9,16,0.6)]">
        <header className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-8 sm:pt-7">
          <div>
            {family && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amp-muted">
                {family}
              </p>
            )}
            <h2
              id={titleId}
              className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-amp-ink sm:text-[30px]"
            >
              {model.name}
            </h2>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close larger view"
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-amp-page text-amp-ink transition-colors hover:bg-amp-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amp-accent"
          >
            <CloseIcon className="size-5" />
          </button>
        </header>

        <div className="relative h-[min(58vh,560px)] min-h-56 shrink">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-[radial-gradient(60%_55%_at_50%_85%,var(--color-amp-accent-tint),transparent)]"
          />
          <div key={colour?.code} className="amp-fade absolute inset-0">
            <ProductImage
              model={model}
              colourCode={colour?.code ?? null}
              className="h-full w-full object-contain px-6 py-4 sm:px-16 sm:py-8"
            />
          </div>
          {onColourChange && colours.length > 1 && (
            <>
              <CarouselButton side="left" onClick={() => step(-1)} />
              <CarouselButton side="right" onClick={() => step(1)} />
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2 border-t border-amp-line/70 px-4 py-4">
          {onColourChange ? (
            colours.map((c) => {
              const selected = c.code === colour?.code;
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => onColourChange(c.code)}
                  aria-pressed={selected}
                  className={[
                    'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full px-3 text-[13px] transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-amp-accent',
                    selected ? 'bg-amp-page font-semibold text-amp-ink' : 'text-amp-muted hover:text-amp-ink',
                  ].join(' ')}
                >
                  <span
                    aria-hidden
                    className={[
                      'size-4 rounded-full border border-black/10',
                      selected ? 'ring-2 ring-amp-ink ring-offset-2' : '',
                    ].join(' ')}
                    style={{ backgroundColor: c.hex }}
                  />
                  {c.name}
                </button>
              );
            })
          ) : (
            <p className="text-[13px] font-semibold text-amp-ink">{colour?.name}</p>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/**
 * What they have chosen so far, under the picture. Fills in as they go, so
 * the left column answers "what am I buying, for how much, from whom" at a
 * glance on every step.
 */
export function SelectionSummary({
  model,
  colourName,
  price,
  dealer,
  className,
}: {
  model: Model | null;
  colourName: string | null;
  price: string | null;
  dealer: NearbyDealer | null;
  className?: string;
}) {
  const items = [
    {
      label: 'Scooter',
      value: model ? `${model.name}${colourName ? ` · ${colourName}` : ''}` : null,
      empty: 'Choose in step 2',
    },
    { label: 'Ex-showroom', value: price, empty: 'After your pincode' },
    { label: 'Dealer', value: dealer?.name ?? null, empty: 'Choose in step 3' },
  ];

  return (
    <dl
      className={`grid-cols-3 divide-x divide-amp-line/70 rounded-2xl bg-white ring-1 ring-black/5 ${className ?? ''}`}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0 px-5 py-4">
          <dt className="text-[11px] font-semibold uppercase tracking-widest text-amp-muted">
            {item.label}
          </dt>
          <dd
            title={item.value ?? undefined}
            className={[
              'mt-1 truncate text-[14px]',
              item.value ? 'font-semibold text-amp-ink' : 'text-amp-muted/80',
            ].join(' ')}
          >
            {item.value ?? item.empty}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CarouselButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous colour' : 'Next colour'}
      className={[
        'absolute top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full',
        'cursor-pointer bg-white/90 text-amp-ink shadow-sm ring-1 ring-black/5 backdrop-blur transition-all hover:bg-white hover:shadow-md',
        side === 'left' ? 'left-3 sm:left-5' : 'right-3 sm:right-5',
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
