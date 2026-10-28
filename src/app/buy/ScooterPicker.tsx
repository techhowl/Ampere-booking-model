'use client';

import type { ReactNode } from 'react';
import {
  ACTIVE_FAMILIES,
  getModel,
  modelsInFamily,
  swatchBackground,
  type Model,
} from '@/lib/catalog/catalog';
import type { ModelAvailability } from '@/lib/catalog/availability';
import { FOCUS, Notice, PrimaryButton, SelectionDot, Skeleton } from '@/components/ui';
import { ProductImage } from '@/components/ProductImage';
import { ChargeIcon, RangeIcon, SpeedIcon, TagIcon } from '@/components/Brand';
import { StepActions, StepHeader } from './StepFrame';

/**
 * Step two: family tabs, then the scooters. The chosen card opens to show its
 * choices right under its specs, so they are made where the scooter is — not
 * at the bottom of a list the customer has to scroll past.
 *
 * Two layouts for the scooters sold in two versions (Nexus EX+ and Magnus
 * GMax, each with an Intellipack):
 *
 *   list      every version its own card, one below the other   (/buy)
 *   variants  one card per scooter; the chosen card shows Standard and
 *             Intellipack as tiles above the colours, like the variant
 *             picker on a shopping site                         (/buy?view=variants)
 *
 * Either way the customer ends up choosing one model code and one colour, so
 * everything after this step is the same.
 *
 * Prices come from the server; nothing here computes money.
 */

