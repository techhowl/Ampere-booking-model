'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { isValidPhone, isValidPincode } from '@/lib/phone-format';
import type { LeadCreatedResponse } from '@/lib/schemas/lead';
import type { OtpRequestResponse } from '@/lib/schemas/otp';
import type { NearbyDealersResponse } from '@/lib/schemas/dealer';
import { Checkbox, Field, Notice, PrimaryButton, inputClass } from '@/components/ui';
import { CheckIcon, PinIcon } from '@/components/Brand';
import { StepActions, StepHeader } from './StepFrame';
import type { Prefill } from './prefill';

/**
 * Step one: name, phone, pincode — then the OTP.
 *
 * Spec 5: the record is written the moment these three are valid, with
 * phone_verified = false, BEFORE the code is sent. An abandoned attempt is
 * still a lead somebody can call. Nothing here gates that write. That is why
 * the pincode comes before the code rather than after it: the lead needs all
 * three.
 *
 * Consent sits directly under the phone field, two purposes, neither
 * pre-ticked. A customer who abandons before OTP never reaches a checkbox at
 * the bottom of a form.
 *
 * Also where a customer lands to verify AGAIN — after a refresh mid-OTP, or
 * when their session timed out. The lead is already saved, so the fields show
 * what we hold (the number only by its last four digits; the browser is never
 * given the rest) and the button sends a fresh code.
 */

interface Props {
  prefill: Prefill;
  attribution: Record<string, unknown>;
  lead: LeadCreatedResponse | null;
  /** The name on a lead already saved, when picking it back up. */
  initialName?: string;
  /** Why they are here again, shown above the form. */
  notice?: ReactNode;
  onSaved: (lead: LeadCreatedResponse, name: string) => void;
  onVerified: () => void;
  /** Unlock the fields again — a mistyped number must not be a dead end. */
  onEdit: () => void;
  /** "Not you?" — forget this browser's lead entirely. */
  onStartOver?: () => void;
}

type FieldErrors = Partial<
  Record<'name' | 'phone' | 'pincode', string>
>;

