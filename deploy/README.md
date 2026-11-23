# Deploying Ampere /buy to the droplet

Target: `buy.ampere-electric.com`, a DigitalOcean droplet, separate from the
marketing site.

Four containers: Caddy (TLS), the Next app, Postgres, and a one-shot migrator
that must finish before the app starts.

---

## Read this first — the quoting trap

`.env` locally is read by **dotenv**, which strips surrounding quotes.
`deploy/.env.production` is read by **Docker**, which does not.

```
JUSPAY_ENABLED="true"     ->  Docker gives the app  '"true"'
                          ->  the  === 'true'  check fails
                          ->  the real payment client never loads
                          ->  the site takes no money, and says nothing
```

The same trap turns bot defence on with a junk secret and blocks every OTP.

So: **no quotes in `deploy/.env.production`.** The app checks for this at
startup and refuses to boot, naming the offending variables — see
`src/instrumentation.ts`. If it will not start, read the error; it is almost
always this.

---

## One-time setup on the droplet

Ubuntu 24.04, 2 vCPU / 4 GB is comfortable. 2 GB works but builds are slow —
build elsewhere and push an image if you are on the small droplet.

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 2. Firewall. Only 80, 443 and SSH. Postgres is NOT published — it is
#    reachable only inside the compose network, and it must stay that way.
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443
sudo ufw --force enable

# 3. Code
git clone https://github.com/techhowl/Ampere-booking-model.git /opt/ampere-buy
cd /opt/ampere-buy

# 4. Configuration
cp deploy/.env.production.example deploy/.env.production
openssl rand -base64 32   # x4, one each for the crypto keys
openssl rand -hex 32      # the Juspay webhook password, and CRON_SECRET
nano deploy/.env.production
```

**DNS must point at the droplet before you start Caddy.** It requests a
certificate on boot, and Let's Encrypt rate-limits failures.

```bash
dig +short buy.ampere-electric.com   # must be the droplet's IP
```

---

## Deploy

```bash
cd /opt/ampere-buy
git pull
docker compose -f docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```

Compose waits for Postgres to be healthy, runs `prisma migrate deploy` to
completion, and only then starts the app.

Verify:

```bash
curl -s https://buy.ampere-electric.com/api/health
# {"status":"ok","database":"up",...}

docker compose -f docker-compose.prod.yml logs app | grep '\[startup\]'
# [startup] APP_ENV=uat juspay=fake otpEcho=ON
```

That startup line is worth reading every deploy. It says in one place which
environment this is, whether real payments are on, and whether OTP codes are
being shown on screen.

### Seed data and one-off commands

The app image is a trimmed standalone server: no `tsx`, no `scripts/`. One-off
commands (seed, pincode import, `pnpm crm …`) run in the **`tools`** service
instead, which is the image's build stage with the same environment. It never
starts with `up`; only with `run`:

```bash
alias tools='docker compose -f docker-compose.prod.yml --env-file deploy/.env.production run --rm tools'

tools pnpm db:seed                                                  # regions, prices, placeholder dealers
tools pnpm db:import-pincodes deploy/data/pincode-geo.csv --as-is   # 18,668 pincode locations
tools pnpm crm sync-models                                          # Greaves' get_products -> vehicle ids
tools pnpm crm sync-dealers --dry-run                               # read first...
tools pnpm crm sync-dealers                                         # ...then Greaves' get_dealers -> dealers
tools pnpm crm status                                               # every pilot dealer should say "offered"
```

Re-run `sync-dealers` whenever Greaves add or change dealers. It retires our
placeholder dealers on the first run.

---

## Production go-live: the Zoho pilot (23 November 2026)

What changes on the live site, all of it configuration in
`deploy/.env.production`:

| Setting | Value | Effect |
|---|---|---|
| `APP_ENV` | `production` | |
| `CRM_PROVIDER` + `ZOHO_*` | `zoho`, `https://www.zohoapis.in`, live credentials | Leads and test rides go to Greaves' **live** CRM |
| `OTP_REQUIRED` | `false` | No OTP until the SMS sender clears DLT. Leads go to the CRM unverified; Greaves' call centre qualifies them |
| `PILOT_DEALER_CRM_IDS` | the 11 pilot dealers' CRM ids | Only they are offered |
| `GOAL_APP_URL` | `https://enquiry.ampere-electric.com/testride` | `/buy` opens with a pincode popup. A pincode no pilot dealer serves (within 15 km) is redirected straight to Goal App, before the customer gives any details, so nothing of theirs is saved here or sent to Zoho |

A lead that stops before choosing a dealer goes to Zoho after 30 minutes with
the nearest pilot dealer on it, never with none: sent without a dealer, the CRM
would pick one by pincode, possibly a dealer still on Goal App.

**Order of work, first time:**

1. DNS: an A record for `buy.ampere-electric.com` → the droplet's IP. Leave
   `enquiry.ampere-electric.com` alone: it is Goal App, and customers outside
   the pilot are sent there.
2. On the droplet: clone, copy `deploy/.env.production` (from the team's
   password manager, `chmod 600`), and copy `deploy/data/pincode-geo.csv` if
   it is not committed.
3. `docker compose … up -d --build`, then the `tools` commands above, in order.
4. `pnpm crm status`: 11 of 11 pilot dealers "offered", no vehicle model
   without a CRM id.
5. The startup line should read
   `APP_ENV=production … crm=zoho-LIVE otp=OFF dealers=pilot(11) goalApp=set`.
6. The crontab below (the CRM sync matters: it sends held leads).
7. Check by hand at `https://buy.ampere-electric.com/buy`: the pincode popup
   opens; a pilot pincode (110051, 560103) opens the booking form with it
   filled in; a non-pilot one (400053) lands on the Goal App form.
