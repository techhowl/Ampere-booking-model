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

## 7. What is still outstanding

Down from eleven items to five.

| # | Ask | Blocks |
|---|---|---|
| 1 | **Merchant ID and `payment_page_client_id`** | Every API call. The API key we can self-serve. |
| 2 | **Is Capture required for full payment**, or only the consumer-finance flow? | Whether `AUTHORIZED` is on the happy path for card and UPI, or only for loans |
| 3 | **`CF_LSP` or `CF_EMI` on our account** | Whether the EMI button leads to a ~6.99% TVS loan or 13–16% card EMI. A labelling problem with a customer-complaint ending |
| 4 | **An EMI plans API** we can call before redirect | The page currently shows a monthly figure from a placeholder rate table in `src/lib/emi/emi.ts`. Either we get real plans, or we stop showing a number |
| 5 | **May `order_id` contain hyphens?** | One sandbox call settles it |

Items 2–4 are commercial or product questions; only Juspay can answer 1 and 5.
