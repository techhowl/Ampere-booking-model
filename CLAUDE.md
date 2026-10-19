# Ampere /buy

Booking and purchase page for Ampere Electric (Greaves Electric Mobility).
Replaces a third-party form at `enquiry.ampere-electric.com` that Ampere does not control.
Deploys to `buy.ampere-electric.com` — a DigitalOcean droplet, separate from the main site.

Full spec: `docs/build-spec.md`. Read it before starting anything non-trivial.
Juspay's own integration doc and what it changes: `docs/juspay/`.

## Commands

```bash
pnpm dev                              # Next.js dev server
pnpm test                             # vitest
pnpm test -- --watch
pnpm lint && pnpm typecheck
docker compose up -d                  # local Postgres on :5432
pnpm prisma migrate dev --name <name>
pnpm prisma studio
pnpm db:import-pincodes <csv>         # pincode coordinates for the dealer radius
```

## Stack

- Next.js 15 (App Router), React 19, TypeScript `strict: true`
- Tailwind CSS
- Backend is **Next.js route handlers** — do not add a separate API service
- PostgreSQL via Prisma. **No Redis** — OTP and rate limits live in Postgres
- Zod schemas shared between client and server; never define validation twice
- vitest for tests

## What the product does

One page. Customer enters name, phone, pincode → OTP → then either buys the
scooter (EMI, partial payment, or full payment, handed to Juspay) or books a
test ride. Model is preselected when they arrive from a product page.

## Hard rules — do not violate these

- **Save the lead before OTP verification.** The record is written as soon as
  name + phone + pincode are present, with `phoneVerified: false`. An abandoned
  attempt is still a lead. Never gate the write on verification.
- **Amounts are computed server-side** from `price_book`. The client sends
  selections, never money. Never trust an amount from a request body.
- **The Juspay return URL is navigation only.** It carries identical fields on
  success and failure. Never render a confirmation from it. Resolve status via
  webhook first, then the status API. See `src/lib/juspay/juspay.ts`.
- **`paid` is terminal.** No webhook, however late or out of order, downgrades a
  paid order.
- **Never guess a payment outcome.** If status is unresolved, return `unknown`
  and let the UI show "confirming your payment" and poll.
- **Inventory changes hold a row lock** inside a transaction. Reserve on payment
  entry, convert on success, release on failure or expiry. All idempotent.
- **Phone numbers are encrypted at rest** with a separate HMAC for lookup. Never
  log a phone number, in app logs, Sentry, or analytics.
- **Consent is captured at step one**, under the phone field, as two separate
  purposes (transactional, marketing). Storing an unverified number is fine;
  contacting that person later is what needs consent.
- **No card data ever touches this codebase.** Juspay is a hosted redirect flow.

## Conventions

- Server components by default; `'use client'` only where interactivity needs it
- Prefill parsing happens server-side — no client redirect, no empty-form flash
- Every mutating route accepts an `Idempotency-Key`
- Keep first-load JS under 180KB gzipped; this is a mobile-first paid-traffic page
- Tests use real Postgres via Testcontainers, not mocks, for anything touching
  transactions or locking

## Stubbed, not missing

`FakeJuspayClient` drives development and the whole test suite. Juspay
credentials have not arrived yet. Build and test the complete payment flow —
including reconciliation — against the fake. Do not block on real access.
Same pattern for SMS, WhatsApp, and the dealer management system.

## Known unknowns — ask before assuming

- The partial payment amount is undecided. It is configuration
  (`priceBook.partialMode` + `partialValue`); the option is hidden when null.
- Region definitions (which states map to which region) are not yet supplied.
  Inventory is keyed on region, so use seeded placeholder data for now.
- The dealer master and pincode mapping are not yet supplied. Seed placeholders.
