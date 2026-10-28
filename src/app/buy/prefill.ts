import { findModel, isValidColourCode, type Model } from '@/lib/catalog/catalog';
import { LEAD_INTENTS } from '@/lib/schemas/lead';

/**
 * Prefill parsing. Runs in the server component — no client redirect, no flash
 * of an empty form.
 *
 * Spec 3:
 *   - every parameter is optional; /buy with none renders a complete page
 *   - invalid values are dropped silently and logged; ?model=foo falls back to
 *     no preselection rather than an error
 *   - the full original query string is saved regardless of what we parse, so
 *     attribution questions can be answered later without a code change
 *
 * Where the product comes from, in order:
 *   1. ?model= in the link — our code or the main site's page name
 *   2. the product page the customer was on, from the Referer header, when the
 *      link carries no model. Best effort: browsers often send only the
 *      origin across sites, so links with ?model= are the reliable route.
 *   3. nothing — the customer picks in step two
 */

/** The marketing site. A referring page on any other host is ignored. */
const MAIN_SITE_HOSTS = new Set(['ampere-electric.com', 'www.ampere-electric.com']);

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface Prefill {
  modelCode: string | null;
  colourCode: string | null;
  intent: (typeof LEAD_INTENTS)[number];
  /**
   * Carried from the dealer locator, where the customer has already chosen
   * where to buy. Journey document section 01 lists it among the five fields
   * every touchpoint passes through.
   */
  dealerCode: string | null;
  /** How modelCode was decided. Null when nothing was preselected. */
  modelFrom: 'link' | 'referrer' | null;
  /**
   * How step two lays out a scooter sold in two versions. 'list' (the default)
   * gives Nexus EX+ and Nexus EX+ Intellipack a card each; 'variants'
   * (?view=variants) gives them one card with Standard / Intellipack chips,
   * like a variant picker on a shopping site.
   */
  layout: 'list' | 'variants';
  /** Carried from any touchpoint that already knows it. */
  pincode: string | null;
  src: string | null;
  utm: Record<string, string> | null;
  gclid: string | null;
  fbclid: string | null;
  /** Everything that arrived, parsed or not. */
  sourceRaw: Record<string, string> | null;
  /** Parameters we recognised but could not use. Logged, never shown. */
  dropped: string[];
}

/** Known entry points. An unrecognised src is kept — it is only a label. */
const MAX_VALUE_LENGTH = 255;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function clamp(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_VALUE_LENGTH);
}

export function parsePrefill(
  params: RawSearchParams,
  context: { referer?: string | null } = {},
): Prefill {
  const dropped: string[] = [];

  // Keep everything, whatever we make of it. This is the backstop that answers
  // "where did this lead come from" a year later.
  const sourceRaw: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const flat = clamp(first(value));
    if (flat !== null) sourceRaw[key.slice(0, 64)] = flat;
  }

  const requestedModel = clamp(first(params.model));
  let model = findModel(requestedModel);
  if (requestedModel && !model) dropped.push(`model=${requestedModel}`);

  // No product in the link: the product page they were on, if we can tell.
  const fromReferrer = requestedModel ? null : modelFromReferer(context.referer);
  if (fromReferrer) model = fromReferrer;

  const requestedColour = clamp(first(params.colour) ?? first(params.color));
  let colourCode: string | null = null;
  if (requestedColour) {
    if (model && isValidColourCode(model.code, requestedColour)) {
      colourCode = requestedColour;
    } else {
      // A colour without a valid model has nothing to attach to.
      dropped.push(`colour=${requestedColour}`);
    }
  }

  const requestedView = clamp(first(params.view));
  const layout: Prefill['layout'] = requestedView === 'variants' ? 'variants' : 'list';
  if (requestedView && requestedView !== 'variants' && requestedView !== 'list') {
    dropped.push(`view=${requestedView}`);
  }

  const requestedIntent = clamp(first(params.intent));
  let intent: Prefill['intent'] = 'undecided';
  if (requestedIntent) {
    if ((LEAD_INTENTS as readonly string[]).includes(requestedIntent)) {
      intent = requestedIntent as Prefill['intent'];
    } else {
      dropped.push(`intent=${requestedIntent}`);
    }
  }

  const utm: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith('utm_')) continue;
    const flat = clamp(first(value));
    if (flat !== null) utm[key] = flat;
  }

  const requestedPincode = clamp(first(params.pincode));
  const pincode = requestedPincode && /^[1-9]\d{5}$/.test(requestedPincode)
    ? requestedPincode
    : null;
  if (requestedPincode && !pincode) dropped.push(`pincode=${requestedPincode}`);

  return {
    modelCode: model?.code ?? null,
    modelFrom: model ? (fromReferrer ? 'referrer' : 'link') : null,
    layout,
    colourCode,
    intent,
    // Validated against the dealer master at save time, not here — this is
    // only a hint, and an unknown code must not break the page.
    dealerCode: clamp(first(params.dealer_code) ?? first(params.dealer)),
    pincode,
    src: clamp(first(params.src)),
    utm: Object.keys(utm).length > 0 ? utm : null,
    gclid: clamp(first(params.gclid)),
    fbclid: clamp(first(params.fbclid)),
    sourceRaw: Object.keys(sourceRaw).length > 0 ? sourceRaw : null,
    dropped,
  };
}

/**
 * ampere-electric.com/gmax → Magnus GMax. Only the first path segment, only on
 * the main site, and only when it names a model — /, /about-us and our own
 * /buy all come back null.
 */
function modelFromReferer(referer: string | null | undefined): Model | null {
  if (!referer) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  if (!MAIN_SITE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const slug = url.pathname.split('/').filter(Boolean)[0];
  return findModel(slug);
}

/** The attribution slice of the prefill, in the shape POST /api/leads wants. */
export function attributionOf(prefill: Prefill) {
  return {
    src: prefill.src,
    utm: prefill.utm,
    gclid: prefill.gclid,
    fbclid: prefill.fbclid,
    sourceRaw: prefill.sourceRaw,
  };
}
