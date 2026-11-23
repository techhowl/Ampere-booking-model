'use client';

import { useEffect, useId, useState } from 'react';
import { getModel } from '@/lib/catalog/catalog';
import { isValidPincode } from '@/lib/phone-format';
import { PINCODE_INVALID_MESSAGE } from '@/lib/schemas/lead';
import { Field, PrimaryButton, inputClass } from '@/components/ui';
import { PinIcon } from '@/components/Brand';
import { ProductImage } from '@/components/ProductImage';
import { Eyebrow } from './StepFrame';

/**
 * The pincode popup that opens the page during the Zoho pilot. See gate.ts
 * for why it exists and what decides where it leads.
 *
 * A plain GET form back to /buy: without JavaScript it still submits, and the
 * server answers with the journey or a redirect to Goal App. With JavaScript it
 * also catches a mistyped pincode before the round trip.
 */

interface Props {
  /** The link's own parameters, sent back with the pincode. */
  carried: [string, string][];
  /** Set when the server was sent a pincode it could not use. */
  error: string | null;
  /** The scooter the customer came from, if any. */
  modelCode: string | null;
  colourCode: string | null;
}

export function PincodeGate({ carried, error: serverError, modelCode, colourCode }: Props) {
  const inputId = useId();
  const headingId = useId();
  const [pincode, setPincode] = useState('');
  const [error, setError] = useState<string | null>(serverError);
  const [sending, setSending] = useState(false);
  const model = getModel(modelCode);

  // Back from Goal App, the browser may restore this page exactly as it was
  // left: with the spinner still on. Clear it.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSending(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] items-start justify-center bg-amp-ink/6 px-4 py-8 sm:items-center sm:py-12 lg:min-h-[calc(100dvh-4rem)]">
      <section
        aria-labelledby={headingId}
        className="amp-pop w-full max-w-md rounded-3xl bg-white px-5 py-7 shadow-[0_1px_2px_rgba(16,21,28,0.06),0_32px_64px_-32px_rgba(16,21,28,0.45)] ring-1 ring-black/5 sm:px-8 sm:py-9"
      >
        {model && (
          <div className="-mt-2 mb-4 flex h-36 items-center justify-center sm:h-44">
            <ProductImage
              model={model}
              colourCode={colourCode}
              priority
              className="h-full w-auto object-contain"
            />
          </div>
        )}

        <header className="flex flex-col gap-1.5">
          <Eyebrow>Book a test ride</Eyebrow>
          <h1
            id={headingId}
            className="text-[24px] font-bold leading-tight tracking-tight text-amp-ink sm:text-[26px]"
          >
            Let’s find a dealer near you.
          </h1>
          <p className="text-[15px] leading-relaxed text-amp-muted">
            {model
              ? `Enter your pincode to book a free test ride on the ${model.name}.`
              : 'Enter your pincode to book a free test ride at an Ampere dealer near you.'}
          </p>
        </header>

        <form
          method="get"
          action="/buy"
          noValidate
          onSubmit={(event) => {
            if (sending) return event.preventDefault();
            if (!isValidPincode(pincode)) {
              event.preventDefault();
              setError(PINCODE_INVALID_MESSAGE);
              return;
            }
            // Left to submit natively: the server decides where it goes.
            setError(null);
            setSending(true);
          }}
          className="mt-6 flex flex-col gap-5"
        >
          {carried.map(([name, value], index) => (
            <input key={`${name}:${index}`} type="hidden" name={name} value={value} />
          ))}

          <Field label="Pincode" htmlFor={inputId} error={error ?? undefined}>
            <div className="relative">
              <input
                id={inputId}
                name="pincode"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={6}
                // The one question on the screen.
                autoFocus
                value={pincode}
                onChange={(e) => {
                  setPincode(e.target.value.replace(/\D/g, ''));
                  if (error) setError(null);
                }}
                placeholder="Enter your 6-digit pincode"
                className={`${inputClass(!!error)} pr-11`}
                aria-invalid={!!error}
              />
              <PinIcon className="pointer-events-none absolute right-4 top-1/2 size-4.5 -translate-y-1/2 text-amp-muted" />
            </div>
          </Field>

          <PrimaryButton type="submit" loading={sending} className="w-full">
            Continue
          </PrimaryButton>
        </form>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-amp-muted">
          We use your pincode only to find dealers near you.
        </p>
      </section>
    </div>
  );
}
