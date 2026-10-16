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

### Seed data

Dealers, pincodes and prices are placeholders until the real data arrives.

```bash
docker compose -f docker-compose.prod.yml run --rm app node_modules/.bin/prisma db seed
```

---

## Scheduled work — do not skip this

Stock holds do not expire on their own. Every abandoned checkout keeps a unit
out of sale until something releases it, and during UAT that is enough to make
the whole catalogue read "out of stock" by lunchtime.

Add to root's crontab (`sudo crontab -e`), using the `CRON_SECRET` from your
env file:

```cron
* * * * * curl -fsS -X POST https://buy.ampere-electric.com/api/cron/expire-reservations -H "Authorization: Bearer YOUR_CRON_SECRET" >/dev/null 2>&1
```

Every minute. The endpoint is idempotent and cheap when there is nothing to do.

---

## UAT vs production

Only these differ:

| | UAT | Production |
|---|---|---|
| `APP_ENV` | `uat` | `production` |
| `OTP_ECHO_ENABLED` | `true` — codes shown on screen | unset |
| `JUSPAY_BASE_URL` | `https://sandbox.juspay.in` | `https://api.juspay.in` |
| `JUSPAY_ENABLED` | `true` once sandbox keys work | `true` |

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
