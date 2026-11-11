# Greaves CRM.Next — integration notes

Greaves' CRM ("GEM DMS", "CRM.Next") is **Zoho CRM on the India data centre**.
Every verified lead and every booked test ride from `/buy` is delivered to it.

Source material from Greaves (kept out of git — the collection carries the
client secret): `Greaves CRM.Next -Website Lead APIs.pdf` and the Postman
collection `Sandbox - Lead Creation API Collection for Website.json`.

Everything below marked *observed* was tested against the sandbox on
2026-11-02, and again on 2026-11-03 after Greaves' changes. Where the PDF and
the sandbox disagree, the code follows the sandbox.

## How it works

```
OTP verified ───► crm_jobs row (lead), held 30 minutes for the booking ─► sent then if no booking came
Test ride booked ► crm_jobs row (ride) ─► after() sends Create Lead, then the ride on that lead
                                             │
                                             ├─ accepted ─► ids saved on leads / test_ride_bookings
                                             ├─ CRM said no / unreachable ─► retry: 1, 5, 15, 30 min … ≈3 days
                                             └─ still failing ─► "dead" — pnpm crm status / requeue
/api/cron/crm-sync (every minute on the droplet):
   reconcile (anything verified/booked with no job) + send whatever is due
```

- `src/lib/crm/payload.ts`: our data → Greaves' exact fields and formats.
- `src/lib/crm/zoho.ts`: the HTTP client: token, function calls, look-ups.
- `src/lib/crm/token-store.ts`: one access token shared by every instance, held in Postgres.
- `src/lib/crm/jobs.ts`: the queue: claim, send, retry, recover, reconcile.
- `src/lib/crm/fake.ts`: the CRM in memory, built to behave the way the sandbox did.
- `src/lib/crm/config.ts`: environment rules (sandbox only outside production).

**Unverified numbers are never sent.** The CRM has no "verified" flag, so a
dealer would ring numbers that may be typos or someone else's. They stay in
our own lead list (spec 5) and in the export.

**The lead goes with the booking, not at the OTP.** The customer chooses their
dealer, scooter, colour and help topics after the OTP, and the CRM takes those
only from Create Lead. A test ride on an existing lead keeps its dealer on the
ride and leaves the lead as it was (seen 5 Nov: dealer, colour, topics and a
changed pincode all stayed as first sent). So the ride job sends Create Lead
first, with all of them, then the ride with the lead's id. That also keeps us
off the path where a ride makes the lead, which fails for a new number sent
with a dealer. Someone who stops before booking goes after `LEAD_HOLD_MS` (30
minutes), with whatever they had chosen: the dealer step saves the dealer and
the scooter on the lead for this.

**Only a customer the CRM already has keeps their old dealer on the lead.** A
returning customer, or one who stopped for more than 30 minutes and came back,
already has a lead, and Create Lead answers "Duplicate". The new choice is on
the test ride, correctly, but we have no way to change the lead. Only Greaves
can: their test ride function would have to update the lead.

## The API, as observed

| | |
|---|---|
| Token | `POST https://accounts.zoho.in/oauth/v2/token`, refresh-token grant. Lasts 3600 s. Greaves: reuse ~55 min, minting is rate-limited. We send the secret in the **form body**, not the URL as in Postman. |
| Create Lead | `POST {api}/crm/v7/functions/leadcreation_for_ampere_website/actions/execute?auth_type=oauth` |
| Create Test Ride | `POST {api}/crm/v7/functions/test_ride_creation_for_ampere_website/actions/execute?auth_type=oauth` |
| Body | `{"data":[{…one record…}]}`, `Authorization: Bearer <token>` |
| Sandbox API | `https://sandbox.zohoapis.in`. Production host comes with go-live approval. |

**HTTP 200 does not mean success.** Every business answer is a 200, with the
real result as a JSON *string* in `details.output`:

```json
{"code":"success","details":{"output":"{\"status\":\"failure\",\"category\":\"rule_failure\",\"message\":\"Duplicate Lead: Lead already exists in the system\"}","output_type":"string","id":"…"},"message":"function executed successfully"}
```

Only a bad token is a status code: 401 `INVALID_TOKEN`.

**Ids are 19 digits** (`1456765000001702028`), beyond what a JavaScript number
holds exactly. They are always sent and stored as strings, and read out of the
raw response text. The sandbox accepts string ids.

### Observed behaviour

| Case | What the sandbox did |
|---|---|
| New lead | `Lead created successfully` + `lead_id` |
| Same mobile again (90 days) | `rule_failure: Duplicate Lead: Active Lead already exists in the system` + **`Existing_lead_id`** (since 3 Nov; before, no id). Matched with or without `+91`. Greaves: a note is added to the existing lead. We keep the id. |
| Create Lead for a customer whose lead a test ride made | Duplicate, as above (3 Nov; on 2 Nov it made a second lead) |
| Test ride, existing `Zoho_CRM_Lead_ID` | `Test Ride created and mapped to the existing Lead` (3 Nov wording; was `Existing Lead updated and Test Ride created`) |
| Test ride, known mobile, no lead id | `Duplicate Lead already exists. Test Ride created and mapped to the existing active Lead` |
| Test ride, new mobile, no dealer, served pincode | `New Lead and Test Ride created`; the CRM picks the dealer |
| **Test ride, new mobile, WITH a dealer** | **`api_failure: Lead creation failed`, every time (3 and 5 Nov).** On 5 Nov the answer names `Preferred_Aggregator_Dealer`, `INVALID_DATA`. Worked on 2 Nov. We always send the lead first, so we never take this path. |
| Test ride with a lead id the CRM does not have | Since 5 Nov the id is ignored and the mobile decides: known number maps to its lead, new number makes one, or fails as above if a dealer was sent. We read that failure as "lead gone", make the lead again and resend. Before 5 Nov: `Provided Zoho CRM Lead ID is not available`. |
| Customer pincode not in the CRM's master | **Accepted since 5 Nov** (refused until then). Greaves' fallback adds any 6-digit number to `Postal_Codes`, with an empty city, so we refuse `9xxxxx` on the form. Greaves say production does the same. |
| No dealer sent, pincode with no dealer mapped | Lead created with `Preferred_Aggregator_Dealer` empty, and `remarks: No active dealer found…` (5 Nov) |
| Unknown `Zoho_CRM_Lead_ID` | `rule_failure: Provided Zoho CRM Lead ID is not available` → we drop the id and resend |
| **Same test ride sent twice** | **Two test rides.** No idempotency. See "Retries" below. |
| Time slot `01:00 PM - 03:00 PM`, `1:00 PM - 3:00 PM`, `1:00 PM – 3:00 PM` | All stored 13:00 IST. `Time_Slot` is stored verbatim, so the page itself uses Greaves' `hh:mm AM - hh:mm PM`. |
| Date not `dd/MM/yyyy` | `Mandatory fields are missing` (misleading) |
| Vehicle missing on a test ride | `Mandatory fields are missing` |
| **Suspended dealer** (e.g. "Asha Ampere", the PDF's own example) | `api_failure: Lead creation failed due to technical reasons` |
| No dealer, pincode with no active dealer | 2 Nov: crashed at line 446. 3 Nov: no crash, but refused as above, and `userMessage` still carries the debug log. |
| No dealer, served pincode | CRM assigns the dealer itself (debug log still in `userMessage`) |
| The PDF's sample ids (`1441684…`) | Not valid in this sandbox (ids there start `1456765…`) |
| Dealer sent on a test ride | **Stored in `Dealer_Name` since 5 Nov**; correct in every test. `Branch` stays empty. The ride has no field for colour or help topics. |
| Dealer sent on Create Lead | Stored as `Preferred_Aggregator_Dealer` (a bare id). An unknown id falls back to the CRM's default for the pincode. Greaves assign the lead once they qualify it; until then its `Dealer` field is empty. |
| `Is_There_Anything_We_Can_Help_You_With?` | A picklist. `Brochure` saves correctly on Create Lead (read back 5 Nov). A direct read of Leads is refused (`OAUTH_SCOPE_MISMATCH`), but COQL can read them. |
| Date on a test ride | Sent as `Test_Ride_Date_Time`. Stored in **`Scheduled_Date_Time`** since 5 Nov; the old field is empty on new rides and still holds the date on older ones. |
| Latency | 0.4–4 s typically, one call took 16 s. Hence background sending. |

## Field mapping

| Greaves field | From |
|---|---|
| `Name` | lead name |
| `Phone` | decrypted in memory, `+91XXXXXXXXXX` |
| `Pincode` | lead pincode |
| `Vehicle_Model_Interested` | `crm_vehicle_models.crm_id` for the model |
| `Colour_Preference` | colour display name, e.g. "Matcha Green" (the test ride call ignores it) |
| `Dealer_Name` / `Dealer_ID` | the chosen dealer; `dealers.crm_id` |
| `Is_There_Anything_We_Can_Help_You_With?` | ticked topics: `Offers`, `Brochure` (comma, no spaces) |
| `utm_source` … `utm_term` | from the ad link |
| `utm_layout` | the ad's, else `buy_list` / `buy_variants`: which layout the customer saw |
| `Website_Lead_ID` | our lead UUID |
| `Test_Ride_Location` | `Dealer` (`Home` if home rides return) |
| `Test_Ride_Date_Time` | `dd/MM/yyyy` |
| `Time_Slot` | the slot exactly as the page shows it: `10:00 AM - 12:00 PM`, `01:00 PM - 03:00 PM`, `03:00 PM - 05:00 PM`, `05:00 PM - 08:00 PM` |
| `Zoho_CRM_Lead_ID` | the CRM lead id we hold, else empty |

Ids differ between sandbox and production, so they are **data, not code**:
`crm_vehicle_models` (filled by `pnpm crm sync-models`, which reads the CRM's
own `Vehicle_Models`) and `dealers` (filled by `pnpm crm sync-dealers`, below;
`pnpm crm link-dealer` for one-offs). The seed fills both with **sandbox** ids.

## The dealer master

Greaves' `get_dealers` function (GET, no arguments; `ZOHO_DEALERS_FUNCTION`
to rename it) lists every active dealer: `dealer_name`, `dealer_id`, `city`,
`state`, `pincode`. Nothing else yet: no street address, phone or
coordinates. On 3 Nov the sandbox listed 441 dealers in 26 states.

