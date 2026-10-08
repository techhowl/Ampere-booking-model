# Juspay integration — what the Hypercredit document changes

**Written:** 2026-09-28, against
[hypercredit-integration-steps.md](./hypercredit-integration-steps.md).
**Status:** assessment. Nothing in `src/lib/juspay/` has been changed yet.

Build spec §9 listed three things we needed from Juspay:

> confirmation that the webhook exists and its signature scheme, the status API
> endpoint, and how to pass the payment method filter.

This document answers roughly one and a half of those three, and introduces a
flow we had not modelled at all.

---

## 1. What this document actually is

It is the integration guide for **Hypercredit** — Juspay's *consumer finance*
journey, with **TVS Credit** as the lender. It is not a generic card/UPI
checkout guide.

The give-aways: `payment_method: "TVS_LSP"`, `paymentMethodType:
"CONSUMER_FINANCE"`, VKYC steps in the status table, and "the loan ID of TVS
Credit … will be provided as `epg_txn_id`".

That matters for a reason build spec §10 flagged as a risk. The spec warned:

> The financing advertised on the product pages — rates in the region of 6.99% —
> is a **vehicle loan** from a finance partner, arranged at the dealership. What
> Juspay provides is **checkout EMI** on a card … at materially higher rates.
> They are different products and they must be labelled differently.

This document shows both are available through the same checkout, as two
distinct sub-types:

| Sub-type | What it is |
|---|---|
| `CF_LSP` | The **lender** journey — TVS Credit vehicle loan, with VKYC. This is the 6.99%-class product. |
| `CF_EMI` | Card/BNPL **checkout EMI** — the materially more expensive one. |

So §10's distinction is not just a labelling concern any more; it is a field in
the request, and we choose which to enable. Good news — but it makes getting the
labelling right more important, not less, because both can now appear on the
same page.

---

## 2. What it answers

### Payment method filtering — **answered, fully**

We asked how to pass a payment-method filter. It is `payment_rule` →
`payment_flows.part_payment.info.plan_info[].editable_plan_details[]
.parts_info[].payment_filter`, carrying:

- `allowDefaultOptions` (boolean) — whether Juspay's usual methods show at all
- `options[]` — `{ paymentMethodType, paymentMethodSubTypes[], enable }`
- `emiOptions` — `standardEmi` / `lowCostEmi` / `noCostEmi`, each with `enable`

The supplied sample is precisely the "loan first, everything-but-loan for the
downpayment" configuration: part 1 enables `CF_LSP` and disables `CF_EMI` with
`allowDefaultOptions: false`; part 2 sets `allowDefaultOptions: true` and
disables `CF_LSP`.

### Order status API — **partially answered**

Confirmed to exist and recommended for polling, but the request and response
structure is a link, not content. We have the status *vocabulary* (below) and
not the payload.

### Webhook — **existence confirmed, signature scheme NOT supplied**

The webhook is confirmed and we set it per order via `metadata.webhook_url`.
The payload structure and the signature scheme are a link only.

This is the one genuinely blocking gap. Spec §15 requires that webhook
signatures are verified and unsigned payloads dropped, and `paid` is terminal on
the strength of that webhook. We cannot write `verifyWebhookSignature` against a
hyperlink.

### The session/order creation call — **answered, in full**

Endpoint, headers, every request field, the response shape. This is more than we
had. Two useful details:

- `X-Request-Id` is a mandatory unique identifier per session call — our
  `Idempotency-Key` maps onto it directly.
- `payment_links.web` in the response is the redirect URL, which is what
  `CreateOrderResult.redirectUrl` already models.

---

## 3. What it changes — read this part

### 3a. This is auth-and-capture. Money does not move on its own.

The document's opening line is "to create a session order on Juspay and to
initiate an **auth-and-capture** flow."

Our current model assumes the customer pays and `CHARGED` arrives. The real
sequence for a loan is:

