'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { isValidPhone, isValidPincode } from '@/lib/phone-format';
import type { LeadCreatedResponse } from '@/lib/schemas/lead';
import type { OtpRequestResponse } from '@/lib/schemas/otp';
import { Checkbox, Field, PrimaryButton, Section, inputClass } from '@/components/ui';
import { CheckIcon, PhoneIcon, PinIcon } from '@/components/Brand';
import type { Prefill } from './prefill';

/**
 * Step one: name, phone, pincode — and OTP, inline.
 *
 * Spec 5: the record is written the moment these three are valid, with
 * phone_verified = false, BEFORE the code is sent. An abandoned attempt is
 * still a lead somebody can call. Nothing here gates that write.
 *
 * The verification field appears under the phone rather than on its own
 * screen, so the customer never leaves the page — the design's shape, and the
 * spec's rule, at the same time.
 *
 * Consent sits directly under the phone field, two purposes, neither
 * pre-ticked. A customer who abandons before OTP never reaches a checkbox at
 * the bottom of a form.
 */

interface Props {
  prefill: Prefill;
  attribution: Record<string, unknown>;
  lead: LeadCreatedResponse | null;
  verified: boolean;
  onSaved: (lead: LeadCreatedResponse) => void;
  onVerified: () => void;
}

type FieldErrors = Partial<
  Record<'name' | 'phone' | 'pincode' | 'consent.transactional', string>
>;

