'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MODELS, angleCount, swatchBackground, type Colour, type Model } from '@/lib/catalog/catalog';
import type { NearbyDealer } from '@/lib/schemas/dealer';
import { ProductImage } from '@/components/ProductImage';
import { CloseIcon, ExpandIcon } from '@/components/Brand';

/**
 * The scooter, large, beside every step — the left column.
 *
 * With a scooter chosen, it shows that scooter in the chosen colour, and the
 * arrows walk around it: front, side, rear and back again, the photographs the
 * main site shows. Colour is changed with the swatches, never the arrows.
 *
 * With nothing chosen — a customer who came from the navbar or an ad rather
 * than a product page — it is a carousel of the whole range instead.
 *
 * Fixed height at each breakpoint, so the panel does not jump as the form
 * beside it changes length from step to step.
 */

interface Props {
  /** The chosen scooter, or null for none yet. */
  model: Model | null;
  colourCode: string | null;
  onColourChange?: (colourCode: string) => void;
}

export function ProductPanel({ model, colourCode, onColourChange }: Props) {
  if (!model) return <RangeCarousel />;
  return <Showcase model={model} colourCode={colourCode} onColourChange={onColourChange} />;
}

const FRAME =
  'relative h-64 overflow-hidden rounded-3xl bg-white ring-1 ring-black/5 sm:h-80 lg:h-[min(560px,calc(100dvh-14rem))] lg:min-h-105';
const PHOTO =
  'h-full w-full object-contain px-5 pb-10 pt-16 sm:px-16 sm:pb-12 sm:pt-20 lg:px-14 lg:pb-16 lg:pt-24';

/* ------------------------------------------------------------------ */

