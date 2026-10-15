# Hyper Checkout documentation — what it answers, what it corrects

**Written:** 2026-10-15, against Juspay's public Hyper Checkout (web) docs.
**Status:** applied. `src/lib/juspay/` has been changed to match.

Juspay sent three links:

- [Integration architecture](https://juspay.io/in/docs/hyper-checkout/web/overview/integration-architecture)
- [Dashboard guide](https://juspay.io/in/docs/dashboard/docs/unified-dashboard-overview/section-a-login-and-account-authentication-tutorial)
- [Juspay CLI](https://juspay.io/in/docs/integration-cli/docs/about-juspay-cli/overview)

plus: *"for testing, replace `api.juspay.in` with `sandbox.juspay.in` in the
cURLs."*

The landing pages are thin, but they expose an LLM-readable index at
`/docs/hyper-checkout/llms.txt` which links the real API pages. Everything
below comes from those.

---

## 1. The correction that mattered

**Webhooks are authenticated with HTTP Basic auth. There is no signature.**

`RealJuspayClient.verifyWebhookSignature` assumed HMAC-SHA256 over the raw
body, hex-encoded — a reasonable guess, and wrong. The documented scheme is:

```
Authorization: Basic base64(username:password)
```

where the username and password are a pair **we** set on the Juspay dashboard
(Payments → Settings → Webhook). Juspay replays them on every webhook, and
comparing them is the whole of the authenticity check.

Consequences worth being explicit about:

- **This is weaker than an HMAC.** The credential is a bearer secret, identical
  on every request, so anyone who observes one webhook can replay it forever.
  An HMAC signature proves the *body* was not tampered with; a static password
  proves nothing about the body at all. The endpoint must therefore be
  HTTPS-only, and the password long and random (`openssl rand -hex 32`).
- Juspay's username field rejects `@!#$%&'*+-/=?^_.{|}~`, so generate the
  *password* randomly and keep the username plain.
- There is a stronger option: **JWT/JWE encrypted webhooks**, enabled on the
  dashboard, which wrap the payload in a signed, encrypted token. If Ampere's
  security review objects to a replayable credential — and it reasonably
  might — that is the upgrade path. It requires implementing
  [Juspay's JWE/JWT guide](https://juspay.io/in/docs/api-reference/docs/express-checkout/jwejwt-encryption-guide),
  which we have not done.

The method is now `verifyWebhook(rawBody, authHeader)` — renamed because
calling a password comparison a "signature" check is how the next person
reading this code reaches the wrong conclusion about its strength.

The route reads the `Authorization` header. It previously looked for
`x-juspay-signature` and `x-webhook-signature`, neither of which exists.

---

## 2. Transport, now confirmed

### Authentication for server calls

```
Authorization: Basic base64(API_KEY + ":")      <- API key is the USERNAME,
x-merchantid: <merchant id>                        password is EMPTY
x-routing-id: <customer id>
```

We were sending the bare API key as the `Authorization` value, which would
have failed with 401 on the first real call. `x-merchantid` was only sent on
GET; `x-routing-id` was not sent at all.

`x-routing-id` must be the **same value for every call about one customer**, so
`getOrderStatus` now looks the customer id back up rather than passing the
order id and silently splitting a customer's traffic across shards.

### Endpoints

| | Sandbox | Production |
|---|---|---|
| Session | `https://sandbox.juspay.in/session` | `https://api.juspay.in/session` |
| Order status | `https://sandbox.juspay.in/orders/{order_id}` | `https://api.juspay.in/orders/{order_id}` |

Order status is `GET` and wants `Content-Type:
application/x-www-form-urlencoded` — not JSON, unlike `/session`.

### Where credentials come from

- **API key** — self-service: Dashboard → Payments → Settings → Security →
  Create New API Key. **We do not need to wait for Juspay for this one.**
- **Merchant ID** — from Juspay.
- **payment_page_client_id** — from Juspay's welcome email.

---

## 3. Status vocabulary — much larger than we modelled

`normaliseStatus` handled four values and dropped everything else to `NEW`.
The real list, with `status_id`:

| Meaning | Statuses |
|---|---|
| **Paid** | `CHARGED` (21) |
| **Failed** | `AUTHORIZATION_FAILED` (27), `AUTHENTICATION_FAILED` (26), `JUSPAY_DECLINED` (22), `CAPTURE_FAILED` (34), `VOID_FAILED` (35), `VOIDED` (31) |
| **In flight** | `PENDING_VBV` (23), `AUTHORIZING` (28), `STARTED` (20), `CAPTURE_INITIATED` (33), `VOID_INITIATED` (32), `AUTO_REFUNDED` (36) |
| **Neither** | `NEW` (10), `AUTHORIZED` (25), `PARTIAL_CHARGED` (37), `NOT_FOUND` (40) |

Before this change, `CAPTURE_FAILED`, `VOID_FAILED` and `VOIDED` all fell
through to `NEW` → `pending`. That is *safe* — it never shows a confirmation
for money that did not move — but it is wrong in a way the customer feels: a
dead order would have sat on "confirming your payment" forever instead of
saying it failed.

Three that deserve naming:

- **`AUTHORIZED` (25)** — funds held, not captured. Mapped to `pending`, which
  is conservative and still not right: `pending` means "wait and this resolves
  itself", and this one waits on *us* to call Capture. Fixing it properly needs
  an `authorized` member on `ResolvedStatus`, which is a change to the status
  resolution the spec fixes — so it is flagged, not made. See §3a of
  [integration-notes.md](./integration-notes.md).
- **`PARTIAL_CHARGED` (37)** — Juspay classes this as a success, but less money
  arrived than the order asked for. Mapped to `pending`, never `paid`. The
  amount check is the only thing between a part-paid order and a delivered
  scooter.
- **`NOT_FOUND` (40)** — Juspay has no such order. `pending` keeps us polling
  rather than failing an order that may not have reached them yet.

---

## 4. Session API constraints we do not currently satisfy

### `customer_email` is mandatory — we do not collect one

The form asks for name, phone and pincode by design. Three options:

1. **Synthetic address** (implemented): `order-{orderId}@orders.ampere-electric.com`,
   configurable via `JUSPAY_RECEIPT_DOMAIN`. Juspay's own receipt then goes
   nowhere, and our confirmation is the only thing the customer receives.
2. Add an email field to the buy branch — a conversion cost on a mobile form.
3. Ask Juspay whether it may be empty, as `customer_id` may be for guests.

This is a product decision for Ampere, not a technical one.

### `order_id` must be alphanumeric, max 21 characters

Ours is `AMP-{base36 timestamp}-{5 random}` — 18 characters, within the limit,
but **containing hyphens**. Whether "alphanumeric" is enforced strictly is
unknown and is the single cheapest thing to settle with one sandbox call.

If it is enforced, drop the hyphens: `AMP{stamp}{noise}` is 17 characters and
still readable in their dashboard.

### `return_url` must be HTTPS with no query parameters

Ours is `${origin}/buy/return` — clean, no query string. But in local
development `origin` is `http://localhost:3001`, which is **not** HTTPS and
will be rejected. Sandbox testing therefore needs a tunnel, which we need
anyway for webhooks to reach us.

### `amount` is a string

Already correct — `input.amount.toFixed(2)`.

---

## 5. Test resources

Sandbox cards, from Juspay's test resources page:

| Instrument | Value |
|---|---|
| VISA | `4242 4242 4242 4242` — any future expiry, any CVV |
| VISA | `4111 1111 1111 1111` |
| MasterCard | `5299 9202 1000 0277` |
| Dummy PG card | `4022 7579 1524 8950`, exp 09/30, CVV 123 |
| UPI success | `success@upi` |
| UPI failure | `failure@upi` |

`success@upi` / `failure@upi` are the useful pair — one of each outcome without
touching a card form.

---

## 6. The Juspay CLI

Not a CLI in the usual sense. It installs **MCP servers and skills into an AI
coding agent** — including Claude Code:

- `docs-mcp-server` — Juspay docs, no auth required
- `juspay-mcp` — live dashboard data (orders, configuration, analytics) after
  an OAuth sign-in
- skills: `jp-prd`, `jp-architecture`, `jp-executor`, `jp-validate`

`juspay-mcp` is the interesting one: it would let us read real order and
webhook state from the dashboard during testing instead of asking someone to
check it manually. Worth installing once credentials exist. `jp-executor`
generates integration code and is **not** worth pointing at this codebase —
ours is written, tested, and shaped around decisions the generator knows
nothing about.

---

## 6a. The return URL is signed — and we still do not trust it

Juspay's "Handle Payment Response" page shows the return carrying:

```
status_id=21&status=CHARGED&order_id=...&signature=...&signature_algorithm=HMAC-SHA256
```

So there *is* an HMAC — on the browser return, not on the webhook. The HMAC
assumption in the original client was in the right family and the wrong place.

This changes nothing about our design, and Juspay agree: their own page calls a
server-to-server Order Status call **mandatory** for determining final status.
We read exactly one field from the return — `order_id`, to know which order to
look up — and everything displayed comes from our own record after resolution.

Verifying the signature would be cheap defence in depth, but it buys little
when the only field we consume is already treated as untrusted input.

What *did* need fixing is that `order_id` was the only thing standing between a
stranger and an order record. See §6b.

## 6b. Access control on the status endpoint

`GET /api/orders/{orderId}/status` had no authorisation. Given an order id it
returned the amount charged, the amount paid, the payment type, the model and
colour, and the dealer's name and phone — for any order, to anyone.

Order ids are `AMP-{base36 timestamp}-{5 random}`. The timestamp half is
guessable to within a narrow window, leaving about 60 million combinations on
the random half: not trivially brute-forced, and not a secret worth resting a
payment record on either. Juspay also puts the id in the return URL, where it
is visible to the customer, to their browser history, and to anything that sees
the URL.

The route now requires the continuity cookie and matches `order.leadId` against
the session. A mismatch returns 404, not 403 — whether an order exists is
itself worth not confirming.

Safe because the cookie is `SameSite=Lax`, which survives the top-level
navigation back from Juspay, and because the page calls this route same-origin.

## 6c. Cancel and Refund — documented, deliberately not built

**Cancel Order** — `POST /merchants/{merchant_id}/order/{order_id}/cancel`,
body `{ cancel_reason }`. Kills an active payment link. Only works on an
`ACTIVE` order and cannot be undone.

This is the missing half of a real safety property. We hold a unit for fifteen
minutes; when that hold expires we release the stock — but the Juspay payment
link stays live, so a customer could pay for a scooter we have just given to
someone else.

It is not built because the job that would call it does not exist either:
`expireStale()` is written and tested but **nothing schedules it**, so holds
never actually expire in production today. Both halves want doing together,
and the scheduling half touches the inventory module the spec fixes.

**Refund Order** — `POST /orders/{order_id}/refunds`, with a `unique_request_id`
(alphanumeric, under 21 characters) that is what stops a double refund.
Partial refunds supported; `CHARGED` orders only; refunds queue at Juspay for
up to 15 minutes before reaching the gateway.

Not built because there is no cancellation journey to attach it to, and Legal
has not supplied cancellation terms. Worth knowing it is a single call when
they do.

## 6d. Opening the hosted page

Juspay support two ways: navigate the browser to `payment_links.web`, or embed
it in an iframe with `allow="payment *;"` and at least 700px of width.

Our plain redirect is the supported path and is what we want — the hosted page
is Juspay's liability boundary, and an iframe muddies it. One warning from
their docs worth recording: **never open the payment URL in an Android or iOS
webview**, because UPI intent does not work there.

## 7. What is still outstanding

Down from eleven items to five.

| # | Ask | Blocks |
|---|---|---|
| 1 | **Merchant ID and `payment_page_client_id`** | Every API call. The API key we can self-serve. |
| 2 | **Are the sandbox credentials separate** from production, or is it one API key against two base URLs? | Whether "swap the host" is the whole story |
| 3 | **Is Capture required for full payment**, or only the consumer-finance flow? | Whether `AUTHORIZED` sits on the happy path for card and UPI, or only for loans |
| 4 | **`CF_LSP` or `CF_EMI` on our account** | Which product the EMI button opens. Ampere advertises ~6.99%, which is the TVS loan; card EMI is 13–16%. A labelling problem with a customer-complaint ending |
| 5 | **May `order_id` contain hyphens?** | One sandbox call settles it |

**No longer outstanding: the EMI plans API.** We decided not to quote
instalments at all — the customer picks "Pay by EMI", we redirect, and Juspay's
page shows the real lenders and rates. Item 4 still matters for what we *call*
the option, but nothing on our side needs a rate any more.

Only Juspay can answer 1, 2 and 5. Items 3 and 4 are commercial.