interface Props {
  /** Null while the catalog loads. */
  models: ModelAvailability[] | null;
  loadFailed: boolean;
  onRetry: () => void;
  layout: 'list' | 'variants';
  /** Stock notes only mean something when the customer can buy. */
  showStock: boolean;
  selectedModelCode: string | null;
  selectedColourCode: string | null;
  onSelectModel: (model: ModelAvailability) => void;
  onSelectColour: (colourCode: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function ScooterPicker({
  models,
  loadFailed,
  onRetry,
  layout,
  showStock,
  selectedModelCode,
  selectedColourCode,
  onSelectModel,
  onSelectColour,
  onBack,
  onContinue,
}: Props) {
  const header = (
    <StepHeader title="Choose Your Ampere" text="Select your preferred scooter and colour." />
  );

  if (!models) {
    return (
      <div className="flex flex-col gap-7">
        {header}
        {loadFailed ? (
          <Notice tone="error">
            We couldn&apos;t load the scooters.{' '}
            <button type="button" onClick={onRetry} className="cursor-pointer font-semibold underline underline-offset-4">
              Try again
            </button>
          </Notice>
        ) : (
          <div className="flex flex-col gap-3" aria-busy aria-label="Loading scooters">
            <Skeleton className="h-11 w-64 rounded-full" />
            <Skeleton className="h-36 w-full rounded-2xl" />
            <Skeleton className="h-36 w-full rounded-2xl" />
          </div>
        )}
        <StepActions onBack={onBack}>
          <PrimaryButton disabled>Continue to Dealers</PrimaryButton>
        </StepActions>
      </div>
    );
  }

  const byCode = new Map(models.map((m) => [m.code, m]));
  const available = (list: Model[]) =>
    list.map((m) => byCode.get(m.code)).filter((m): m is ModelAvailability => m !== undefined);

  const selected = byCode.get(selectedModelCode ?? '') ?? null;
  const activeFamily = getModel(selectedModelCode)?.family ?? ACTIVE_FAMILIES[0]?.code ?? 'nexus';
  const inFamily = available(modelsInFamily(activeFamily));

  // The variants layout shows one card per scooter: its versions grouped.
  const groupOf = (m: ModelAvailability) => getModel(m.code)?.variant.group ?? m.code;
  const groups = [...new Set(inFamily.map(groupOf))].map((group) =>
    inFamily.filter((m) => groupOf(m) === group),
  );

  const colourPicker = selected && (
    <ColourPicker
      modelName={selected.name}
      colours={selected.colours}
      selectedCode={selectedColourCode}
      onSelect={onSelectColour}
    />
  );

  return (
    <div className="flex flex-col gap-7">
      {header}

      <div className="flex flex-col gap-4">
        <div
          role="group"
          aria-label="Scooter family"
          className="flex w-full gap-1 rounded-full bg-amp-page p-1 sm:w-auto sm:self-start"
        >
          {ACTIVE_FAMILIES.map((family) => {
            const isActive = family.code === activeFamily;
            return (
              <button
                key={family.code}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  const first = available(modelsInFamily(family.code))[0];
                  if (first) onSelectModel(first);
                }}
                className={[
                  'min-h-10 flex-1 cursor-pointer rounded-full px-5 text-[13px] font-semibold uppercase tracking-[0.08em] transition-all duration-200 sm:flex-none',
                  FOCUS,
                  isActive
                    ? 'bg-white text-amp-ink shadow-[0_1px_3px_rgba(16,21,28,0.12)]'
                    : 'text-amp-muted hover:text-amp-ink',
                ].join(' ')}
              >
                {family.name}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3">
          {layout === 'list'
            ? inFamily.map((model) => {
                const isSelected = model.code === selectedModelCode;
                return (
                  <ScooterCard
                    key={model.code}
                    title={model.name}
                    price={model.price ? `${model.price.exShowroom.display}*` : 'Price on enquiry'}
                    shown={model}
                    colourCode={isSelected ? selectedColourCode : null}
                    selected={isSelected}
                    showStock={showStock}
                    onSelect={() => onSelectModel(model)}
                  >
                    {colourPicker}
                  </ScooterCard>
                );
              })
            : groups.map((versions) => {
                const standard = versions[0]!;
                const chosen = versions.find((v) => v.code === selectedModelCode) ?? null;
                return (
                  <ScooterCard
                    key={standard.code}
                    title={getModel(standard.code)?.variant.groupName ?? standard.name}
                    price={groupPrice(versions, chosen)}
                    shown={chosen ?? standard}
                    colourCode={chosen ? selectedColourCode : null}
                    selected={!!chosen}
                    showStock={showStock}
                    onSelect={() => {
                      if (!chosen) onSelectModel(standard);
                    }}
                  >
                    {versions.length > 1 && chosen && (
                      <VariantPicker versions={versions} chosen={chosen} onSelect={onSelectModel} />
                    )}
                    {colourPicker}
                  </ScooterCard>
                );
              })}
        </div>
      </div>

      <p className="-mt-3 text-[12px] text-amp-muted">*Ex-showroom price for your pincode.</p>

      <StepActions onBack={onBack}>
        <PrimaryButton onClick={onContinue} disabled={!selected || !selectedColourCode}>
          Continue to Dealers
        </PrimaryButton>
      </StepActions>
    </div>
  );
}

/**
 * A scooter sold in two versions shows the chosen version's price, or — before
 * one is chosen — "From" the lowest. Both figures are the server's.
 */
function groupPrice(versions: ModelAvailability[], chosen: ModelAvailability | null): string {
  if (chosen) return chosen.price ? `${chosen.price.exShowroom.display}*` : 'Price on enquiry';
  const priced = versions.filter((v) => v.price);
  if (priced.length === 0) return 'Price on enquiry';
  const lowest = priced.reduce((a, b) =>
    b.price!.exShowroom.amount < a.price!.exShowroom.amount ? b : a,
  );
  return `${versions.length > 1 ? 'From ' : ''}${lowest.price!.exShowroom.display}*`;
}

/* ------------------------------------------------------------------ */

function ScooterCard({
  title,
  price,
  shown,
  colourCode,
  selected,
  showStock,
  onSelect,
  children,
}: {
  title: string;
  price: string;
  /** The version whose photo, specs and offer the card shows. */
  shown: ModelAvailability;
  colourCode: string | null;
  selected: boolean;
  showStock: boolean;
  onSelect: () => void;
  /** What opens under the specs once this card is chosen. */
  children?: ReactNode;
}) {
  const definition = getModel(shown.code);
  const specs = definition?.specs;

  // The offers strip, and a stock note when there is one. Inside the card's
  // button until it is chosen; after the choices once it is, so they always
  // sit at the foot of the card.
  const footer = (
    <>
      {definition && (
        <p className="flex items-start gap-2 bg-amp-offer px-4 py-2.5 text-[12px] leading-relaxed text-amp-offer-ink">
          <TagIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{definition.offer}</span>
        </p>
      )}

      {showStock && !shown.inStock && shown.price && (
        <p className="bg-amber-50 px-4 py-2 text-[12px] text-amber-900">
          In short supply in your area — your dealer will confirm the timeline.
        </p>
      )}
    </>
  );

  return (
    // A div holding a button, not one big button: the chosen card opens to
    // show its own buttons, and a button cannot sit inside another.
    <div
      className={[
        'overflow-hidden rounded-2xl border bg-white transition-all duration-200',
        selected
          ? 'border-amp-accent ring-1 ring-amp-accent shadow-[0_10px_30px_-18px_rgba(47,110,212,0.55)]'
          : 'border-amp-line hover:border-amp-ink/35 hover:shadow-[0_6px_20px_-14px_rgba(16,21,28,0.35)]',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={[
          'block w-full cursor-pointer text-left outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amp-accent/60',
          selected ? 'bg-amp-accent-tint/50' : 'active:bg-amp-page/40',
        ].join(' ')}
      >
        <span className="flex items-center gap-4 p-4">
          <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-xl bg-amp-page/80">
            {definition && (
              <ProductImage
                model={definition}
                colourCode={colourCode}
                className="h-14 w-22 object-contain"
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-bold leading-snug text-amp-ink">{title}</span>
            <span className="mt-0.5 block text-[14px] font-semibold text-amp-ink">{price}</span>
          </span>
          <SelectionDot selected={selected} />
        </span>

        {specs && (
          <dl className="grid grid-cols-3 gap-2 border-t border-amp-line/70 px-4 py-3">
            <Spec icon={<RangeIcon className="size-4" />} label="Range" value={`${specs.rangeKm} km`} />
            <Spec icon={<SpeedIcon className="size-4" />} label="Top speed" value={`${specs.topSpeedKmph} km/h`} />
            <Spec icon={<ChargeIcon className="size-4" />} label="Charge" value={`${specs.chargeHours} hrs`} />
          </dl>
        )}

        {!selected && footer}
      </button>

      {selected && children}
      {selected && footer}
    </div>
  );
}

/**
 * Standard or Intellipack, as tiles — the variant picker shoppers know from
 * Amazon and Flipkart. Each tile carries its own price, so the difference is
 * visible before choosing.
 */
function VariantPicker({
  versions,
  chosen,
  onSelect,
}: {
  versions: ModelAvailability[];
  chosen: ModelAvailability;
  onSelect: (model: ModelAvailability) => void;
}) {
  const label = (m: ModelAvailability) => getModel(m.code)?.variant.label ?? m.name;

  return (
    <div role="group" aria-label="Variant" className="amp-rise border-t border-amp-line/70 px-4 pb-1 pt-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-amp-ink">Variant</p>
        <p className="text-[13px] font-semibold text-amp-ink">{label(chosen)}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {versions.map((version) => {
          const isSelected = version.code === chosen.code;
          return (
            <button
              key={version.code}
              type="button"
              onClick={() => onSelect(version)}
              aria-pressed={isSelected}
              className={[
                'flex min-h-14 cursor-pointer flex-col items-start justify-center rounded-xl border px-3.5 py-2.5 text-left transition-all duration-200',
                FOCUS,
                isSelected
                  ? 'border-amp-accent bg-amp-accent-tint/60 ring-1 ring-amp-accent'
                  : 'border-amp-line bg-white hover:border-amp-ink/40',
              ].join(' ')}
            >
              <span className="text-[14px] font-semibold text-amp-ink">{label(version)}</span>
              <span className="mt-0.5 text-[12px] text-amp-muted">
                {version.price ? version.price.exShowroom.display : 'Price on enquiry'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The chosen scooter's colours, inside its card. */
function ColourPicker({
  modelName,
  colours,
  selectedCode,
  onSelect,
}: {
  modelName: string;
  colours: ModelAvailability['colours'];
  selectedCode: string | null;
  onSelect: (colourCode: string) => void;
}) {
  const selectedName = colours.find((c) => c.code === selectedCode)?.name;

  return (
    <div
      role="group"
      aria-label={`${modelName} colour`}
      className="amp-rise border-t border-amp-line/70 px-4 pb-4 pt-3.5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-amp-ink">Colour</p>
        <p className="text-[13px] font-semibold text-amp-ink">{selectedName ?? 'Pick a colour'}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-1 gap-y-3">
        {colours.map((colour) => {
          const isSelected = colour.code === selectedCode;
          return (
            <button
              key={colour.code}
              type="button"
              onClick={() => onSelect(colour.code)}
              aria-pressed={isSelected}
              aria-label={colour.name}
              className={`group flex w-19 cursor-pointer flex-col items-center gap-2 rounded-xl py-1.5 ${FOCUS}`}
            >
              <span
                aria-hidden
                className={[
                  'size-10 rounded-full border border-black/10 transition-all duration-200',
                  isSelected
                    ? 'ring-2 ring-amp-ink ring-offset-2 ring-offset-white'
                    : 'group-hover:ring-2 group-hover:ring-amp-ink/20 group-hover:ring-offset-2',
                ].join(' ')}
                style={{ background: swatchBackground(colour) }}
              />
              <span
                aria-hidden
                className={[
                  'text-center text-[11px] leading-tight',
                  isSelected ? 'font-semibold text-amp-ink' : 'text-amp-muted',
                ].join(' ')}
              >
                {colour.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Spec({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-amp-muted">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[11px] leading-tight text-amp-muted">{label}</dt>
        <dd className="text-[13px] font-semibold leading-tight text-amp-ink">{value}</dd>
      </div>
    </div>
  );
}