8. Then point the main site's "Book a test ride" at
   `https://buy.ampere-electric.com/buy` (with `?model=` from product pages).
   Rolling back is pointing it at Goal App again.

How the pilot is going, from the app's log (counts only, no customer data):

```bash
docker compose -f docker-compose.prod.yml logs app | grep -c '\[gate\] sent to goal app'
docker compose -f docker-compose.prod.yml logs app | grep -c '\[gate\] pilot dealer'
```

Do **not** make a test booking with a real-looking name: the CRM is live, and
it reaches a real dealer. Tell Greaves before any test, and use a name they can
recognise and delete.

**Big-bang release (1 December):** remove `PILOT_DEALER_CRM_IDS` (every dealer
offered, and the pincode popup goes) and, if Goal App is retired,
`GOAL_APP_URL`; then restart the app.
Turn the OTP back on (`OTP_REQUIRED` unset) only once an SMS provider is wired
in and DLT has cleared, or nobody can get past step one.

---

## Scheduled work — do not skip this

Stock holds do not expire on their own. Every abandoned checkout keeps a unit
out of sale until something releases it, and during UAT that is enough to make
the whole catalogue read "out of stock" by lunchtime.

Put the `CRON_SECRET` from your env file in a file only root can read, so it
never appears on a command line (where any user on the droplet could see it
in the process list):

```bash
# Paste the secret when it waits for input, then press Enter. Reading it this
# way keeps it out of shell history too.
sudo sh -c 'umask 077; read -r s; printf "Authorization: Bearer %s\n" "$s" > /root/.ampere-cron-auth'
```

Then add to root's crontab (`sudo crontab -e`). `-H @file` reads the header
from that file:

```cron
* * * * * curl -fsS -X POST https://buy.ampere-electric.com/api/cron/expire-reservations -H @/root/.ampere-cron-auth >/dev/null 2>&1
* * * * * curl -fsS -X POST https://buy.ampere-electric.com/api/cron/crm-sync -H @/root/.ampere-cron-auth >/dev/null 2>&1
```

Every minute. Both endpoints are idempotent and cheap when there is nothing to
do. The second retries anything Greaves' CRM did not take first time, and
queues any lead or booking that never got a job — without it, a CRM outage
leaves leads waiting until the next customer happens along.

---

## UAT vs production

Only these differ:

| | UAT | Production |
|---|---|---|
| `APP_ENV` | `uat` | `production` |
| `OTP_ECHO_ENABLED` | `true` — codes shown on screen | unset |
| `JUSPAY_BASE_URL` | `https://sandbox.juspay.in` | `https://api.juspay.in` |
| `JUSPAY_ENABLED` | `true` once sandbox keys work | `true` |
| `ZOHO_API_URL` | `https://sandbox.zohoapis.in`, sandbox credentials | `https://www.zohoapis.in`, live credentials |
| `OTP_REQUIRED` | unset (OTP on, code echoed) | `false` during the pilot |
| `PILOT_DEALER_CRM_IDS` | unset, or sandbox ids | the live pilot ids |

The app refuses to start if `OTP_ECHO_ENABLED` is set while `APP_ENV` is
`production`, so the dangerous combination cannot be deployed by accident.

---

## Juspay

Juspay needs to reach the webhook and the return URL over **HTTPS**, which is
the whole reason Caddy is in the stack. Once the droplet is up:

1. Dashboard → Payments → Settings → Webhook
   - URL: `https://buy.ampere-electric.com/api/webhooks/juspay`
   - Username and password: the same values as `JUSPAY_WEBHOOK_USERNAME` and
     `JUSPAY_WEBHOOK_PASSWORD` in the env file. Juspay authenticates webhooks
     with Basic auth, not a signature.
2. Set `JUSPAY_ENABLED=true` and redeploy.
3. Confirm with the startup line: `juspay=REAL`.

Before that, test credentials from your own machine:

```bash
pnpm juspay:smoke
```

---

## Backups

Nothing backs the database up yet, and it holds every lead.

```bash
# Nightly dump, 14 days retained. Adjust the path to taste.
0 2 * * * docker exec $(docker ps -qf name=postgres) pg_dump -U ampere ampere_buy | gzip > /var/backups/ampere-$(date +\%F).sql.gz
0 3 * * * find /var/backups -name 'ampere-*.sql.gz' -mtime +14 -delete
```

Phone numbers are encrypted at rest, so a dump is useless without
`PHONE_ENCRYPTION_KEY`. **Store that key somewhere other than the droplet.** A
backup and its key in the same place is one compromise, not two.

---

## Rollback

```bash
git log --oneline -5
git checkout <previous-sha>
docker compose -f docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```

Migrations are not rolled back automatically. Every migration so far is
additive, so an older image runs against a newer schema; do not assume that
holds for future ones.

---

## Troubleshooting

**App will not start, error names environment variables.** Quotes. See the top
of this file.

**Caddy cannot get a certificate.** DNS is not pointing here yet, or port 80 is
blocked. `docker compose -f docker-compose.prod.yml logs caddy`.

**Every OTP returns "complete the security check".** `TURNSTILE_SECRET` is set
to something non-empty — including an empty string *in quotes*. Leave it truly
empty until Cloudflare keys arrive.

**Payments do nothing / no money arrives.** Check the startup line says
`juspay=REAL`. If it says `fake`, `JUSPAY_ENABLED` is not exactly `true`.

**Everything is out of stock.** The cron job is not running. Check it exists
and that `CRON_SECRET` matches.
