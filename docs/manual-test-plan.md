# Manual test plan

Everything runs on placeholder data. Where a test depends on something not yet
supplied — the real booking amount, Legal's cancellation text, Juspay
credentials — it says so.

## Setup

```bash
docker compose up -d          # Postgres
pnpm dev                      # keep this terminal visible — OTP codes print here
```

Open **http://localhost:3000/buy?model=nexus-ex-plus&colour=carbon-knight&src=product_hero**

Reset to a clean slate at any point:

```bash
docker compose exec postgres psql -U ampere -d ampere_buy -c "
DELETE FROM payment_events; DELETE FROM orders; DELETE FROM inventory_reservations;
DELETE FROM test_ride_bookings; DELETE FROM consents; DELETE FROM otp_attempts;
DELETE FROM rate_limits; DELETE FROM idempotency_records; DELETE FROM leads;
UPDATE inventory SET units_total=15, units_reserved=0;"
```

Browser cookies hold your lead between steps. **Use a fresh incognito window**
for each full run, or clear cookies for localhost.

---

## 1. Entry points and prefill

| # | Do this | Expect |
|---|---|---|
| 1.1 | Open `/buy?model=nexus-ex-plus&colour=carbon-knight` | Nexus EX+ in Carbon Knight on first paint |
| 1.2 | Open `/buy` with no parameters | Complete working page, nothing preselected |
| 1.3 | Open `/buy?model=foo&intent=steal` | Normal page. **Not** an error. Check the dev terminal for `ignored invalid prefill parameters` |
| 1.4 | Open `/buy?model=nexus-ex-plus&colour=ocean-blue` | Nexus EX+ shown, colour ignored — Ocean Blue is a Magnus Neo colour |
| 1.5 | Open `/buy?model=reo-vyb&colour=purple` | Reo VYB, Pastel Purple |
| 1.6 | View source (Ctrl+U) on 1.1 | Scooter `<img>` and model name present in the HTML — rendered server-side, not by JavaScript |

---

## 2. Identity — the save-before-OTP rule

**This is the single most important behaviour in the build.**

| # | Do this | Expect |
|---|---|---|
| 2.1 | Submit with an empty form | Three field errors plus the consent error. Nothing saved |
| 2.2 | Enter name, phone `9876500011`, pincode `400101`, leave consent unticked | Error on the consent box. Still nothing saved |
| 2.3 | Tick the required consent, press Continue | Moves to the OTP field |
| 2.4 | **Now check the database** (query below) | A row exists with `phone_verified = f` |
| 2.5 | Enter phone as `98765 00011` (with a space) | Accepted — normalised to +919876500011 |
| 2.6 | Enter phone `1234567890` | Rejected — Indian mobiles start 6–9 |
| 2.7 | Type pincode `400101`, wait a moment | "Nearest dealer: Ampere Andheri West" appears under the field |

```bash
docker compose exec postgres psql -U ampere -d ampere_buy -c \
  "SELECT name, phone_verified, phone_last4, pincode, region_code, dealer_code FROM leads;"
```

**2.4 is the test that matters.** The lead exists before the OTP is verified. A
customer who closes the tab right now is still a lead the dealer can call.

Prove the number is not stored in plaintext:

```bash
docker compose exec postgres psql -U ampere -d ampere_buy -c \
  "SELECT count(*) AS plaintext_leaks FROM leads WHERE leads::text LIKE '%9876500011%';"
```

Expect `0`.

---

## 3. OTP

The code prints in your `pnpm dev` terminal:

```
[fake-sms] to +91 ••••• 00011: 123456 is your Ampere verification code...
```

| # | Do this | Expect |
|---|---|---|
| 3.1 | Enter a wrong code | "That code is not correct. 4 tries left." |
| 3.2 | Get it wrong 5 times total | Locked out. Even the right code is refused |
| 3.3 | Press **Resend OTP** immediately | "Resend 60s" — the button is locked. **No second SMS in the terminal** |
| 3.4 | Wait for the countdown, then resend | A new code appears in the terminal |
| 3.5 | Enter the correct code | Your details collapse to a summary with a green **VERIFIED** badge |
| 3.6 | Check the database | `phone_verified` is now `t`, and still **one** row — not two |

3.3 is the SMS-bill protection. Without it, this endpoint gets farmed.

---

## 4. Scooter picker

