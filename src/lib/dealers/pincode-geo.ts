/**
 * One location per pincode, from India Post's post-office directory.
 *
 * The directory lists post offices, several per pincode, and its coordinates
 * are uneven. Measured on 2026-11-02 against 16 pincodes whose real location
 * we know, a plain median per pincode was off by 8 to 56 km for four of them —
 * fatal with a 15 km dealer radius. The faults, and the rule for each:
 *
 *   One office recorded far away (Whitefield 560066: one of its two offices
 *   sits 110 km off, dragging the median 56 km).
 *     -> An office far from its sorting district's centre is ignored, when the
 *        pincode has another office that is not.
 *
 *   Offices that disagree (Andheri West 400053: a sub-office 17 km south).
 *     -> When a pincode's offices are more than SPREAD_KM apart, its head
 *        office decides.
 *
 *   A pincode far out of line with its district, with nothing to say which
 *   office is right.
 *     -> Doubtful: no location is stored. The dealer step then offers the
 *        postal district's dealers, which is a city-sized answer and never a
 *        wrong one, instead of measuring from a wrong point.
 *
 *   Every office of a pincode recorded at the same wrong spot (Salt Lake
 *   700091, 30 km out), or a lone office simply misplaced (Indiranagar 560038,
 *   8 km). No rule can see these.
 *     -> CORRECTIONS: locations checked by hand. Add one whenever a customer's
 *        dealer list is reported wrong.
 *
 * With these rules the 16 known pincodes come out within about 3 km.
 */

export interface Office {
  pincode: string;
  lat: number;
  lng: number;
  /** India Post's head office (OfficeType HO) for the area. */
  headOffice: boolean;
}

export interface PincodeLocation {
  pincode: string;
  lat: number;
  lng: number;
}

export interface CleanedLocations {
  locations: PincodeLocation[];
  /** Pincodes whose location could not be trusted. Stored without one. */
  doubtful: string[];
  /** Offices ignored as far outside their district. */
  officesIgnored: number;
}

/** Hand-checked locations that override the directory. Keep a note of why. */
export const CORRECTIONS: Record<string, { lat: number; lng: number; note: string }> = {
  '560038': { lat: 12.9784, lng: 77.6408, note: 'Indiranagar, Bengaluru: its only office is recorded 8 km west' },
  '700091': { lat: 22.5697, lng: 88.4322, note: 'Salt Lake, Kolkata: all three offices recorded 30 km south-west' },
};

/** An office this far from its sorting district's centre is taken as a typo. */
const OFFICE_OUTLIER_KM = 60;
/** A pincode's offices further apart than this disagree. */
const SPREAD_KM = 5;
/** A pincode this far from its district centre, and FLAG_FACTOR times further than is typical there, is doubtful. */
const FLAG_MIN_KM = 20;
const FLAG_FACTOR = 3;

const INDIA = { latMin: 6, latMax: 37.5, lngMin: 68, lngMax: 97.5 };

function inIndia(lat: number, lng: number): boolean {
  return lat >= INDIA.latMin && lat <= INDIA.latMax && lng >= INDIA.lngMin && lng <= INDIA.lngMax;
}

/**
 * A directory coordinate pair, as a point in India, or null. Fixes the common
 * slip of latitude and longitude in each other's columns.
 */
export function usablePoint(lat: number, lng: number): [number, number] | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (inIndia(lat, lng)) return [lat, lng];
  if (inIndia(lng, lat)) return [lng, lat];
  return null;
}

/** Great-circle distance in km. */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function centreOf(points: { lat: number; lng: number }[]): { lat: number; lng: number } {
  return { lat: median(points.map((p) => p.lat)), lng: median(points.map((p) => p.lng)) };
}

/** The first three digits: India Post's sorting district, roughly a city. */
const districtOf = (pincode: string) => pincode.slice(0, 3);

export function cleanPincodeLocations(
  offices: Office[],
  corrections: Record<string, { lat: number; lng: number }> = CORRECTIONS,
): CleanedLocations {
  const group = <T,>(map: Map<string, T[]>, key: string, item: T) => {
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  };

  const byPincode = new Map<string, Office[]>();
  const byDistrict = new Map<string, Office[]>();
  for (const office of offices) {
    group(byPincode, office.pincode, office);
    group(byDistrict, districtOf(office.pincode), office);
  }
  const districtCentre = new Map([...byDistrict].map(([d, list]) => [d, centreOf(list)]));

  let officesIgnored = 0;
  const located = new Map<string, { lat: number; lng: number }>();

  for (const [pincode, all] of byPincode) {
    const centre = districtCentre.get(districtOf(pincode))!;
    let list = all;

    const near = list.filter((o) => km(centre, o) <= OFFICE_OUTLIER_KM);
    if (near.length > 0 && near.length < list.length) {
      officesIgnored += list.length - near.length;
      list = near;
    }

    let point = centreOf(list);
    const spread = Math.max(...list.map((o) => km(point, o)));
    const heads = list.filter((o) => o.headOffice);
    if (spread > SPREAD_KM && heads.length > 0) point = centreOf(heads);

    located.set(pincode, point);
  }

  // How far a pincode usually sits from its district's centre — a big rural
  // district spreads much wider than a city one, so "too far" is relative.
  const typical = new Map<string, number>();
  const distances = new Map<string, number[]>();
  for (const [pincode, point] of located) {
    const d = districtOf(pincode);
    group(distances, d, km(districtCentre.get(d)!, point));
  }
  for (const [d, list] of distances) typical.set(d, median(list));

  const locations: PincodeLocation[] = [];
  const doubtful: string[] = [];
  for (const [pincode, point] of located) {
    const d = districtOf(pincode);
    const fromCentre = km(districtCentre.get(d)!, point);
    if (!corrections[pincode] && fromCentre > Math.max(FLAG_MIN_KM, FLAG_FACTOR * typical.get(d)!)) {
      doubtful.push(pincode);
      continue;
    }
    locations.push({ pincode, ...(corrections[pincode] ?? point) });
  }

  // A correction stands even for a pincode the directory does not list.
  for (const [pincode, point] of Object.entries(corrections)) {
    if (!located.has(pincode)) locations.push({ pincode, lat: point.lat, lng: point.lng });
  }

  return { locations, doubtful, officesIgnored };
}
