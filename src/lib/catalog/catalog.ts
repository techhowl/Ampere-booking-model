/**
 * Model, colour and region definitions.
 *
 * These live in code rather than the database on purpose. The schema stores
 * `model_code` and `colour_code` as bare strings and has no table to hang a
 * display name, swatch or region membership on. Five models that change once a
 * year do not justify an admin screen; if that changes, moving these arrays
 * into tables is a migration, not a redesign.
 *
 * What is NOT here: prices. Those live in `price_book`, per model per region,
 * and are resolved server-side at request time. A price in this file would be a
 * second source of truth for money, which is exactly the thing the spec forbids.
 *
 * The line-up is the five named in the purchase journey document, section 01.
 * Specs and colours are PLACEHOLDER and need confirming against Ampere's
 * published figures. Region membership is open item #2 (Sales).
 */

export interface Colour {
  code: string;
  name: string;
  /** Swatch shown in the picker. */
  hex: string;
}

/**
 * The three numbers the reference page leads with. PLACEHOLDER — these need
 * confirming against Ampere's published specifications before launch.
 */
export interface ModelSpecs {
  /** km on a full charge. */
  rangeKm: number;
  /** km/h. */
  topSpeedKmph: number;
  /** Hours for a full charge. */
  chargeHours: number;
}

/**
 * The design groups models under a family tab (NEXUS / MAGNUS / REO) and lists
 * the variants beneath it. Three families, five variants.
 */
export const FAMILIES = [
  { code: 'nexus', name: 'Nexus' },
  { code: 'magnus', name: 'Magnus' },
  { code: 'reo', name: 'Reo' },
] as const;

export type FamilyCode = (typeof FAMILIES)[number]['code'];

export interface Model {
  code: string;
  name: string;
  family: FamilyCode;
  /** Order in the picker, low first. */
  sort: number;
  colours: Colour[];
  specs: ModelSpecs;
  /**
   * Image basename under /public/models/. The component resolves
   * `/models/<image>-<colour>.png`, falling back to `/models/<image>.png`,
   * and renders a placeholder when neither exists.
   */
  image: string;
}

export interface Region {
  code: string;
  name: string;
  /** Pincode gives us the state; the state maps to a region. */
  states: string[];
}

/* ------------------------------------------------------------------ */
/* Regions — PLACEHOLDER, pending the real list from Sales             */
/* ------------------------------------------------------------------ */

export const REGIONS: readonly Region[] = [
  {
    code: 'north',
    name: 'North',
    states: ['DL', 'HR', 'PB', 'UP', 'UK', 'RJ', 'HP', 'JK', 'CH'],
  },
  {
    code: 'west',
    name: 'West',
    states: ['MH', 'GJ', 'MP', 'GA', 'CG', 'DD'],
  },
  {
    code: 'south',
    name: 'South',
    states: ['TN', 'KA', 'KL', 'AP', 'TS', 'PY'],
  },
  {
    code: 'east',
    name: 'East',
    states: ['WB', 'OD', 'BR', 'JH', 'AS', 'SK', 'ML'],
  },
] as const;

/* ------------------------------------------------------------------ */
/* Models — the five from the purchase journey document                */
/* ------------------------------------------------------------------ */

/*
 * Colours are per model, because they are: the Reo VYB does not come in
 * Matcha Green. Names are taken from each model's own page on
 * ampere-electric.com; hex values are read off Ampere's photography, so a
 * swatch matches the scooter the customer is looking at.
 */

const CARBON_KNIGHT: Colour = { code: 'carbon-knight', name: 'Carbon Knight', hex: '#2E2E30' };
const STEEL_GREY: Colour = { code: 'steel-grey', name: 'Steel Grey', hex: '#3E5457' };

const MATCHA_GREEN: Colour = { code: 'matcha-green', name: 'Matcha Green', hex: '#7FB89C' };
const MONSOON_BLUE: Colour = { code: 'monsoon-blue', name: 'Monsoon Blue', hex: '#4A7A96' };
const CINNAMON_COPPER: Colour = { code: 'cinnamon-copper', name: 'Cinnamon Copper', hex: '#A8614A' };

const MISTY_MAUVE: Colour = { code: 'misty-mauve', name: 'Misty Mauve', hex: '#B9A6AC' };
const OCEAN_BLUE: Colour = { code: 'ocean-blue', name: 'Ocean Blue', hex: '#1E3A6E' };
const BUTTER_YELLOW: Colour = { code: 'butter-yellow', name: 'Butter Yellow', hex: '#E3C765' };

const TEAL: Colour = { code: 'teal', name: 'Teal', hex: '#20A0A8' };
const PASTEL_PURPLE: Colour = { code: 'pastel-purple', name: 'Pastel Purple', hex: '#9B7BC4' };
const VYB_WHITE: Colour = { code: 'white', name: 'White', hex: '#E8E8EA' };
const VYB_BLACK: Colour = { code: 'black', name: 'Black', hex: '#6A6A6C' };

/**
 * Prices here are the published ex-showroom figures from each model page, used
 * only to seed `price_book`. At runtime every amount is resolved from the
 * database, never from this file.
 */