| # | Do this | Expect |
|---|---|---|
| 4.1 | Click **MAGNUS** | Three variants: New Magnus GMax, Magnus GMax, Magnus Neo |
| 4.2 | Click a variant | Card outlines dark; price, EMI line, three specs and the green offers strip |
| 4.3 | Click a colour swatch | The scooter on the left changes |
| 4.4 | Click the carousel arrows | Steps through colours — same as the swatches |
| 4.5 | Click the expand icon (bottom-right of the image) | Full-screen view. Escape closes it |
| 4.6 | Click **REO** | Reo VYB, four colours |
| 4.7 | Watch the sticky bottom bar | Price and "EMIs start at" update with the selection |

---

## 5. Test ride journey

| # | Do this | Expect |
|---|---|---|
| 5.1 | Choose **Book a test ride** | Buy now greys out with a reason. It is **not** removed |
| 5.2 | Pick HOME | If your dealer doesn't do home rides, a warning appears |
| 5.3 | Look at today's date chip | Slots already past are greyed. Late in the day, today is greyed entirely |
| 5.4 | Pick a date and a slot | Both highlight blue |
| 5.5 | Tick **Financing** | The EMI widget opens automatically |
| 5.6 | In the widget: drag the down payment, change tenure | Monthly and **Total amount payable** both update |
| 5.7 | Press **Book a test ride** | Confirmation with dealer name, address and phone |
| 5.8 | Check the dev terminal | `[fake-dealer] Ampere Andheri West: test ride for …` |
| 5.9 | Check inventory | **Unchanged.** Test rides use demo stock, not sale stock |

```bash
docker compose exec postgres psql -U ampere -d ampere_buy -c \
  "SELECT mode, slot_date, slot_window, help_topic, status FROM test_ride_bookings;"
docker compose exec postgres psql -U ampere -d ampere_buy -c \
  "SELECT units_total, units_reserved FROM inventory WHERE model_code='nexus-ex-plus' AND region_code='west';"
```

5.6 is worth a look: the longest tenure has the **lowest monthly and the
highest total**. Most sites show only the first half of that.

---

## 6. Buy journey — all three payment types

From the confirmation, press **Book your … now**, or start again and choose
**Buy now**.

### 6a. Partial (book with a deposit)

| # | Do this | Expect |
|---|---|---|
| 6.1 | Select **Book with a deposit** | ₹5,000, with the balance shown |
| 6.2 | Leave terms unticked | Pay button disabled |
| 6.3 | Tick terms, press Pay | Lands on the stand-in checkout showing **Payable now ₹5,000** |
| 6.4 | Press **Pay successfully** | Confirmation: order number, amount, dealer |
| 6.5 | Check inventory | `units_total` **14**, `units_reserved` **0** — the hold became a sale |

### 6b. Full payment

| # | Do this | Expect |
|---|---|---|
| 6.6 | Start again, choose **Pay in full** | Payable now = the **on-road** price (~₹1,44,648), not ex-showroom |
| 6.7 | Press **Payment fails** | Retry screen. "Nothing has been charged" |
| 6.8 | Check inventory | Back to **15 / 0** — the unit was released |
| 6.9 | Press **Try again** | Same checkout, **same order number** |

### 6c. EMI

| # | Do this | Expect |
|---|---|---|
| 6.10 | Choose **Pay by EMI** | The EMI widget opens; payable = on-road price |
| 6.11 | Press **Return without a webhook** | **"Confirming your payment"** first, then it resolves |

6.11 is the one to show your manager. Juspay sent nothing — the page asked
their servers directly. Spec §9's reconciler path, working.

```bash
docker compose exec postgres psql -U ampere -d ampere_buy -c \
  "SELECT order_id, payment_type, status, status_source, amount_total, amount_charged FROM orders ORDER BY created_at;"
```

`status_source` should read `webhook` for 6a/6b and `status_api` for 6c.

---

## 7. The rules that must not break

| # | Do this | Expect |
|---|---|---|
| 7.1 | After a successful payment, replay the webhook (command below) | Status stays `paid`. Stock does **not** decrement again |
| 7.2 | Send a `pending` webhook for a paid order | Still `paid`. **`paid` is terminal** |
| 7.3 | Send a webhook with a bad signature | Order unchanged. Row still logged in `payment_events` |

