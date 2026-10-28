# Ampere `/buy` — Starter Repo

Booking and purchase page for Ampere Electric. Replaces the third-party form at
`enquiry.ampere-electric.com`.

Spec: *Ampere Purchase Journey — Build Specification v2.0*.

---

## What is here

This is not a full application. It is the scaffolding for the two parts of the
build that are hardest to get right and that need nothing from any third party,
so they can be finished first:

| File | What it does |
|---|---|
| `prisma/schema.prisma` | The full data model |
| `prisma/seed.ts` | Placeholder dealers, pincodes, price book, inventory |
| `src/app/buy/` | The `/buy` page: prefill, step machine, product panel, all four steps |
| `src/components/ProductImage.tsx` | **Asset slot** — scooter photography |
| `src/components/Brand.tsx` | **Asset slot** — logo and spec icons |
| `src/app/globals.css` | **Asset slot** — brand colours and typeface, in one `@theme` block |
| `src/lib/leads/save-lead.ts` | Save-before-OTP, with consent recorded per purpose |
| `src/lib/test-rides/slots.ts` | Rolling 7-day window and the four slots, computed in IST |
| `src/lib/test-rides/book.ts` | Booking, home-mode fallback, dealer notification |
| `src/lib/notifications/dealer.ts` | Dealer notification behind a fake client |
| `src/lib/pricing/price.ts` | Server-side price resolution from `price_book` |
| `src/lib/catalog/availability.ts` | Models + colours + price + stock, per region |
| `src/lib/otp/otp.ts` | Code issue and verification, keyed hash, attempt limits |
| `src/lib/rate-limit/` | Per phone, per IP, per device — in Postgres, no Redis |
| `src/lib/sms/sms.ts` | SMS behind an interface; `FakeSmsClient` drives dev and tests |
| `src/lib/turnstile.ts` | Bot defence on OTP, active wherever the secret is set |
| `src/lib/crypto/phone.ts` | Phone encryption, HMAC lookup index, masking |
| `src/lib/crypto/session.ts` | Signed continuity cookie |
| `src/lib/idempotency/` | `Idempotency-Key` interceptor for every mutating route |
| `src/lib/dealers/resolve.ts` | Pincode to region and dealer, with fallback |
| `src/lib/dealers/nearby.ts` | Up to three dealers within 15 km of a pincode, for the dealer step |
| `src/lib/catalog/catalog.ts` | Models, colours and regions — see note below |
| `src/lib/inventory/inventory.ts` | Stock reservation with row-level locking |
| `src/lib/inventory/inventory.db.test.ts` | Locking, retry and oversell tests, real Postgres |
| `src/lib/juspay/juspay.ts` | Fake + real Juspay clients, status resolution |
| `src/lib/juspay/juspay.test.ts` | The five payment failure modes |
| `src/lib/db.ts` | Prisma client singleton |
| `src/app/api/health/route.ts` | Liveness + database reachability |
| `docker-compose.yml` | Local Postgres |
| `deploy/` | DigitalOcean droplet configuration |

Everything else — the pages, the form, OTP, the admin grid — gets built on top.

### Design assets

Ampere's real design has not arrived yet, so the page is built against named
slots. When it does, these are the only places that change:

| Asset | Where it goes |
|---|---|
| Scooter photography | `public/models/` — see the README there |
| Brand typeface | `public/fonts/`, then one line in `globals.css` |
| Logo | `AmpereLogo` in `src/components/Brand.tsx` |
| Brand colours | the `@theme` block in `src/app/globals.css` |

No component holds a hex code or names a font. Until the images exist,
`ProductImage` draws an obvious placeholder rather than a broken image.

### Prices

`price_book` is append-only — `effective_from` is part of its primary key, so a
price change is a new row and the old one survives for any order that used it.
"The current price" therefore means the newest row that has already taken
effect; a row dated in the future is a scheduled change and is not charged yet.