`pnpm crm sync-dealers [--dry-run]` (`src/lib/crm/dealers.ts`) makes our
`dealers` table match it:

- each dealer is created or updated as `GEM-<dealer_id>`, active
- its location is its pincode's centre from `pincode_geo`, good to a couple of
  km. 14 of the sandbox's 432 dealer pincodes have no location (India Post's
  own data for them is wrong or missing); those dealers are listed by the sync
  and no radius search finds them until they get a location
- the card shows "City, State PIN" until Greaves send an address, and our
  customer-care number until they send a phone. A sync never clears a phone
  or home-ride flag we set ourselves
- every other dealer, placeholders included, is retired (`active = false`),
  never deleted. A list that would retire more than half the CRM dealers we
  hold is refused as broken unless `--force`; so is a list that says it holds
  more dealers than it sent

Two pairs look like the same showroom entered twice (`JAI SHRI RAM MOTORS` and
`Jai Shri Ram Motors` at 642126; `SANDIP ENTERPRISES` and `SANDEEP ENTERPRISE`
at 736101). Both show as they are; raised with Greaves.

## Retries, and why a test ride is never sent twice blindly

The CRM has no idempotency, so a retry after a timeout could create a second
test ride. Before a test ride is sent, its job is marked *in flight*. If that
send times out, or the worker dies mid-send, the next attempt first looks the
ride up (COQL on `Test_Rides` by lead and start time, in either date field, and
in only one if the org has only one) and adopts it if it is there. If the
look-up itself fails, the ride is sent anyway. A duplicate is a nuisance for the
dealer; a lost ride is a customer turned away.

