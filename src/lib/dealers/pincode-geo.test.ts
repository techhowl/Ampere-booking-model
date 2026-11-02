import { describe, expect, it } from 'vitest';
import { cleanPincodeLocations, km, usablePoint, type Office } from './pincode-geo';

/**
 * Each case is a fault seen in India Post's directory on 2026-11-02, with its
 * real coordinates, set among enough ordinary Bengaluru pincodes to give the
 * sorting district (560) a centre.
 */

const office = (pincode: string, lat: number, lng: number, headOffice = false): Office => ({
  pincode,
  lat,
  lng,
  headOffice,
});

/** Ordinary city pincodes within a few km of central Bengaluru. */
const BENGALURU = [
  office('560001', 12.9762, 77.6033),
  office('560002', 12.9634, 77.5855),
  office('560003', 12.9982, 77.5684),
  office('560004', 12.9422, 77.5745),
  office('560005', 12.9969, 77.6153),
  office('560008', 12.9719, 77.6412),
  office('560011', 12.9299, 77.5826),
  office('560034', 12.9352, 77.6245),
];

const clean = (offices: Office[], corrections: Record<string, { lat: number; lng: number }> = {}) =>
  cleanPincodeLocations([...BENGALURU, ...offices], corrections);
const where = (result: ReturnType<typeof clean>, pincode: string) =>
  result.locations.find((l) => l.pincode === pincode);

describe('cleanPincodeLocations', () => {
  it('puts an ordinary pincode at the median of its offices', () => {
    const result = clean([office('560102', 12.912, 77.637), office('560102', 12.914, 77.64), office('560102', 12.95, 77.7)]);
    expect(where(result, '560102')).toEqual({ pincode: '560102', lat: 12.914, lng: 77.64 });
    expect(result.doubtful).toEqual([]);
  });

  it('ignores an office recorded far outside its district (Whitefield, 560066)', () => {
    const result = clean([office('560066', 12.1519167, 77.1308056), office('560066', 12.987244, 77.732161)]);
    const whitefield = where(result, '560066')!;
    expect(km(whitefield, { lat: 12.97, lng: 77.75 })).toBeLessThan(3);
    expect(result.officesIgnored).toBe(1);
  });

  it('lets the head office decide when offices disagree (Andheri West, 400053)', () => {
    const mumbai = [
      office('400001', 18.9388, 72.8354),
      office('400050', 19.0596, 72.8295),
      office('400058', 19.1197, 72.8468),
      office('400069', 19.1136, 72.8697),
    ];
    const result = cleanPincodeLocations([
      ...mumbai,
      office('400053', 19.1238889, 72.8307778, true),
      office('400053', 18.96775, 72.8216944),
    ]);
    expect(km(where(result, '400053')!, { lat: 19.136, lng: 72.83 })).toBeLessThan(2);
  });

  it('stores no location for a pincode far out of line with its district', () => {
    const result = clean([office('560099', 13.45, 77.1)]);
    expect(result.doubtful).toEqual(['560099']);
    expect(where(result, '560099')).toBeUndefined();
  });

  it('does not hold a wide rural district to city standards', () => {
    // Anantapur's sorting district spans well over 100 km.
    const rural = [
      office('515001', 14.68, 77.6),
      office('515101', 14.1, 77.7),
      office('515201', 14.9, 77.0),
      office('515301', 13.9, 77.2),
      office('515401', 15.1, 77.4),
      office('515631', 14.5689, 77.85624),
    ];
    expect(cleanPincodeLocations(rural).doubtful).toEqual([]);
  });

  it('takes a hand-checked correction over the directory (Indiranagar, 560038)', () => {
    const result = clean([office('560038', 12.9447222, 77.5740278)], {
      '560038': { lat: 12.9784, lng: 77.6408 },
    });
    expect(where(result, '560038')).toEqual({ pincode: '560038', lat: 12.9784, lng: 77.6408 });
  });

  it('never marks a corrected pincode doubtful, and stores one the directory lacks', () => {
    const result = clean([office('560099', 13.45, 77.1)], {
      '560099': { lat: 13.0, lng: 77.6 },
      '560300': { lat: 12.95, lng: 77.6 },
    });
    expect(result.doubtful).toEqual([]);
    expect(where(result, '560099')).toEqual({ pincode: '560099', lat: 13.0, lng: 77.6 });
    expect(where(result, '560300')).toEqual({ pincode: '560300', lat: 12.95, lng: 77.6 });
  });

  it('ships corrections for the two known-bad pincodes', async () => {
    const { CORRECTIONS } = await import('./pincode-geo');
    expect(Object.keys(CORRECTIONS).sort()).toEqual(['560038', '700091']);
  });
});

describe('usablePoint', () => {
  it('keeps a point in India, swaps one with the columns reversed, drops the rest', () => {
    expect(usablePoint(12.97, 77.59)).toEqual([12.97, 77.59]);
    expect(usablePoint(77.59, 12.97)).toEqual([12.97, 77.59]);
    expect(usablePoint(0, 0)).toBeNull();
    expect(usablePoint(51.5, -0.12)).toBeNull();
    expect(usablePoint(Number.NaN, 77)).toBeNull();
  });
});
