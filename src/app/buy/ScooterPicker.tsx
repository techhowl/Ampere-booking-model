'use client';

import { ACTIVE_FAMILIES, getModel, modelsInFamily } from '@/lib/catalog/catalog';
import type { ModelAvailability } from '@/lib/catalog/availability';
import { ChoiceCard, FOCUS, Notice, PrimaryButton, SelectionDot, Skeleton } from '@/components/ui';
import { ProductImage } from '@/components/ProductImage';
import { ChargeIcon, RangeIcon, SpeedIcon, TagIcon } from '@/components/Brand';
import { StepActions, StepHeader } from './StepFrame';

/**
 * Step two: family tabs, a card per variant, then the colour.
 *
 * Each card carries the ex-showroom price, three specs and the offers strip.
 * Prices come from the server; nothing here computes money. The model and
 * colour arrive preselected when the customer came from a product page.
 */

interface Props {
  /** Null while the catalog loads. */
  models: ModelAvailability[] | null;
  loadFailed: boolean;
  onRetry: () => void;
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

  const selected = models.find((m) => m.code === selectedModelCode) ?? null;
  const activeFamily = getModel(selectedModelCode)?.family ?? ACTIVE_FAMILIES[0]?.code ?? 'nexus';

  const byCode = new Map(models.map((m) => [m.code, m]));
  const variants = modelsInFamily(activeFamily)
    .map((m) => byCode.get(m.code))
    .filter((m): m is ModelAvailability => m !== undefined);

  const colours = selected?.colours ?? [];
  const colourName = colours.find((c) => c.code === selectedColourCode)?.name;

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
                  const first = modelsInFamily(family.code)
                    .map((m) => byCode.get(m.code))
                    .find((m): m is ModelAvailability => m !== undefined);
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
          {variants.map((variant) => (
            <VariantCard
              key={variant.code}
              model={variant}
              selected={variant.code === selectedModelCode}
              colourCode={variant.code === selectedModelCode ? selectedColourCode : null}
              onSelect={() => onSelectModel(variant)}
            />
          ))}
        </div>
      </div>

      {colours.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="colour-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="colour-heading" className="text-[13px] font-medium text-amp-ink">
              Colour
            </h3>
            <p className="text-[13px] font-semibold text-amp-ink">{colourName ?? 'Pick a colour'}</p>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-3">
            {colours.map((colour) => {
              const isSelected = colour.code === selectedColourCode;
              return (
                <button
                  key={colour.code}
                  type="button"
                  onClick={() => onSelectColour(colour.code)}
                  aria-pressed={isSelected}
                  className={`group flex w-18 cursor-pointer flex-col items-center gap-2 rounded-xl py-1.5 ${FOCUS}`}
                >
                  <span
                    aria-hidden
                    className={[
                      'size-10 rounded-full border border-black/10 transition-all duration-200',
                      isSelected
                        ? 'ring-2 ring-amp-ink ring-offset-2 ring-offset-white'
                        : 'group-hover:ring-2 group-hover:ring-amp-ink/20 group-hover:ring-offset-2',
                    ].join(' ')}
                    style={{ backgroundColor: colour.hex }}
                  />
                  <span
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
        </section>
      )}

      <p className="-mt-3 text-[12px] text-amp-muted">*Ex-showroom price for your pincode.</p>

      <StepActions onBack={onBack}>
        <PrimaryButton onClick={onContinue} disabled={!selected || !selectedColourCode}>
          Continue to Dealers
        </PrimaryButton>
      </StepActions>
    </div>
  );
}

function VariantCard({
  model,
  selected,
  colourCode,
  onSelect,
}: {
  model: ModelAvailability;
  selected: boolean;
  colourCode: string | null;
  onSelect: () => void;
}) {
  const definition = getModel(model.code);
  const specs = definition?.specs;

  return (
    <ChoiceCard selected={selected} onClick={onSelect} className="overflow-hidden">
      <div className="flex items-center gap-4 p-4">
        <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-xl bg-amp-page/80">
          {definition && (
            <ProductImage
              model={definition}
              colourCode={colourCode}
              className="h-14 w-22 object-contain"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold leading-snug text-amp-ink">{model.name}</p>
          <p className="mt-0.5 text-[14px] font-semibold text-amp-ink">
            {model.price ? `${model.price.exShowroom.display}*` : 'Price on enquiry'}
          </p>
        </div>
        <SelectionDot selected={selected} />
      </div>

      {specs && (
        <dl className="grid grid-cols-3 gap-2 border-t border-amp-line/70 px-4 py-3">
          <Spec icon={<RangeIcon className="size-4" />} label="Range" value={`${specs.rangeKm} km`} />
          <Spec icon={<SpeedIcon className="size-4" />} label="Top speed" value={`${specs.topSpeedKmph} km/h`} />
          <Spec icon={<ChargeIcon className="size-4" />} label="Charge" value={`${specs.chargeHours} hrs`} />
        </dl>
      )}

      {/* The offers strip. Copy is a placeholder until Marketing supplies it. */}
      <p className="flex items-start gap-2 bg-amp-offer px-4 py-2.5 text-[12px] leading-relaxed text-amp-offer-ink">
        <TagIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Benefits up to ₹5,000. Additional offers on Flipkart and Amazon. Visit the dealership to
          know more.
        </span>
      </p>

      {!model.inStock && model.price && (
        <p className="bg-amber-50 px-4 py-2 text-[12px] text-amber-900">
          In short supply in your area — your dealer will confirm the timeline.
        </p>
      )}
    </ChoiceCard>
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