```bash
ORDER=<paste a paid order id>

# 7.1 and 7.2 — replay and downgrade attempts
curl -s -X POST http://localhost:3000/api/webhooks/juspay \
  -H 'Content-Type: application/json' -H 'x-juspay-signature: valid-signature' \
  -d "{\"content\":{\"order\":{\"order_id\":\"$ORDER\",\"status\":\"CHARGED\"}}}"
curl -s -X POST http://localhost:3000/api/webhooks/juspay \
  -H 'Content-Type: application/json' -H 'x-juspay-signature: valid-signature' \
  -d "{\"content\":{\"order\":{\"order_id\":\"$ORDER\",\"status\":\"PENDING\"}}}"

# 7.3 — forged signature
curl -s -X POST http://localhost:3000/api/webhooks/juspay \
  -H 'Content-Type: application/json' -H 'x-juspay-signature: forged' \
  -d "{\"content\":{\"order\":{\"order_id\":\"$ORDER\",\"status\":\"AUTHORIZATION_FAILED\"}}}"

docker compose exec postgres psql -U ampere -d ampere_buy -c \
  "SELECT status, status_source FROM orders WHERE order_id='$ORDER';"
docker compose exec postgres psql -U ampere -d ampere_buy -c \
  "SELECT event_type, signature_valid FROM payment_events WHERE order_id='$ORDER';"
```

---

## 8. Where the data lives

```bash
docker compose exec postgres psql -U ampere -d ampere_buy -c "
SELECT 'leads' AS t, count(*) FROM leads
UNION ALL SELECT 'consents', count(*) FROM consents
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'payment_events', count(*) FROM payment_events
UNION ALL SELECT 'test_ride_bookings', count(*) FROM test_ride_bookings
UNION ALL SELECT 'otp_attempts', count(*) FROM otp_attempts
ORDER BY 1;"
```

Consent is append-only — tick marketing, save, then untick and save again, and
both answers survive:

```bash
docker compose exec postgres psql -U ampere -d ampere_buy -c \
  "SELECT purpose, granted, notice_version, granted_at FROM consents ORDER BY granted_at;"
```

---

## 9. Lead export for the call centre

```bash
# Refused without the password
curl -i http://localhost:3000/api/admin/leads

# Verified leads only
curl -H 'Authorization: Bearer ampere-demo' \
  "http://localhost:3000/api/admin/leads?segment=verified"

# CSV, ready for the call centre
curl -H 'Authorization: Bearer ampere-demo' \
  "http://localhost:3000/api/admin/leads?segment=verified&format=csv" -o leads.csv
```

Verified and unverified come back as separate segments, deliberately — §5 says
mixing them costs the team's faith in the list after a run of dead numbers.

**The Google Sheet is not wired up.** `toSheetValues()` is written and ready; it
needs a service-account credential and Legal's sign-off, because that export
carries full phone numbers in plaintext and a Sheet is shareable by link.

---

## 10. Edge cases

| # | Do this | Expect |
|---|---|---|
| 10.1 | Pincode `110001` (Delhi) | North region, different dealer, different price |
| 10.2 | Pincode `560001` (Bengaluru) | South region |
| 10.3 | Pincode `999999` | Zone 9 is Army Postal — no region, no sale, but the lead still saves |
| 10.4 | Set a model to zero stock (below), reload | "In short supply" — buying still allowed, because it is a booking amount |
| 10.5 | Resize the browser to phone width | Single column, product on top, sticky bar intact |
| 10.6 | Submit the form, then reload mid-journey | You resume — the cookie remembers your lead |

```bash
# 10.4
docker compose exec postgres psql -U ampere -d ampere_buy -c \
  "UPDATE inventory SET units_total=0 WHERE model_code='nexus-ex-plus' AND region_code='west';"
# put it back
docker compose exec postgres psql -U ampere -d ampere_buy -c \
  "UPDATE inventory SET units_total=15 WHERE model_code='nexus-ex-plus' AND region_code='west';"
```

---

## Known gaps — these are expected to be incomplete

| What | Why | Who |
|---|---|---|
| Booking amount is ₹5,000 | Placeholder. Flat vs percentage undecided | Ampere + Sales |
| Cancellation policy text missing | Shows a note instead | Legal |
| Add-ons section is a placeholder | No list supplied | Ampere |
| "Schedule a call" field not built | In the Figma, not in the flow doc. Needs a decision | Ampere |
| Stand-in checkout instead of Juspay | No credentials, no webhook signature scheme | Juspay |
| Dealer data is 8 placeholder dealers | Real master not supplied | Dealer ops |
| Prices are published ex-showroom; RTO is a flat 10% | Real per-state figures not supplied | Finance |
| Google Sheet sync | Export built, sync needs credentials and sign-off | Legal + Ampere |

---

## Reporting a failure

For anything that misbehaves, send:

1. Which numbered step
2. What you expected, what happened
3. The last 20 lines of the `pnpm dev` terminal
4. A screenshot if it is visual