export function IdentityStep({
  prefill,
  attribution,
  lead,
  initialName,
  notice,
  onSaved,
  onVerified,
  onEdit,
  onStartOver,
}: Props) {
  const nameId = useId();
  const phoneId = useId();
  const pincodeId = useId();
  const codeId = useId();

  const [name, setName] = useState(initialName ?? '');
  const [phone, setPhone] = useState('');
  const [pincode, setPincode] = useState(lead?.pincode ?? prefill.pincode ?? '');
  const [marketing, setMarketing] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [areaHint, setAreaHint] = useState<string | null>(null);

  const [otpRef, setOtpRef] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  // One key per attempt: a retry after a network failure reuses it, so a
  // request that actually landed never becomes a second lead. Editing the
  // details is a new attempt and takes a new key.
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const codeInput = useRef<HTMLInputElement>(null);

  /* Say who is near them as they finish typing — reassurance, before the ask. */
  useEffect(() => {
    if (!isValidPincode(pincode)) {
      setAreaHint(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/dealers/nearby?pincode=${pincode}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        setAreaHint(describeArea((await res.json()) as NearbyDealersResponse));
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

  // Put the cursor where the customer's attention already is.
  useEffect(() => {
    if (otpRef) codeInput.current?.focus();
  }, [otpRef]);

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
        // testCode only comes back on UAT, where no SMS provider exists yet.
        // Saying "TEST MODE" out loud matters: if this ever appeared on the
        // live site it should be obvious to anyone, not just to us. It is
        // filled in too, so a tester taps Verify — and still goes through the
        // real verification, so what is tested is what ships.
        if (body.testCode) setCode(body.testCode);
        setOtpNotice(
          body.testCode
            ? `TEST MODE — your code is ${body.testCode}`
            : 'Code sent. It may take a few seconds to arrive.',
        );
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
    if (name.trim().length < 2) found.name = 'Please enter your full name';
    if (!isValidPhone(phone)) found.phone = 'Enter a valid 10-digit mobile number';
    if (!isValidPincode(pincode)) found.pincode = 'Enter a valid 6-digit pincode';
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
        onSaved((await res.json()) as LeadCreatedResponse, name.trim());
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

  function editDetails() {
    idempotencyKey.current = crypto.randomUUID();
    setOtpRef(null);
    setCode('');
    setOtpError(null);
    setOtpNotice(null);
    onEdit();
  }

  /* ---------------------------------------------------------------- */

  const locked = !!lead;
  // A saved lead with no code on its way yet: after a refresh, a timeout, or a
  // code that died. The button asks for one.
  const needsCode = !!lead && !otpRef;

  return (
    <div className="flex flex-col gap-7">
      <StepHeader
        title="Let’s Get to Know You"
        text="Enter your details to continue with your Ampere booking."
      />

      {notice && <Notice>{notice}</Notice>}

      <form
        onSubmit={(event) => {
          if (!lead) return void saveLead(event);
          event.preventDefault();
          if (needsCode) void sendCode();
          else void verify(event);
        }}
        noValidate
        className="flex flex-col gap-5"
      >
        <Field label="Full name" htmlFor={nameId} error={errors.name}>
          <input
            id={nameId}
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="As on your ID"
            disabled={locked}
            className={inputClass(!!errors.name)}
            aria-invalid={!!errors.name}
          />
        </Field>

        <Field label="Mobile number" htmlFor={phoneId} error={errors.phone}>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 flex items-center border-r border-amp-line pl-4 pr-3 text-[15px] font-medium text-amp-ink/70"
            >
              +91
            </span>
            <input
              id={phoneId}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={14}
              // A resumed lead's number is shown masked: the browser is only
              // ever given its last four digits.
              value={locked && !phone && lead ? `•••••• ${lead.phoneLast4}` : phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d\s+]/g, ''))}
              placeholder="10-digit mobile number"
              disabled={locked}
              className={`${inputClass(!!errors.phone)} pl-17`}
              aria-invalid={!!errors.phone}
            />
          </div>
        </Field>

        {/* Consent, at step one, under the phone field. Two purposes,
            recorded independently. Being contacted about the enquiry is the
            point of the form, so it is a notice the customer agrees to by
            pressing Send OTP — said plainly, here, before they press it — and
            recorded with its version like the marketing one. Marketing stays
            a box nobody has ticked for them. */}
        {!locked && (
          <fieldset className="-mt-1 flex flex-col gap-1.5 rounded-xl bg-amp-page/70 px-3.5 py-2.5">
            <legend className="sr-only">How we may contact you</legend>
            <p className="text-[12px] leading-relaxed text-amp-muted">
              By continuing, you agree that Ampere and its dealers may contact you about this
              enquiry.
            </p>
            <Checkbox checked={marketing} onChange={setMarketing}>
              Send me offers and product news.{' '}
              <span className="text-amp-muted">Optional</span>
            </Checkbox>
          </fieldset>
        )}

        <Field label="Pincode" htmlFor={pincodeId} error={errors.pincode} hint={areaHint ?? undefined}>
          <div className="relative">
            <input
              id={pincodeId}
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              value={pincode}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
              placeholder="Where do you stay?"
              disabled={locked}
              className={`${inputClass(!!errors.pincode)} pr-11`}
              aria-invalid={!!errors.pincode}
            />
            <PinIcon className="pointer-events-none absolute right-4 top-1/2 size-4.5 -translate-y-1/2 text-amp-muted" />
          </div>
        </Field>

        {/* The code, once it is on its way. Same step, same screen. */}
        {lead && (
          <div className="amp-rise flex flex-col gap-3 rounded-2xl border border-amp-line bg-amp-page/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <label htmlFor={codeId} className="text-[14px] font-semibold text-amp-ink">
                  {needsCode ? 'Verify your number' : 'Enter verification code'}
                </label>
                <p className="mt-0.5 text-[13px] text-amp-muted">
                  {needsCode ? 'We’ll text a 6-digit code to' : 'Sent by SMS to'} +91 ••••••
                  {lead.phoneLast4}
                </p>
              </div>
              <button
                type="button"
                onClick={editDetails}
                className="shrink-0 cursor-pointer rounded-md px-1 text-[13px] font-semibold text-amp-accent-fill underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-amp-accent"
              >
                Change number
              </button>
            </div>

            {!needsCode && (
              <input
                ref={codeInput}
                id={codeId}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                className={`${inputClass(!!otpError)} text-center text-[22px] font-semibold tracking-[0.5em] placeholder:tracking-[0.5em]`}
                aria-invalid={!!otpError}
                aria-describedby={`${codeId}-status`}
              />
            )}

            {/* Nothing to say yet before a code is sent, so no empty line. */}
            {(!needsCode || otpError || otpNotice) && (
              <div id={`${codeId}-status`} className="flex items-center justify-between gap-3 text-[13px]">
                {otpError ? (
                  <p role="alert" className="text-red-600">
                    {otpError}
                  </p>
                ) : (
                  <p className="text-amp-muted">{otpNotice ?? <>&nbsp;</>}</p>
                )}
                {!needsCode && (
                  <button
                    type="button"
                    onClick={() => void sendCode()}
                    disabled={cooldown > 0 || busy}
                    className="shrink-0 cursor-pointer rounded-md px-1 font-semibold text-amp-accent-fill transition-colors hover:text-amp-accent-dark focus-visible:outline-2 focus-visible:outline-amp-accent disabled:cursor-not-allowed disabled:font-medium disabled:text-amp-muted"
                  >
                    {cooldown > 0 ? `Resend in ${formatCooldown(cooldown)}` : 'Resend OTP'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {formError && <Notice tone="error">{formError}</Notice>}

        <StepActions>
          <PrimaryButton
            type="submit"
            loading={submitting || (busy && !!lead && (needsCode || code.length === 6))}
            disabled={busy || (!!lead && !needsCode && code.length !== 6) || (needsCode && cooldown > 0)}
          >
            {!lead || needsCode
              ? needsCode && cooldown > 0
                ? `Send OTP in ${formatCooldown(cooldown)}`
                : 'Send OTP'
              : 'Verify & Continue'}
          </PrimaryButton>
        </StepActions>

        {lead && (
          // Spec 4: the record stays saved whether or not this step completes.
          <p className="-mt-2 text-center text-[12px] leading-relaxed text-amp-muted">
            Your details are saved. If the code doesn&apos;t arrive, we&apos;ll still call you.
          </p>
        )}

        {onStartOver && <StartOver onClick={onStartOver} />}
      </form>
    </div>
  );
}

/**
 * Step one again, once verified. Nothing to re-enter — the number is proven and
 * the lead is written — so this is a summary and a way forward.
 */
export function VerifiedDetails({
  name,
  lead,
  onContinue,
  onStartOver,
}: {
  name: string;
  lead: LeadCreatedResponse;
  onContinue: () => void;
  onStartOver: () => void;
}) {
  return (
    <div className="flex flex-col gap-7">
      <StepHeader title="Let’s Get to Know You" text="Your number is verified. You’re all set." />

      <div className="flex items-center gap-4 rounded-2xl border border-amp-line bg-white p-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amp-ink text-[16px] font-bold uppercase text-white"
        >
          {name.trim()[0] ?? '·'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-amp-ink">{name}</p>
          <p className="mt-0.5 text-[13px] text-amp-muted">
            +91 ••••••{lead.phoneLast4} · {lead.pincode}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amp-offer px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amp-offer-ink">
          <CheckIcon className="size-3" />
          Verified
        </span>
      </div>

      <StepActions>
        <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
      </StepActions>

      <StartOver onClick={onStartOver} />
    </div>
  );
}

/**
 * For a shared phone: the next person must not carry on with someone else's
 * verified booking. Forgets this browser's lead and starts clean.
 */
function StartOver({ onClick }: { onClick: () => void }) {
  return (
    <p className="text-center text-[13px] text-amp-muted">
      Not you?{' '}
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer rounded font-semibold text-amp-ink underline underline-offset-4 hover:text-amp-accent-fill focus-visible:outline-2 focus-visible:outline-amp-accent"
      >
        Start over
      </button>
    </p>
  );
}

function formatCooldown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function describeArea(data: NearbyDealersResponse): string | null {
  const n = data.dealers.length;
  if (n === 0) return null;
  if (data.basis === 'radius') {
    return `${n} Ampere ${n === 1 ? 'dealer' : 'dealers'} within ${data.radiusKm} km of you`;
  }
  return 'Ampere dealers serve your area';
}
