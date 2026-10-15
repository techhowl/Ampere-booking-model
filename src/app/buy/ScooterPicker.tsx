'use client';

import { ACTIVE_FAMILIES, getModel, modelsInFamily } from '@/lib/catalog/catalog';
import type { ModelAvailability } from '@/lib/catalog/availability';
import { Pill, Section } from '@/components/ui';
import { ChargeIcon, RangeIcon, SpeedIcon, TagIcon } from '@/components/Brand';

/**
 * Family tabs, then a card per variant — the Figma's model selector.
 *
 * Each card carries the ex-showroom price, the EMI-from line, three specs and
 * the offers strip. Prices come from the server; nothing here computes money.
 */

interface Props {
  models: ModelAvailability[];
  selectedModelCode: string | null;
  selectedColourCode: string | null;
  onSelectModel: (model: ModelAvailability) => void;
  onSelectColour: (colourCode: string) => void;
}

export function ScooterPicker({
  models,
  selectedModelCode,
  selectedColourCode,
  onSelectModel,
  onSelectColour,
}: Props) {
  const selected = models.find((m) => m.code === selectedModelCode) ?? null;
  const activeFamily = getModel(selectedModelCode)?.family ?? ACTIVE_FAMILIES[0]?.code ?? 'nexus';

  const byCode = new Map(models.map((m) => [m.code, m]));
  const variants = modelsInFamily(activeFamily)
    .map((m) => byCode.get(m.code))
    .filter((m): m is ModelAvailability => m !== undefined);

  const colours = selected?.colours ?? [];
  const colourName = colours.find((c) => c.code === selectedColourCode)?.name;

  return (
    <div className="flex flex-col gap-6">
      <Section>
        <div className="flex flex-wrap gap-2">
          {ACTIVE_FAMILIES.map((family) => (
            <Pill
              key={family.code}
              selected={family.code === activeFamily}
              onClick={() => {
                const first = modelsInFamily(family.code)
                  .map((m) => byCode.get(m.code))
                  .find((m): m is ModelAvailability => m !== undefined);
                if (first) onSelectModel(first);
              }}
              className="uppercase tracking-wide"
            >
              {family.name}
            </Pill>
          ))}
        </div>

        <div className="mt-1 flex flex-col gap-3">
          {variants.map((variant) => (
            <VariantCard
              key={variant.code}
              model={variant}
              selected={variant.code === selectedModelCode}
              onSelect={() => onSelectModel(variant)}
            />
          ))}
        </div>

        <p className="text-[12px] text-amp-muted">*This is the ex-showroom price.</p>
      </Section>

      {colours.length > 0 && (
        <Section label="What colour do you prefer?">
          <div className="flex flex-wrap items-center gap-3">
            {colours.map((colour) => {
              const isSelected = colour.code === selectedColourCode;
              return (
                <button
                  key={colour.code}
                  type="button"
                  onClick={() => onSelectColour(colour.code)}
                  aria-pressed={isSelected}
                  title={colour.name}
                  className={[
                    'size-9 cursor-pointer rounded-full border-2 transition-all',
                    isSelected
                      ? 'border-amp-ink ring-2 ring-amp-ink/15 ring-offset-2 ring-offset-amp-page'
                      : 'border-black/10 hover:border-amp-ink/40',
                  ].join(' ')}
                  style={{ backgroundColor: colour.hex }}
                >
                  <span className="sr-only">{colour.name}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[13px] text-amp-ink">{colourName ?? 'Pick a colour'}</p>
        </Section>
      )}
    </div>
  );
}

function VariantCard({
  model,
  selected,
  onSelect,
}: {
  model: ModelAvailability;
  selected: boolean;
  onSelect: () => void;
}) {
  const specs = getModel(model.code)?.specs;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'group cursor-pointer overflow-hidden rounded-2xl border text-left transition-all',
        selected
          ? 'border-amp-ink ring-1 ring-amp-ink'
          : 'border-amp-line hover:border-amp-ink/40',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-4 bg-amp-card px-4 py-3.5">
        <span className="text-[15px] font-bold uppercase tracking-wide text-amp-ink">
          {model.name}
        </span>
        <span className="text-right">
          <span className="block text-[15px] font-bold text-amp-ink">
            {model.price ? `${model.price.exShowroom.display}*` : 'On enquiry'}
          </span>
          {model.price && (
            /* "EMI available", not "EMIs from ₹X" — the rate is the lender's
               to quote, on Juspay's page. */
            <span className="mt-0.5 block text-[12px] text-amp-muted">Ex-showroom</span>
          )}
        </span>
      </div>

      {specs && (
        <dl className="grid grid-cols-3 gap-2 bg-amp-page px-4 py-3">
          <Spec icon={<SpeedIcon className="size-4" />} value={`${specs.topSpeedKmph} km/hr`} />
          <Spec icon={<ChargeIcon className="size-4" />} value={`${specs.chargeHours} hrs charge`} />
          <Spec icon={<RangeIcon className="size-4" />} value={`${specs.rangeKm} km range`} />
        </dl>
      )}

      {/* The offers strip. Copy is a placeholder until Marketing supplies it. */}
      <p className="flex items-start gap-2 bg-amp-offer px-4 py-2.5 text-[12px] leading-relaxed text-amp-offer-ink">
        <TagIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Benefits up to ₹5,000. Additional offers on Flipkart and Amazon. Visit the
          dealership to know more.
        </span>
      </p>

      {!model.inStock && model.price && (
        <p className="bg-amber-50 px-4 py-2 text-[12px] text-amber-900">
          In short supply in your area — your dealer will confirm the timeline.
        </p>
      )}
    </button>
  );
}

function Spec({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-amp-muted">{icon}</span>
      <dd className="text-center text-[12px] leading-tight text-amp-ink">{value}</dd>
    </div>
  );
}