```
customer completes journey  →  txn_status = AUTHORIZED   (loan granted, VKYC done,
                                                          nothing charged yet)
merchant calls Capture API  →  txn_status = CHARGED      (loan booked, TVSC confirms)
```

Two failure modes fall out of this, and both are expensive:

1. **If we never call capture, the customer never gets charged** and the loan is
   never booked. The order sits at `AUTHORIZED` forever and eventually
   auto-refunds. A silent revenue hole.
2. **If we map `AUTHORIZED` to `paid`, we show a confirmation for money that has
   not moved.** That is exactly the error spec §6 calls "the worst error
   available to us".

Our `ResolvedStatus` is `paid | failed | pending | unknown`. `AUTHORIZED` is
none of those. It is an actionable state that obliges *us* to do something.

**Proposal:** add `authorized` to `ResolvedStatus`, treat it as not-paid for
anything customer-facing, and drive a capture step from it. `paid` stays
terminal and stays reserved for `CHARGED`.

### 3b. Capture requires an invoice, which we do not have

The capture payload carries `invoice` with `DocumentType: INVOICE` and
base-64 `Data`, and the doc says the merchant's internal trigger is e.g.
"Document Uploads".

We do not generate invoices. Nothing in the build spec produces one. This is an
**operational dependency on Ampere or the dealer**, not a coding task, and it
sits directly on the path between the customer finishing and the money moving.
Both `invoiceDownloadURL` and `invoice` are marked optional in the field table
while the surrounding prose treats invoice details as required — that
contradiction needs resolving before we can build the capture step.

### 3c. One order can now have two transactions

> "In case the downpayment is applicable, there will be two transactions. One
> for loan payment and other for downpayment collection. … The transaction
> amount for each … shall sum up to the overall order amount."

Our `orders` table has a single `amount_paid`, and our status resolution reasons
about one transaction. With a downpayment, "is this order paid?" becomes "have
*both* transactions reached a terminal good state, and do they sum to
`amount_total`?"

`payment_events` is append-only and already fine. The reasoning layer is not.
This likely needs a transaction-level record rather than folding everything into
the order row — a schema change, so flagging rather than assuming.

### 3d. Part-payment is richer than our partial-payment model

Our price book models partial payment as `partial_mode` (`fixed` | `percent`)
plus `partial_value`. Juspay's `plan_info` supports:

- `plan_type: "EDITABLE"` with `editable_plan_details` — `minimum_part_amount`,
  `maximum_no_of_parts`, and a customer-facing `plan_title` ("Pay as you like")
- `fixed_plan_details` — null in the sample, shape not documented

So Juspay can let the **customer** choose the part amount, which is a third mode
we had not considered. Open item #1 (the partial payment amount) now has an
extra option on the table: don't pick an amount, set a floor and let the
customer choose.

Worth putting to Ampere, because "Pay as you like, minimum ₹X" is a different
and arguably better proposition than a fixed deposit.

### 3e. Mandatory fields we do not collect

`metadata.delivery_address` is **mandatory**, and `address_line_1` and
`address_line_2` within it are both mandatory.

The spec's identity step collects **name, phone, pincode** — no address. We
cannot build a compliant session request from what the current form gathers.

Also relevant, all optional but all obviously wanted by a lender:
`customer_dob`, `customer_employment_type` (SALARIED | SELF_EMPLOYED),
`customer_first_name` / `customer_last_name` (we store one `name`),
`customer_gender`, `customer_marital_status`.

This is a **product decision, not a technical one**: adding address fields to a
paid-traffic mobile form costs conversion. Options are to collect the address
only on the buy branch after OTP (not at step one), or to ask Juspay whether a
minimal address — pincode-derived — is acceptable for the non-loan flows.

### 3f. Price needs splitting into ex-showroom + RTO

`order_basket` wants `product_price`, `rto_charges` and `total_amount`
(on-road). Our `price_book` has a single `amount_total`. Whether that is
ex-showroom or on-road is currently ambiguous, and Juspay needs both halves.

Worth resolving with Finance alongside open item #5 (prices), since it changes
what we ask them for.

