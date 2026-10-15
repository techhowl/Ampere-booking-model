import 'dotenv/config';

/**
 * Juspay sandbox smoke test.
 *
 *   pnpm juspay:smoke
 *
 * Makes ONE real /session call against sandbox.juspay.in with whatever is in
 * .env, prints the response, and then reads the order back.
 *
 * It exists because the whole payment integration is written but has never
 * spoken to Juspay. Every failure mode below is one we would otherwise hit for
 * the first time with a customer mid-payment:
 *
 *   401  the Authorization header is wrong — almost always the bare API key
 *        instead of Basic base64(key + ":")
 *   400  the request shape is wrong — a missing mandatory field, an order_id
 *        Juspay will not accept, or a return_url that is not HTTPS
 *
 * This talks to the SANDBOX. It moves no money. It is still a real request to
 * a third party, so it is a script you run, never something that runs itself.
 */

const BASE = (process.env.JUSPAY_BASE_URL ?? 'https://sandbox.juspay.in').replace(/\/$/, '');
const API_KEY = process.env.JUSPAY_API_KEY ?? '';
const MERCHANT_ID = process.env.JUSPAY_MERCHANT_ID ?? '';
const CLIENT_ID = process.env.JUSPAY_PAYMENT_PAGE_CLIENT_ID ?? '';

/* A return_url must be HTTPS with no query string. localhost is neither, so
   point this at a tunnel when testing the redirect for real. */
const RETURN_URL = process.env.JUSPAY_SMOKE_RETURN_URL ?? 'https://buy.ampere-electric.com/buy/return';

function missing(): string[] {
  const gaps: string[] = [];
  if (!API_KEY) gaps.push('JUSPAY_API_KEY');
  if (!MERCHANT_ID) gaps.push('JUSPAY_MERCHANT_ID');
  if (!CLIENT_ID) gaps.push('JUSPAY_PAYMENT_PAGE_CLIENT_ID');
  return gaps;
}

/** Juspay says alphanumeric, max 21. Hyphens are what we want to find out about. */
function smokeOrderId(withHyphens: boolean): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.random().toString(36).slice(2, 7).toUpperCase();
  return withHyphens ? `SMK-${stamp}-${noise}` : `SMK${stamp}${noise}`;
}

function headers(routingId: string): Record<string, string> {
  return {
    // The API key is the USERNAME and the password is empty. Hence the colon.
    Authorization: `Basic ${Buffer.from(`${API_KEY}:`).toString('base64')}`,
    'x-merchantid': MERCHANT_ID,
    'x-routing-id': routingId,
    'Content-Type': 'application/json',
  };
}

async function createSession(orderId: string) {
  const customerId = `smoke-${orderId.toLowerCase()}`;

  const body = {
    order_id: orderId,
    amount: '1.00', // A new account is capped at INR 100 per order.
    currency: 'INR',
    customer_id: customerId,
    customer_email: `${customerId}@orders.ampere-electric.com`,
    customer_phone: '9999999999',
    payment_page_client_id: CLIENT_ID,
    action: 'paymentPage',
    return_url: RETURN_URL,
    description: 'Ampere /buy smoke test',
  };

  const res = await fetch(`${BASE}/session`, {
    method: 'POST',
    headers: headers(customerId),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  return { status: res.status, text, customerId };
}

async function readOrder(orderId: string, routingId: string) {
  const res = await fetch(`${BASE}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: { ...headers(routingId), 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, text: await res.text() };
}

function explain(status: number, text: string): string {
  if (status === 401) {
    return 'Rejected the credential. Check JUSPAY_API_KEY, and that it belongs to the SANDBOX account.';
  }
  if (status === 400) {
    return 'Reached Juspay and they refused the request shape. The body below names the field.';
  }
  if (status === 404) return 'Wrong path or wrong base URL.';
  if (status >= 500) return 'Juspay-side error. Worth retrying before investigating.';
  if (status === 200 || status === 201) return 'Accepted.';
  return text.slice(0, 200);
}

async function main() {
  const gaps = missing();

  console.log(`\nJuspay smoke test  ->  ${BASE}`);
  console.log(`return_url         ->  ${RETURN_URL}\n`);

  if (gaps.length) {
    console.log('Missing credentials, so this will only prove we can reach Juspay:');
    for (const gap of gaps) console.log(`  - ${gap}`);
    console.log(
      '\nAPI key is self-service: Dashboard > Payments > Settings > Security > Create New API Key.' +
        '\nMerchant ID and payment page client ID come from Juspay.\n',
    );
  }

  /* Hyphens first, because that is the open question. If this is rejected and
     the second attempt is accepted, we have our answer. */
  for (const withHyphens of [true, false]) {
    const orderId = smokeOrderId(withHyphens);
    const label = withHyphens ? 'with hyphens' : 'alphanumeric only';

    try {
      const { status, text, customerId } = await createSession(orderId);
      console.log(`POST /session  [${label}]  order_id=${orderId}`);
      console.log(`  HTTP ${status} — ${explain(status, text)}`);
      console.log(`  ${text.slice(0, 600)}\n`);

      if (status === 200 || status === 201) {
        const parsed = JSON.parse(text) as { payment_links?: { web?: string } };
        const link = parsed.payment_links?.web;
        if (link) console.log(`  Hosted page: ${link}\n`);

        const read = await readOrder(orderId, customerId);
        console.log(`GET /orders/${orderId}`);
        console.log(`  HTTP ${read.status} — ${explain(read.status, read.text)}`);
        console.log(`  ${read.text.slice(0, 600)}\n`);
      }
    } catch (error) {
      console.log(`POST /session  [${label}]  could not complete`);
      console.log(`  ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