export function IdentityStep({
  prefill,
  attribution,
  lead,
  verified,
  onSaved,
  onVerified,
}: Props) {
  const nameId = useId();
  const phoneId = useId();
  const pincodeId = useId();
  const codeId = useId();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pincode, setPincode] = useState(prefill.pincode ?? '');
  const [transactional, setTransactional] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dealerName, setDealerName] = useState<string | null>(null);

  const [otpRef, setOtpRef] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  // One key per mount: a retry after a network failure reuses it, so a request
  // that actually landed never becomes a second lead.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  /* Resolve the dealer as they finish typing, so it appears before they submit. */
  useEffect(() => {
    if (!isValidPincode(pincode)) {
      setDealerName(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/dealers/resolve?pincode=${pincode}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { dealer: { name: string } | null };
        setDealerName(data.dealer?.name ?? null);
      } catch {
        // Cosmetic. It must never block the save.
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pincode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const sendCode = useCallback(async () => {
    setBusy(true);
    setOtpError(null);
    setOtpNotice(null);
    try {
      const res = await fetch('/api/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => null)) as
        | (Partial<OtpRequestResponse> & { message?: string; retryAfterSeconds?: number })
        | null;

      if (res.ok && body?.otpRef) {
        setOtpRef(body.otpRef);
        setCooldown(body.resendAfterSeconds ?? 60);
        setOtpNotice('Code sent. Check your messages.');
        return;
      }
      if (body?.retryAfterSeconds) setCooldown(body.retryAfterSeconds);
      setOtpError(body?.message ?? 'We could not send a code. Please try again.');
    } catch {
      setOtpError('We could not reach our servers. Check your connection.');
    } finally {
      setBusy(false);
    }
  }, []);

  async function saveLead(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const found: FieldErrors = {};
    if (name.trim().length < 2) found.name = 'Please enter your name';
    if (!isValidPhone(phone)) found.phone = 'Enter a valid 10-digit mobile number';
    if (!isValidPincode(pincode)) found.pincode = 'Enter a valid 6-digit pincode';
    if (!transactional) {
      found['consent.transactional'] = 'We need your permission to contact you';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey.current,
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          pincode: pincode.trim(),
          consent: { transactional: true, marketing },
          modelCode: prefill.modelCode,
          colourCode: prefill.colourCode,
          intent: prefill.intent,
          attribution,
        }),
      });

      if (res.ok) {
        onSaved((await res.json()) as LeadCreatedResponse);
        await sendCode();
        return;
      }

      const body = (await res.json().catch(() => null)) as {
        fields?: Record<string, string>;
        message?: string;
      } | null;
      if (body?.fields) setErrors(body.fields as FieldErrors);
      else setFormError(body?.message ?? 'Something went wrong. Please try again.');
    } catch {
      setFormError('We could not reach our servers. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!otpRef || code.length !== 6) return;

    setBusy(true);
    setOtpError(null);
    try {
      const res = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otpRef, code }),
      });
      if (res.ok) {
        onVerified();
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
        attemptsRemaining?: number;
      } | null;

      // A dead code needs a new one, not another guess at this one.
      if (body?.error && body.error !== 'incorrect') {
        setOtpRef(null);
      }
      const left = body?.attemptsRemaining;
      setOtpError(
        body?.error === 'incorrect' && typeof left === 'number' && left > 0
          ? `${body.message} ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : (body?.message ?? 'That code is not valid.'),
      );
      setCode('');
    } catch {
      setOtpError('We could not reach our servers. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- */

  if (verified && lead) {
    return (
      <Section label="Your details">
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-amp-line bg-amp-card px-4 py-3.5">
          <div>
            <p className="text-[15px] font-semibold text-amp-ink">{name}</p>
            <p className="mt-0.5 text-[13px] text-amp-muted">
              ••••{lead.phoneLast4} · {lead.pincode}
              {lead.dealer ? ` · ${lead.dealer.name}` : ''}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amp-offer px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amp-offer-ink">
            <CheckIcon className="size-3" />
            Verified
          </span>
        </div>
      </Section>
    );
  }

  return (
    <form onSubmit={lead ? verify : saveLead} noValidate className="flex flex-col gap-5">
      <Section label="Give us your details">
        <Field htmlFor={nameId} error={errors.name}>
          <input
            id={nameId}
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full Name"
            disabled={!!lead}
            className={inputClass(!!errors.name)}
            aria-invalid={!!errors.name}
          />
        </Field>

        <Field htmlFor={phoneId} error={errors.phone}>
          <div className="relative">
            <input
              id={phoneId}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={13}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d\s+]/g, ''))}
              placeholder="Phone Number"
              disabled={!!lead}
              className={`${inputClass(!!errors.phone)} ${lead ? 'pr-28' : 'pr-11'}`}
              aria-invalid={!!errors.phone}
            />
            {!lead && (
              <PhoneIcon className="pointer-events-none absolute right-4 top-1/2 size-[18px] -translate-y-1/2 text-amp-muted" />
            )}
            {lead && (
              <button
                type="button"
                onClick={() => void sendCode()}
                disabled={cooldown > 0 || busy}
                className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded-lg px-1.5 py-1 text-[13px] font-semibold text-amp-accent transition-colors hover:text-amp-accent-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-amp-accent disabled:cursor-not-allowed disabled:text-amp-muted"
              >
                {busy ? 'Sending…' : cooldown > 0 ? `Resend ${cooldown}s` : 'Resend OTP'}
              </button>
            )}
          </div>
        </Field>

        {/* OTP, inline — the customer never leaves the page. */}
        {lead && (
          <Field htmlFor={codeId} error={otpError ?? undefined} hint={otpNotice ?? undefined}>
            <input
              id={codeId}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter the 6-digit code"
              className={`${inputClass(!!otpError)} text-center tracking-[0.35em]`}
              aria-invalid={!!otpError}
            />
          </Field>
        )}

        {/* Consent, at step one, under the phone field. Two purposes,
            recorded independently. Neither pre-ticked. */}
        {!lead && (
          <fieldset className="flex flex-col gap-2.5 rounded-2xl border border-amp-line bg-amp-card p-3.5">
            <legend className="sr-only">How we may contact you</legend>
            <Checkbox
              checked={transactional}
              onChange={setTransactional}
              invalid={!!errors['consent.transactional']}
            >
              You may contact me about this enquiry.{' '}
              <span className="text-amp-muted">Required</span>
            </Checkbox>
            <Checkbox checked={marketing} onChange={setMarketing}>
              You may send me offers and product news.{' '}
              <span className="text-amp-muted">Optional</span>
            </Checkbox>
            {errors['consent.transactional'] && (
              <p role="alert" className="text-[13px] text-red-600">
                {errors['consent.transactional']}
              </p>
            )}
          </fieldset>
        )}

        <Field
          htmlFor={pincodeId}
          error={errors.pincode}
          hint={dealerName ? `Nearest dealer: ${dealerName}` : undefined}
        >
          <div className="relative">
            <input
              id={pincodeId}
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              value={pincode}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
              placeholder="Where do you stay? Enter pincode"
              disabled={!!lead}
              className={`${inputClass(!!errors.pincode)} pr-11`}
              aria-invalid={!!errors.pincode}
            />
            {!lead && (
              <PinIcon className="pointer-events-none absolute right-4 top-1/2 size-[18px] -translate-y-1/2 text-amp-muted" />
            )}
          </div>
        </Field>
      </Section>

      {formError && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {formError}
        </p>
      )}

      <PrimaryButton type="submit" disabled={submitting || busy || (!!lead && code.length !== 6)}>
        {lead ? (busy ? 'Checking…' : 'Verify and continue') : submitting ? 'Saving…' : 'Continue'}
      </PrimaryButton>

      {lead && (
        // Spec 4: the record stays saved whether or not this step completes.
        <p className="text-center text-[12px] leading-relaxed text-amp-muted">
          Your details are already saved. If the code doesn&apos;t arrive, we&apos;ll still
          call you.
        </p>
      )}
    </form>
  );
}
