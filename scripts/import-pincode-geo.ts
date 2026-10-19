import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Load pincode coordinates into pincode_geo.
 *
 *   pnpm db:import-pincodes path/to/pincodes.csv
 *
 * Built for India Post's "All India Pincode Directory" (data.gov.in, Open
 * Government Data Licence). Any CSV works if it has columns named pincode,
 * latitude and longitude; other columns are ignored.
 *
 * The directory lists post offices, not pincodes — several rows per pincode,
 * and its coordinates are uneven: "NA", zeros, values outside India, latitude
 * and longitude swapped. So each pincode gets the median of its usable rows,
 * which one bad office cannot drag across the state.
 *
 * Idempotent. Re-running with a newer file updates what changed.
 */

const INDIA = { latMin: 6, latMax: 37.5, lngMin: 68, lngMax: 97.5 };
const BATCH = 1000;

function inIndia(lat: number, lng: number): boolean {
  return lat >= INDIA.latMin && lat <= INDIA.latMax && lng >= INDIA.lngMin && lng <= INDIA.lngMax;
}

/** One CSV line into fields. Handles quoted fields and doubled quotes. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: pnpm db:import-pincodes <path-to-csv>');
    process.exit(1);
  }

  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });

  let header: string[] | null = null;
  let col = { pincode: -1, lat: -1, lng: -1 };
  const points = new Map<string, { lat: number[]; lng: number[] }>();
  let rows = 0;
  let unusable = 0;

  for await (const line of lines) {
    if (!line.trim()) continue;
    const fields = splitCsvLine(line.replace(/^﻿/, ''));

    if (!header) {
      header = fields.map((f) => f.toLowerCase());
      col = {
        pincode: header.indexOf('pincode'),
        lat: header.indexOf('latitude'),
        lng: header.indexOf('longitude'),
      };
      if (col.pincode < 0 || col.lat < 0 || col.lng < 0) {
        console.error(
          `Expected columns pincode, latitude, longitude. Found: ${header.join(', ')}`,
        );
        process.exit(1);
      }
      continue;
    }

    rows++;
    const pincode = fields[col.pincode] ?? '';
    let lat = Number(fields[col.lat]);
    let lng = Number(fields[col.lng]);

    if (!/^[1-9]\d{5}$/.test(pincode) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      unusable++;
      continue;
    }
    // A common slip in the directory: the two columns the wrong way round.
    if (!inIndia(lat, lng) && inIndia(lng, lat)) [lat, lng] = [lng, lat];
    if (!inIndia(lat, lng)) {
      unusable++;
      continue;
    }

    const entry = points.get(pincode) ?? { lat: [], lng: [] };
    entry.lat.push(lat);
    entry.lng.push(lng);
    points.set(pincode, entry);
  }

  const prisma = new PrismaClient();
  const all = [...points.entries()].map(([pincode, p]) => ({
    pincode,
    lat: median(p.lat),
    lng: median(p.lng),
  }));

  try {
    for (let i = 0; i < all.length; i += BATCH) {
      const batch = all.slice(i, i + BATCH);
      await prisma.$executeRaw`
        INSERT INTO pincode_geo (pincode, lat, lng)
        VALUES ${Prisma.join(batch.map((r) => Prisma.sql`(${r.pincode}, ${r.lat}, ${r.lng})`))}
        ON CONFLICT (pincode) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng
      `;
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`Read ${rows} rows, ${unusable} without usable coordinates.`);
  console.log(`Loaded ${all.length} pincodes into pincode_geo.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