export const MODELS: readonly Model[] = [
  {
    code: 'nexus-ex-plus',
    family: 'nexus',
    name: 'Nexus EX+',
    sort: 1,
    colours: [CARBON_KNIGHT, STEEL_GREY],
    specs: { rangeKm: 136, topSpeedKmph: 93, chargeHours: 3.1 },
    image: 'nexus-ex-plus',
  },
  {
    // "New Magnus GMax (with Intellipack)" on the site. No photography
    // supplied yet, so it falls back to the placeholder silhouette.
    code: 'magnus-gmax-iot',
    family: 'magnus',
    name: 'New Magnus GMax',
    sort: 2,
    colours: [MATCHA_GREEN],
    specs: { rangeKm: 142, topSpeedKmph: 65, chargeHours: 5.45 },
    image: 'magnus-gmax-iot',
  },
  {
    code: 'magnus-gmax',
    family: 'magnus',
    name: 'Magnus GMax',
    sort: 3,
    colours: [MATCHA_GREEN, MONSOON_BLUE, CINNAMON_COPPER],
    specs: { rangeKm: 142, topSpeedKmph: 65, chargeHours: 5.45 },
    image: 'magnus-gmax',
  },
  {
    code: 'magnus-neo',
    family: 'magnus',
    name: 'Magnus Neo',
    sort: 4,
    colours: [OCEAN_BLUE, MISTY_MAUVE, BUTTER_YELLOW, MATCHA_GREEN],
    specs: { rangeKm: 125, topSpeedKmph: 60, chargeHours: 5 },
    image: 'magnus-neo',
  },
  {
    code: 'reo-vyb',
    family: 'reo',
    name: 'Reo VYB',
    sort: 5,
    colours: [TEAL, PASTEL_PURPLE, VYB_WHITE, VYB_BLACK],
    specs: { rangeKm: 80, topSpeedKmph: 25, chargeHours: 4 },
    image: 'reo-vyb',
  },
] as const;

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

const MODELS_BY_CODE = new Map(MODELS.map((m) => [m.code, m]));
const REGIONS_BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));
const REGION_BY_STATE = new Map(
  REGIONS.flatMap((r) => r.states.map((s) => [s, r.code] as const)),
);

export function getModel(code: string | null | undefined): Model | null {
  if (!code) return null;
  return MODELS_BY_CODE.get(code) ?? null;
}

export function getRegion(code: string | null | undefined): Region | null {
  if (!code) return null;
  return REGIONS_BY_CODE.get(code) ?? null;
}

/**
 * Prefill guard. `?model=foo` must fall back to no preselection rather than an
 * error — invalid values are dropped silently, per spec 3.
 */
export function isValidModelCode(code: string | null | undefined): boolean {
  return getModel(code) !== null;
}

/** A colour is only valid for the model that offers it. */
export function isValidColourCode(
  modelCode: string | null | undefined,
  colourCode: string | null | undefined,
): boolean {
  const model = getModel(modelCode);
  if (!model || !colourCode) return false;
  return model.colours.some((c) => c.code === colourCode);
}

/** Pincode gives the state, the state gives the region. Inventory is keyed on region. */
export function regionForState(stateCode: string | null | undefined): string | null {
  if (!stateCode) return null;
  return REGION_BY_STATE.get(stateCode) ?? null;
}

export function modelsInFamily(family: string): Model[] {
  return MODELS.filter((m) => m.family === family).sort((a, b) => a.sort - b.sort);
}

/** Families that actually have models, in display order. */
export const ACTIVE_FAMILIES = FAMILIES.filter((f) => modelsInFamily(f.code).length > 0);

/**
 * Region from the first digit of a pincode.
 *
 * India's PIN system encodes a postal zone in the leading digit, so a pincode
 * always says roughly where it is even when it is not in our dealer master.
 *
 *   1  Delhi, Haryana, Punjab, HP, J&K, Chandigarh
 *   2  Uttar Pradesh, Uttarakhand
 *   3  Rajasthan, Gujarat, DD, DNH
 *   4  Maharashtra, MP, Chhattisgarh, Goa
 *   5  Andhra Pradesh, Telangana, Karnataka
 *   6  Tamil Nadu, Kerala, Puducherry
 *   7  West Bengal, Odisha, Assam, North East, Sikkim
 *   8  Bihar, Jharkhand
 *   9  Army Postal Service — no civilian delivery
 *
 * This is a FALLBACK, used only when `pincode_map` has no row. It is what stops
 * a customer in an unmapped pincode seeing "not available" for a scooter we
 * sell perfectly well in their state. The real mapping, once Dealer ops supply
 * it, always wins.
 */
const ZONE_TO_REGION: Record<string, string> = {
  '1': 'north',
  '2': 'north',
  '3': 'west',
  '4': 'west',
  '5': 'south',
  '6': 'south',
  '7': 'east',
  '8': 'east',
};

export function regionForPincodeZone(pincode: string): string | null {
  const zone = pincode.trim()[0];
  if (!zone) return null;
  return ZONE_TO_REGION[zone] ?? null;
}

export const MODEL_CODES: readonly string[] = MODELS.map((m) => m.code);
export const REGION_CODES: readonly string[] = REGIONS.map((r) => r.code);
