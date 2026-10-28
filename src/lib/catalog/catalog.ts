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
 * The line-up and colours follow ampere-electric.com: four models, each with
 * the colours, names and hex values on its own page there. Specs are
 * PLACEHOLDER and need confirming against Ampere's published figures. Region
 * membership is open item #2 (Sales).
 */

export interface Colour {
  code: string;
  name: string;
  /** Swatch shown in the picker. */
  hex: string;
  /**
   * The second tone of a two-tone paint. Its swatch is split diagonally, as on
   * ampere-electric.com — see swatchBackground().
   */
  hex2?: string;
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
 * the models beneath it. Three families, six models — two of them the
 * Intellipack versions of the Nexus EX+ and Magnus GMax.
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
   * Photo folder under /public/models/. Each colour has its own run of angles,
   * `/models/<image>/<colour>-<n>.webp` with n from 1 — see `angles` and
   * photoSrc(). Two models may share a folder: the Intellipack Nexus is
   * photographed as the Nexus EX+.
   */
  image: string;
  /** How many angles each colour is photographed from, by colour code. */
  angles: Readonly<Record<string, number>>;
  /**
   * Which versions of a scooter belong together. The Nexus EX+ and the Nexus
   * EX+ Intellipack share a group; the variant layout shows the group as one
   * card with `label` as its version chips. A scooter sold in one version is
   * a group of one.
   */
  variant: { group: string; groupName: string; label: string };
  /** Its page on ampere-electric.com. */
  pageUrl: string;
  /**
   * What "Brochure" downloads: ours under /brochures, or the main site's
   * leaflet. Ours are named as the customer should see them saved — Vercel
   * sends the file's own name with it, and browsers prefer that to ours.
   */
  brochureUrl: string;
  /** The offers strip on its card. PLACEHOLDER until Marketing sends one per scooter. */
  offer: string;
  /**
   * Other names a link may use for this model — the slug of its page on
   * ampere-electric.com where that differs from the code. Lets the main site
   * link with its own page names (?model=gmax) and lets a referring product
   * page be recognised.
   */
  aliases: readonly string[];
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
/* Models — the line-up on ampere-electric.com                        */
/* ------------------------------------------------------------------ */

/*
 * Colours are per model, because they are. Names, order and hex values are
 * exactly those in each model's colour data on ampere-electric.com
 * (/nexus-ex-plus, /nexus-ex-plus-intellipack, /gmax, /new-magnus-gmax-iot,
 * /magnus-neo, /reovyb), so a swatch here is the swatch the customer just saw
 * there, and the angles are the photographs that page shows. When the main
 * site changes a colour, change it here to match.
 */

const CARBON_KNIGHT: Colour = { code: 'carbon-knight', name: 'Carbon Knight', hex: '#767876' };
const STEEL_GREY: Colour = { code: 'steel-grey', name: 'Steel Grey', hex: '#839FAB' };

const MATCHA_GREEN: Colour = {
  code: 'matcha-green',
  name: 'Matcha Green',
  hex: '#628C69',
  hex2: '#EAE9D5',
};
// Only the Intellipack GMax comes in Monsoon Blue.
const MONSOON_BLUE: Colour = {
  code: 'monsoon-blue',
  name: 'Monsoon Blue',
  hex: '#465C78',
  hex2: '#EAE9D5',
};
const CINNAMON_COPPER: Colour = {
  code: 'cinnamon-copper',
  name: 'Cinnamon Copper',
  hex: '#83483E',
  hex2: '#EAE9D5',
};

const OCEAN_BLUE: Colour = { code: 'ocean-blue', name: 'Ocean Blue', hex: '#082A5A', hex2: '#156DCF' };
const TURMERIC_LATTE: Colour = {
  code: 'turmeric-latte',
  name: 'Turmeric Latte',
  hex: '#E7CC7C',
  hex2: '#EAE9D5',
};
const MISTY_MAUVE: Colour = { code: 'misty-mauve', name: 'Misty Mauve', hex: '#BBA9B5', hex2: '#8F8A9F' };

const PASTEL_PURPLE: Colour = { code: 'pastel-purple', name: 'Pastel Purple', hex: '#AD8DBC' };
const AQUA_METALLIC: Colour = { code: 'aqua-metallic', name: 'Aqua Metallic', hex: '#009FAA' };
const DARK_GREY: Colour = { code: 'dark-grey', name: 'Dark Grey', hex: '#131313' };

/**
 * A swatch's CSS background. Two-tone paints are split diagonally, half and
 * half, exactly as the main site draws them.
 */
export function swatchBackground(colour: Pick<Colour, 'hex' | 'hex2'>): string {
  return colour.hex2
    ? `linear-gradient(135deg, ${colour.hex} 0 50%, ${colour.hex2} 50% 100%)`
    : colour.hex;
}

export const MAIN_SITE = 'https://ampere-electric.com';

/** Offer copy until Marketing supplies one per scooter. */
const PLACEHOLDER_OFFER =
  'Benefits up to ₹5,000. Additional offers on Flipkart and Amazon. Visit the dealership to know more.';

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
    angles: { 'carbon-knight': 8, 'steel-grey': 8 },
    variant: { group: 'nexus-ex-plus', groupName: 'Nexus EX+', label: 'Standard' },
    pageUrl: `${MAIN_SITE}/nexus-ex-plus`,
    brochureUrl: '/brochures/ampere-nexus-ex-plus-brochure.pdf',
    offer: PLACEHOLDER_OFFER,
    aliases: ['nexus'],
  },
  {
    code: 'nexus-ex-plus-intellipack',
    family: 'nexus',
    name: 'Nexus EX+ Intellipack',
    sort: 2,
    colours: [CARBON_KNIGHT, STEEL_GREY],
    specs: { rangeKm: 136, topSpeedKmph: 93, chargeHours: 3.1 },
    // Photographed as the Nexus EX+ — the main site uses the same pictures.
    image: 'nexus-ex-plus',
    angles: { 'carbon-knight': 8, 'steel-grey': 8 },
    variant: { group: 'nexus-ex-plus', groupName: 'Nexus EX+', label: 'Intellipack' },
    pageUrl: `${MAIN_SITE}/nexus-ex-plus-intellipack`,
    brochureUrl: '/brochures/ampere-nexus-ex-plus-brochure.pdf',
    offer: PLACEHOLDER_OFFER,
    aliases: [],
  },
  {
    code: 'magnus-gmax',
    family: 'magnus',
    name: 'Magnus GMax',
    sort: 3,
    colours: [MATCHA_GREEN, CINNAMON_COPPER],
    specs: { rangeKm: 142, topSpeedKmph: 65, chargeHours: 5.45 },
    image: 'magnus-gmax',
    angles: { 'matcha-green': 4, 'cinnamon-copper': 8 },
    variant: { group: 'magnus-gmax', groupName: 'Magnus GMax', label: 'Standard' },
    pageUrl: `${MAIN_SITE}/gmax`,
    brochureUrl: '/brochures/ampere-magnus-gmax-brochure.pdf',
    offer: PLACEHOLDER_OFFER,
    // ampere-electric.com/gmax
    aliases: ['gmax'],
  },
  {
    code: 'magnus-gmax-intellipack',
    family: 'magnus',
    name: 'Magnus GMax Intellipack',
    sort: 4,
    colours: [MATCHA_GREEN, MONSOON_BLUE, CINNAMON_COPPER],
    specs: { rangeKm: 142, topSpeedKmph: 65, chargeHours: 5.45 },
    image: 'magnus-gmax-intellipack',
    angles: { 'matcha-green': 7, 'monsoon-blue': 7, 'cinnamon-copper': 8 },
    variant: { group: 'magnus-gmax', groupName: 'Magnus GMax', label: 'Intellipack' },
    pageUrl: `${MAIN_SITE}/new-magnus-gmax-iot`,
    brochureUrl: '/brochures/ampere-magnus-gmax-brochure.pdf',
    offer: PLACEHOLDER_OFFER,
    // ampere-electric.com/new-magnus-gmax-iot
    aliases: ['new-magnus-gmax-iot', 'magnus-gmax-iot'],
  },
  {
    code: 'magnus-neo',
    family: 'magnus',
    name: 'Magnus Neo',
    sort: 5,
    colours: [OCEAN_BLUE, TURMERIC_LATTE, MISTY_MAUVE],
    specs: { rangeKm: 125, topSpeedKmph: 60, chargeHours: 5 },
    image: 'magnus-neo',
    angles: { 'ocean-blue': 5, 'turmeric-latte': 5, 'misty-mauve': 5 },
    variant: { group: 'magnus-neo', groupName: 'Magnus Neo', label: 'Standard' },
    pageUrl: `${MAIN_SITE}/magnus-neo`,
    brochureUrl: '/brochures/ampere-magnus-neo-brochure.pdf',
    offer: PLACEHOLDER_OFFER,
    aliases: [],
  },
  {
    code: 'reo-vyb',
    family: 'reo',
    name: 'Reo VYB',
    sort: 6,
    colours: [PASTEL_PURPLE, AQUA_METALLIC, DARK_GREY],
    specs: { rangeKm: 80, topSpeedKmph: 25, chargeHours: 4 },
    image: 'reo-vyb',
    angles: { 'pastel-purple': 8, 'aqua-metallic': 7, 'dark-grey': 8 },
    variant: { group: 'reo-vyb', groupName: 'Reo VYB', label: 'Standard' },
    pageUrl: `${MAIN_SITE}/reovyb`,
    // No brochure of our own yet; the main site's leaflet until one arrives.
    brochureUrl: `${MAIN_SITE}/storage/downloadables/reo-vyb-leaflet.pdf`,
    offer: PLACEHOLDER_OFFER,
    // ampere-electric.com/reovyb
    aliases: ['reovyb'],
  },
] as const;

/** The photograph of one colour from one angle. `angle` counts from 0. */
export function photoSrc(model: Model, colourCode: string, angle = 0): string {
  return `/models/${model.image}/${colourCode}-${angle + 1}.webp`;
}

/** How many angles a colour has been photographed from; at least one. */
export function angleCount(model: Model, colourCode: string | null | undefined): number {
  return Math.max(1, (colourCode && model.angles[colourCode]) || 1);
}

/** The versions of one scooter, Standard first. */
export function modelsInGroup(group: string): Model[] {
  return MODELS.filter((m) => m.variant.group === group).sort((a, b) => a.sort - b.sort);
}

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

const MODELS_BY_NAME = new Map(
  MODELS.flatMap((m) => [m.code, ...m.aliases].map((name) => [name.toLowerCase(), m] as const)),
);

/**
 * A model by its code or any of its aliases, case-insensitively. For reading
 * links and page paths; everything internal uses the code and getModel().
 */
export function findModel(name: string | null | undefined): Model | null {
  if (!name) return null;
  return MODELS_BY_NAME.get(name.trim().toLowerCase()) ?? null;
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