function Showcase({
  model,
  colourCode,
  onColourChange,
}: {
  model: Model;
  colourCode: string | null;
  onColourChange?: (colourCode: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [angle, setAngle] = useState(0);

  const colour = model.colours.find((c) => c.code === colourCode) ?? model.colours[0];
  const count = angleCount(model, colour?.code);

  // A different scooter or colour starts from the front again.
  useEffect(() => {
    setAngle(0);
  }, [model.code, colour?.code]);

  const turn = (delta: number) => setAngle((a) => (a + delta + count) % count);

  return (
    <>
      <div className={FRAME}>
        <Floor />
        <Title>{model.name}</Title>

        <div key={`${model.code}-${colour?.code}-${angle}`} className="amp-fade absolute inset-0">
          <ProductImage
            model={model}
            colourCode={colour?.code ?? null}
            angle={angle}
            priority
            className={PHOTO}
          />
        </div>

        {count > 1 && (
          <>
            <ArrowButton side="left" label="Previous angle" onClick={() => turn(-1)} />
            <ArrowButton side="right" label="Next angle" onClick={() => turn(1)} />
          </>
        )}

        <BottomBar
          left={colour && <ColourChip colour={colour} />}
          middle={count > 1 && <Dots count={count} active={angle} label="Angle" onPick={setAngle} />}
          onExpand={() => setExpanded(true)}
        />
      </div>

      {expanded && (
        <Lightbox
          model={model}
          colourCode={colour?.code ?? null}
          angle={angle}
          onAngle={setAngle}
          onColourChange={onColourChange}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The whole range, one scooter at a time. Intellipack versions are shown in
 * their second colour, so two scooters photographed alike never sit side by
 * side looking identical.
 */
const SLIDES: { model: Model; colour: Colour }[] = [...MODELS]
  .sort((a, b) => a.sort - b.sort)
  .map((model) => ({
    model,
    colour:
      (model.variant.label === 'Intellipack' ? model.colours[1] : undefined) ?? model.colours[0]!,
  }));

const SLIDE_MS = 4000;

function RangeCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const slide = SLIDES[index]!;

  // Turns by itself, unless the customer is looking at it or has asked for
  // less motion.
  useEffect(() => {
    if (paused || expanded) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [index, paused, expanded]);

  const go = (delta: number) => setIndex((i) => (i + delta + SLIDES.length) % SLIDES.length);

  return (
    <>
      <div
        className={FRAME}
        role="group"
        aria-roledescription="carousel"
        aria-label="Ampere scooters"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <Floor />
        <Title>{slide.model.name}</Title>

        <div key={index} className="amp-fade absolute inset-0">
          <ProductImage
            model={slide.model}
            colourCode={slide.colour.code}
            priority={index === 0}
            className={PHOTO}
          />
        </div>

        <ArrowButton side="left" label="Previous scooter" onClick={() => go(-1)} />
        <ArrowButton side="right" label="Next scooter" onClick={() => go(1)} />
        <BottomBar
          middle={
            <Dots
              count={SLIDES.length}
              active={index}
              label="Scooter"
              names={SLIDES.map((s) => s.model.name)}
              onPick={setIndex}
            />
          }
          onExpand={() => setExpanded(true)}
        />
      </div>

      {expanded && (
        <Lightbox
          model={slide.model}
          colourCode={slide.colour.code}
          angle={0}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

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
  angle: startAngle,
  onAngle,
  onColourChange,
  onClose,
}: {
  model: Model;
  colourCode: string | null;
  angle: number;
  onAngle?: (angle: number) => void;
  onColourChange?: (colourCode: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const colours = model.colours;
  const colour = colours.find((c) => c.code === colourCode) ?? colours[0];
  const count = angleCount(model, colour?.code);
  const [angle, setAngle] = useState(startAngle);

  // Turning here turns the panel too, so closing lands on the same view.
  const show = (next: number) => {
    setAngle(next);
    onAngle?.(next);
  };
  const turn = (delta: number) => show((angle + delta + count) % count);

  // A new colour starts from the front; opening keeps the panel's angle.
  const shownColour = useRef(colour?.code);
  useEffect(() => {
    if (shownColour.current === colour?.code) return;
    shownColour.current = colour?.code;
    setAngle(0);
  }, [colour?.code]);

  // The latest turn(), for the key handler registered once below.
  const turnRef = useRef(turn);
  useEffect(() => {
    turnRef.current = turn;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') turnRef.current(-1);
      else if (e.key === 'ArrowRight') turnRef.current(1);
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
          <h2
            id={titleId}
            className="text-[22px] font-bold leading-tight tracking-tight text-amp-ink sm:text-[30px]"
          >
            {model.name}
          </h2>
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
          <Floor />
          <div key={`${colour?.code}-${angle}`} className="amp-fade absolute inset-0">
            <ProductImage
              model={model}
              colourCode={colour?.code ?? null}
              angle={angle}
              className="h-full w-full object-contain px-6 pb-10 pt-4 sm:px-16 sm:pb-12 sm:pt-8"
            />
          </div>
          {count > 1 && (
            <>
              <ArrowButton side="left" label="Previous angle" onClick={() => turn(-1)} />
              <ArrowButton side="right" label="Next angle" onClick={() => turn(1)} />
              <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center sm:bottom-5">
                <Dots count={count} active={angle} label="Angle" onPick={show} />
              </div>
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
                    style={{ background: swatchBackground(c) }}
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

/* ------------------------------------------------------------------ */

/** A soft floor under the scooter, so it sits rather than floats. */
function Floor() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-[radial-gradient(60%_55%_at_50%_85%,var(--color-amp-accent-tint),transparent)]"
    />
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <p className="absolute left-5 top-4 z-10 text-[20px] font-bold leading-tight tracking-tight text-amp-ink sm:left-7 sm:top-6 sm:text-[28px]">
      {children}
    </p>
  );
}

function ColourChip({ colour }: { colour: Colour }) {
  return (
    <p className="inline-flex min-w-0 items-center gap-2 rounded-full bg-white/90 py-1.5 pl-1.5 pr-3 text-[12px] font-semibold text-amp-ink shadow-sm ring-1 ring-black/5 backdrop-blur">
      <span
        aria-hidden
        className="size-4 rounded-full border border-black/10"
        style={{ background: swatchBackground(colour) }}
      />
      <span className="truncate">{colour.name}</span>
    </p>
  );
}

/**
 * The row along the bottom of the panel: the colour on the left, where you
 * are in the middle, the larger-view button on the right. One row, so the
 * three can never sit on top of each other on a narrow phone; the colour
 * keeps its full name and the dots take the space that is left.
 */
function BottomBar({
  left,
  middle,
  onExpand,
}: {
  left?: React.ReactNode;
  middle?: React.ReactNode;
  onExpand: () => void;
}) {
  return (
    <div className="absolute inset-x-4 bottom-4 z-10 flex items-center gap-3 sm:inset-x-6 sm:bottom-6">
      {/* With no colour to show, an empty slot the size of the button keeps
          the dots centred. */}
      <div className="flex shrink-0">{left ?? <span aria-hidden className="size-9" />}</div>
      <div className="flex min-w-0 flex-1 justify-center">{middle}</div>
      <div className="flex shrink-0">
        <ExpandButton onClick={onExpand} />
      </div>
    </div>
  );
}

function ExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="View larger"
      className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-white/90 text-amp-ink shadow-sm ring-1 ring-black/5 backdrop-blur transition-all hover:bg-white hover:shadow-md"
    >
      <ExpandIcon className="size-4" />
    </button>
  );
}

/**
 * Where you are in the run of angles or scooters. Small, centred under the
 * scooter; each dot is also a button, but the arrows remain the main control.
 */
function Dots({
  count,
  active,
  label,
  names,
  onPick,
}: {
  count: number;
  active: number;
  label: string;
  names?: string[];
  onPick: (index: number) => void;
}) {
  return (
    <div className="flex justify-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(i)}
          aria-label={names?.[i] ?? `${label} ${i + 1} of ${count}`}
          aria-current={i === active ? 'true' : undefined}
          className="group flex h-4 cursor-pointer items-center outline-none"
        >
          <span
            aria-hidden
            className={[
              'block h-1.5 rounded-full transition-all duration-300 group-focus-visible:ring-2 group-focus-visible:ring-amp-accent/50',
              i === active ? 'w-5 bg-amp-ink' : 'w-1.5 bg-amp-ink/20 group-hover:bg-amp-ink/40',
            ].join(' ')}
          />
        </button>
      ))}
    </div>
  );
}

/**
 * What they have chosen so far, under the picture. Fills in as they go, so
 * the left column answers "what am I choosing, for how much, from whom" at a
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

function ArrowButton({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right';
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
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