### 3g. Order expiry interacts with our 15-minute stock hold

> "The merchant must pass order expiry in session API to enable auto-refunds in
> case the order is not successful within the fulfilment period."

We hold a unit for 15 minutes. A loan journey with VKYC will not finish in 15
minutes. If our reservation expires while the customer is still in VKYC, we
release stock we are about to need; if we set the Juspay expiry long and the
hold short, the two disagree about whether the order is still live.

`RESERVATION_MINUTES = 15` was sized for a card payment. It is very likely wrong
for a loan journey, and the two expiries should be set from one number.

### 3h. New status vocabulary

Our `JuspayStatus` is `'CHARGED' | 'PENDING' | 'AUTHORIZATION_FAILED' | 'NEW'`.
This document adds `VBV_SUCCESSFUL` and `AUTHORIZED`, and confirms `NEW` on
session creation.

`VBV_SUCCESSFUL` means "VKYC complete but pending audit" — another
not-yet-money state.

---

## 4. Still outstanding — the list to send Juspay

Ordered by what blocks us soonest.

| # | Ask | Why it blocks |
|---|---|---|
| 1 | **Webhook signature scheme** — algorithm, which header carries it, what exactly is signed (raw body? canonicalised?), and the secret's provenance | `verifyWebhookSignature` cannot be written. Spec §15 requires unsigned payloads be dropped, and the webhook is our source of truth |
| 2 | **Webhook payload structure**, as a document rather than a link — single-transaction and two-transaction (loan + downpayment) examples | Status resolution reads this payload |
| 3 | **Order Status API** request/response structure, same two examples | The reconciler path |
| 4 | **Credentials**: API key, `payment_page_client_id`, merchant ID, for UAT first | Nothing can be tested against the real sandbox |
| 5 | **Is auth-and-capture required for non-loan payments?** If a customer pays in full by UPI or card, do we still have to call capture, or does that charge directly? | Decides whether capture is on every path or only the loan path |
| 6 | **Invoice at capture** — is it genuinely mandatory? The field table marks `invoice` optional; the prose does not. If mandatory, what satisfies it at the moment of capture, before a vehicle is allocated? | The capture step, and an operational dependency on Ampere |
| 7 | **`fixed_plan_details` structure** — null in the sample, undocumented | Needed if Ampere chooses a fixed deposit over "pay as you like" |
| 8 | **`payment_rule` vs `payment_rules`** — the field table says the former, the sample says the latter | Trivial, but a wrong key silently disables filtering |
| 9 | **Capture timing window** — how long after `AUTHORIZED` may we capture, and what happens if we miss it? | Sets our internal SLA and the reconciliation job's urgency |
| 10 | **Recommended `order_expiry`** for a loan journey including VKYC | Drives both the Juspay expiry and our stock-hold duration |
| 11 | **Is `CF_EMI` in scope for us at all**, or is the Ampere journey LSP-only? | Decides whether the §10 dual-rate labelling problem exists in our UI |

Two smaller things to confirm in passing: the sample request as supplied does
not parse as JSON (missing commas after `rto_charges` and after the
`metadata.dealer_details` block), and the capture sample passes
`DocumentFormat: "JSON"` which is not among the documented values
(PDF | JPG | OTHERS).

---

## 5. What this means for the build order

Nothing here blocks the current next step. Lead capture, OTP, consent, dealer
resolution and the `/buy` shell are all untouched by this document, and the
inventory work stands.

What it does change:

- **`FakeJuspayClient` should grow an auth-and-capture path** before we write
  the order route, so the capture step is exercised from the start rather than
  bolted on when credentials arrive. That is the whole point of building against
  a fake.
- **The order/transaction schema question (3c) should be settled before the
  order route is written**, not after. Retrofitting a one-to-many relationship
  through code that assumes one-to-one is the expensive version.
- **Items 3e (address) and 3f (price split) are inputs to the form and to
  Finance**, so they want raising now even though they are not code.