Leads need no look-up. The CRM refuses a second lead for the same mobile.

The look-up needs our copy of the CRM lead id. Since 3 Nov a "Duplicate
Lead" answer names the existing lead (`Existing_lead_id`), and we keep it, so
a returning customer's rides are sent to that lead by id and can be looked up.
If a duplicate answer ever names no lead, a ride that times out for that
customer is sent again unchecked.

## Rules the queue keeps

- **One customer's jobs never run at once.** A lead and a ride sent together
  could each create a lead. Claims take a per-customer advisory lock. A job
  that finds its sibling in flight waits up to 20 s, then leaves itself for
  the next run.
- **A changed number is a new customer.** Changing the number clears the CRM
  lead id (`save-lead.ts`), because the CRM matches customers by mobile. The
  new number gets its own job once verified. A late answer for the old number
  is never filed under the new one. A ride waits while the new number is
  unverified.
- **No token, no attempt spent.** A refused or rate-limited token request
  waits 5 minutes without using up the job's ~3 days, and stops the run. The
  refusal is remembered for 60 s, so Zoho isn't asked once per job. Only a 401
  `INVALID_TOKEN` triggers a new token; `OAUTH_SCOPE_MISMATCH` won't be fixed by one.
- **No send is cut off by the platform.** Background work and the cron finish
  by 50 s, inside the 60 s function limit. A send that can't finish isn't started.
- **Nothing is "delivered" to a fake outside development.** With
  `CRM_PROVIDER=fake`, UAT and production queue every job and send none. They
  go once `CRM_PROVIDER=zoho`. So the site can launch before Greaves' go-live
  approval without losing leads.
- **The missing-job sweep looks back 36 hours, no more.** Its only purpose is a
  request that died seconds after saving. A long window once swept a
  developer's old local test data into the sandbox.
- **CRM text is scrubbed** of long digit runs before it is stored or logged.

## Running it

```bash
# .env — never commit these
CRM_PROVIDER=zoho
ZOHO_API_URL=https://sandbox.zohoapis.in      # production host only with APP_ENV=production
ZOHO_CLIENT_ID=…  ZOHO_CLIENT_SECRET=…  ZOHO_REFRESH_TOKEN=…

pnpm crm status          # queued / retrying / dead jobs, unmapped models and dealers
pnpm crm send            # send everything due now
pnpm crm requeue [id…]   # dead jobs get a fresh run, once the cause is fixed
pnpm crm sync-models     # read vehicle ids from the CRM
pnpm crm sync-dealers    # make our dealers match the CRM's dealer master (--dry-run first)
pnpm crm link-dealer AMP-S-001 1456765000001717131
pnpm crm smoke           # sandbox only: one real lead + ride + look-up
```

The app **refuses to start** if production points at the sandbox, or anything
else points at the live CRM. Production with the fake CRM starts, but logs a
warning on every boot.

## Test data in the sandbox

Every record we created has the name **"TEST Ampere Website (ignore)"**, a
mobile in the **+91 90000 xxxxx** range, and `utm_campaign` of
`sandbox_integration_test`, `crm_e2e`, `sandbox_retest_3nov`, `crm_e2e_3nov`,
`sandbox_retest_5nov` or `crm_e2e_5nov`. Greaves can delete them by any of those.
(Greaves deleted the 2 Nov records on 3 Nov.) The 5 Nov tests also left `999999`
in the sandbox's `Postal_Codes`, from the check that the fallback adds anything.