Prices are itemised: `amount_total` is the ex-showroom price of the vehicle
(Juspay's `product_price`), `rto_charges` is registration and road tax, and
on-road is the two summed. All arithmetic is `Prisma.Decimal` — never floats.

### Where the catalog lives

The schema stores `model_code` and `colour_code` as bare strings and has no
table to hang a display name or swatch on, so models, colours and region
membership live in `src/lib/catalog/catalog.ts`. Adding a model is a deploy, not
an admin edit. Prices are deliberately **not** there — they belong to
`price_book`, per model per region, resolved server-side.

All seeded dealers, pincodes, regions and prices are placeholders standing in
for open items 2, 4 and 5.

### Links into /buy, and the two switches

| Link | What it does |
|---|---|
| `/buy?model=nexus-ex-plus` | Opens with that scooter chosen. Codes or the main site's page names (`gmax`, `reovyb`, `new-magnus-gmax-iot`, `nexus-ex-plus-intellipack`) |
| `&colour=steel-grey` | …in that colour |
| `&intent=testride` | Preselects the test ride (only matters when Buy Now is on) |
| `?view=variants` | Scooter step shows one card per scooter with Standard / Intellipack tiles. Without it, every version is its own card |

`BUY_NOW_ENABLED=true` brings back the Buy Now branch (price, payment, Juspay).
Off by default: launch is test rides only, and the order route refuses while
it is off. Photos and brochures: `public/models/README.md`, `public/brochures/`.

---

## Local setup

```bash
pnpm install
docker compose up -d                  # Postgres on :5432
cp .env.example .env                  # then fill in the secrets below
pnpm prisma migrate dev --name init
pnpm prisma db seed                   # dealers, pincodes, price book, inventory
pnpm dev
```

The dealer step measures distance from the pincode's centre, which comes from
the `pincode_geo` table. The seed puts placeholder coordinates on its own
pincodes. For real ones, load India Post's All India Pincode Directory
(data.gov.in, CSV):

```bash
pnpm db:import-pincodes path/to/pincodes.csv
```

Two secrets to generate before anything runs:

```bash
openssl rand -base64 32   # PHONE_ENCRYPTION_KEY
openssl rand -base64 32   # PHONE_HMAC_SECRET  (must differ from the above)
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # OTP_HASH_SECRET
```

### Reading the OTP locally

There is no SMS provider yet, so `FakeSmsClient` prints the message to the dev
server console with the number masked:

```
[fake-sms] to +91 ••••• 43210: 694298 is your Ampere verification code...
```

Nothing writes a code or a full number to a log in production.

Run the tests:

```bash
pnpm test          # both projects
pnpm test:watch
```

Two vitest projects. `unit` is pure logic in milliseconds — the Juspay status
resolution. `db` covers anything touching transactions or row locking and runs
against a throwaway Postgres started by Testcontainers, so **Docker must be
running** for it. Files named `*.db.test.ts` land in the second project.

Mocking the locking tests would be worse than not writing them: the behaviour
under test is Postgres' own.

Every db test file shares one container and one process, so each clears the
database with `resetDatabase()` from `test/reset-db.ts` rather than deleting the
tables it happens to know about. That helper deletes children before parents;
add new tables to it in dependency order.

Also available:

```bash
pnpm typecheck     # tsc --noEmit
pnpm lint
pnpm db:studio
pnpm db:reset      # drop, re-migrate, re-seed
```

---

## The two things this repo gets right

### Inventory cannot oversell

Stock is manual — a number per model per region, edited from the admin grid.
The risk is two customers buying the last unit within the same moment.

`reserve()` takes a `SELECT ... FOR UPDATE` row lock inside a transaction. The
second request blocks until the first commits, then re-reads the true count and
correctly fails. This is the main reason the project uses Postgres rather than a
document store.

The lifecycle:

```
customer enters payment  → reserve()      units_reserved + 1, 15-minute hold
payment confirmed        → convert()      units_total - 1, hold consumed
payment failed/abandoned → release()      hold returned to the pool
hold expires             → expireStale()  background job, runs every minute
```

`reserve()` is idempotent by `orderId`, so a retry reuses the existing hold
instead of taking a second unit. `convert()` and `release()` are idempotent too,
because webhooks arrive more than once.

### We never guess whether a payment happened

Juspay's browser return carries `order_id`, `dealer` and `amount` — **the same
three fields on success and on failure**. Nothing in it says which.

So the return is treated as navigation only. It tells us which order to look up,
and nothing else. Truth comes from the webhook, with the status API as a
synchronous reconciler when the customer gets back first.

`resolveOnReturn()` implements that order of authority. `nextStatus()` is the
state machine: **`paid` is terminal** and is never downgraded by a webhook that
arrives late or out of order.

The test file covers the five cases that actually hurt in production:

1. Webhook arrives before the customer returns
2. Customer returns before the webhook lands
3. Webhook never arrives and the status API is down → `unknown`, never a guess
4. Duplicate webhook
5. Out-of-order webhook

All of it runs against `FakeJuspayClient`, so the entire payment flow can be
finished and tested before Juspay credentials exist. Swapping in the real client
is a constructor change.

---

## Deployment — DigitalOcean

### Recommended shape

| Piece | Choice | Why |
|---|---|---|
| App | Droplet, 2 vCPU / 4 GB, Docker | Comfortable headroom at this volume |
| Database | **DO Managed Postgres** | Automated backups, point-in-time recovery, failover. This database holds payment records |
| TLS | Caddy | Automatic certificates, no renewal cron to forget |
| Registry | GitHub Container Registry | Free for private images |
| Redis | **Not in v1** | OTP and rate limiting run fine in Postgres at this volume. One less service to run and secure |

### First deploy

```bash
# 1. DNS: point buy.ampere-electric.com at the droplet IP

# 2. On the droplet
mkdir -p /opt/ampere-buy && cd /opt/ampere-buy
# copy deploy/docker-compose.prod.yml and deploy/Caddyfile here
# create .env from .env.example, then:
chmod 600 .env

# 3. Firewall — only 80/443 reachable
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable

# 4. Restrict the managed database to the droplet in DO's trusted sources

# 5. Start
docker compose -f docker-compose.prod.yml up -d
```

Caddy requests the certificate automatically once DNS resolves.

### Attribution across the subdomain

The page lives on a subdomain, so attribution has to be configured deliberately
or paid-media reporting breaks on day one:

- Set attribution cookies with `Domain=.ampere-electric.com` — the parent, not
  the subdomain. Subdomains of the same registrable domain share these, and
  Safari and Firefox treat it as first-party.
- Use the **same Meta Pixel ID** on both sites so `_fbp` and `_fbc` carry across.
  Creating a new pixel resets the learning phase.
- GA4: `cookie_domain: 'ampere-electric.com'`, and add the subdomain to referral
  exclusions so you do not log self-referrals.
- Keep passing `utm`, `gclid` and `fbclid` in the URL as a backstop.

The app's own session cookie is scoped to the subdomain only, `HttpOnly`,
`Secure`, `SameSite=Lax`.

---

## Build order

Numbered by dependency. Items 1–8 need nothing from Juspay, the dealer network
or anyone else.

1. Prisma schema and migrations — **done, in this repo**
2. Seed data: dealers, pincode→region map, price book, inventory — **done**
3. Idempotency helper for all mutating routes — **done**
4. `/buy` page shell, prefill parsing, the step machine — **done**
5. Lead capture with save-before-OTP, plus consent recorded at step one — **done**
6. OTP against a fake SMS provider — **done**
7. **Inventory** — reservation and availability wired in; still needs the admin
   grid and the expiry job scheduled
8. **Payment status resolution** — done here; still needs the order route and webhook handler
9. EMI widget with a configurable rate table
10. Test ride journey and dealer notification — **done**

Blocked on Juspay: real client, webhook signature verification, live EMI plans.
Juspay's own integration doc and what it changes: `docs/juspay/`. Read the notes
before touching the payment flow — it is auth-and-capture, not a simple redirect.
Blocked on dealer data: real dealer resolution.
Blocked on a decision: the partial payment amount — the mechanism is built regardless.

---

## Things not to break

- **Amounts are computed server-side** from `price_book`. The client sends
  selections, never money.
- **Phone numbers are encrypted at rest** with an HMAC index for lookup. Never
  in logs, Sentry, or analytics.
- **`paid` is terminal.** No webhook downgrades it.
- **The return URL is navigation only.** Never read the amount from the query
  string to render a confirmation — those parameters are attacker-controlled.
- **Consent is captured at step one**, under the phone field, with two separate
  purposes. Storing an unverified number is fine; contacting that person later
  is what needs consent.
