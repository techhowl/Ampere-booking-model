import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Prisma, PrismaClient } from '@prisma/client';
import { cleanPincodeLocations, usablePoint, type Office } from '../src/lib/dealers/pincode-geo';

/**
 * Load pincode coordinates into pincode_geo.
 *
 *   pnpm db:import-pincodes path/to/pincodes.csv
 *
 * Built for India Post's "All India Pincode Directory" with latitude and
 * longitude (data.gov.in, Government Open Data Licence — India; attribution:
 * Department of Posts). Any CSV works if it has columns named pincode,
 * latitude and longitude; an OfficeType column, if present, marks head offices.
 *
 * The directory lists post offices, not pincodes, and its coordinates are
 * uneven. How each pincode's one location is chosen — and when none is — is in
 * src/lib/dealers/pincode-geo.ts, with the faults that shaped it.
 *
 * Idempotent. Re-running with a newer file updates what changed, and clears
 * any pincode that has become doubtful.
 */

const BATCH = 1000;

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

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: pnpm db:import-pincodes <path-to-csv>');
    process.exit(1);
  }

  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });

  let header: string[] | null = null;
  let col = { pincode: -1, lat: -1, lng: -1, type: -1 };
  const offices: Office[] = [];
  let rows = 0;
  let unusable = 0;

  for await (const line of lines) {
    if (!line.trim()) continue;
    const fields = splitCsvLine(line.replace(/^\uFEFF/, ''));

    if (!header) {
      header = fields.map((f) => f.toLowerCase());
      col = {
        pincode: header.indexOf('pincode'),
        lat: header.indexOf('latitude'),
        lng: header.indexOf('longitude'),
        type: header.indexOf('officetype'),
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
    const point = usablePoint(Number(fields[col.lat]), Number(fields[col.lng]));
    if (!/^[1-9]\d{5}$/.test(pincode) || !point) {
      unusable++;
      continue;
    }
    const type = col.type >= 0 ? (fields[col.type] ?? '').toUpperCase().replace(/\./g, '') : '';
    offices.push({ pincode, lat: point[0], lng: point[1], headOffice: type === 'HO' });
  }

  const { locations, doubtful, officesIgnored } = cleanPincodeLocations(offices);

  const prisma = new PrismaClient();
  try {
    for (let i = 0; i < locations.length; i += BATCH) {
      const batch = locations.slice(i, i + BATCH);
      await prisma.$executeRaw`
        INSERT INTO pincode_geo (pincode, lat, lng)
        VALUES ${Prisma.join(batch.map((r) => Prisma.sql`(${r.pincode}, ${r.lat}, ${r.lng})`))}
        ON CONFLICT (pincode) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng
      `;
    }
    // A doubtful pincode keeps no location, so the dealer step falls back to
    // its postal district rather than measuring from a wrong point.
    let cleared = 0;
    for (let i = 0; i < doubtful.length; i += BATCH) {
      cleared += await prisma.pincodeGeo.deleteMany({ where: { pincode: { in: doubtful.slice(i, i + BATCH) } } }).then((r) => r.count);
    }
    console.log(`Read ${rows} rows, ${unusable} without usable coordinates, ${officesIgnored} offices ignored as far outside their district.`);
    console.log(`Loaded ${locations.length} pincodes into pincode_geo.`);
    console.log(`${doubtful.length} pincodes doubtful, stored without a location${cleared ? ` (${cleared} cleared)` : ''}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
