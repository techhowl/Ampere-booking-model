/**
 * Greaves' product list: the vehicle models the CRM knows, with their ids.
 *
 * `get_products` arrived with the live collection (2026-11-23). It answers like
 * every other Greaves function — HTTP 200, the real result a JSON *string* in
 * details.output — and lists each model as:
 *
 *   { model_id, model_variant_name, model_family, colors: [...] }
 *
 * `pnpm crm sync-models` reads it into crm_vehicle_models. Ids differ between
 * sandbox and production, so they are data, never code.
 *
 * The CRM's names are not ours. Seen live: "EX+" (family Nexus) for our
 * "Nexus EX+", "Magnus G Max with Intellipack" for "Magnus GMax Intellipack".
 * So a product matches on its variant name, or family plus variant, with case,
 * punctuation, spacing and the word "with" ignored.
 */

export interface CrmProduct {
  id: string;
  name: string;
  family: string;
  colours: string[];
}

export class ProductListError extends Error {}

const CRM_ID = /^\d{10,30}$/;

/** Read get_products' HTTP answer. Throws ProductListError when it is not a product list. */
export function parseProductList(status: number, body: string): CrmProduct[] {
  if (status !== 200) throw new ProductListError(`get_products answered HTTP ${status}`);

  let envelope: { code?: unknown; details?: { output?: unknown } };
  try {
    envelope = JSON.parse(body) as typeof envelope;
  } catch {
    throw new ProductListError('get_products answered something that is not JSON');
  }
  const output = envelope?.details?.output;
  if (envelope?.code !== 'success' || typeof output !== 'string') {
    throw new ProductListError(`get_products did not complete (${String(envelope?.code ?? 'unknown')})`);
  }

  // A 19-digit id overflows a JavaScript number. Quote any that arrive bare.
  const safe = output.replace(/("model_id"\s*:\s*)(\d+)/g, '$1"$2"');
  let result: { status?: unknown; message?: unknown; models?: unknown };
  try {
    result = JSON.parse(safe) as typeof result;
  } catch {
    throw new ProductListError('get_products output is not JSON');
  }
  if (result.status !== 'success' || !Array.isArray(result.models)) {
    throw new ProductListError(`get_products said: ${String(result.message ?? result.status ?? 'no model list')}`);
  }

  const products: CrmProduct[] = [];
  for (const raw of result.models as unknown[]) {
    const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const id = text(row.model_id);
    const name = text(row.model_variant_name);
    if (!CRM_ID.test(id) || !name) continue;
    const colours = Array.isArray(row.colors) ? row.colors.map(text).filter(Boolean) : [];
    products.push({ id, name, family: text(row.model_family), colours });
  }
  return products;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().replace(/\s+/g, ' ') : '';
}

/** "Magnus G Max with Intellipack" and "Magnus GMax Intellipack" are the same key. */
export function productKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bwith\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The CRM products that are this scooter. One is a match; none or several is a
 * problem for a person, never a guess.
 */
export function productsFor(ourName: string, products: CrmProduct[]): CrmProduct[] {
  const key = productKey(ourName);
  return products.filter((p) => productKey(p.name) === key || productKey(`${p.family} ${p.name}`) === key);
}

/** Colours we offer for a scooter that its CRM product does not list. */
export function coloursMissingFrom(product: CrmProduct, ourColours: string[]): string[] {
  const theirs = new Set(product.colours.map(productKey));
  return ourColours.filter((c) => !theirs.has(productKey(c)));
}
