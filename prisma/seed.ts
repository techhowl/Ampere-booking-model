import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { MODELS, REGIONS } from '../src/lib/catalog/catalog';

/**
 * Placeholder seed data.
 *
 * Everything here stands in for data we do not have yet:
 *   - dealers and pincode mapping - open item #4 (Dealer ops)
 *   - region definitions          - open item #2 (Sales)
 *   - prices                      - open item #5 (Finance)
 *
 * Idempotent: safe to run repeatedly. `pnpm db:reset` for a clean slate.
 */

const prisma = new PrismaClient();

/**
 * price_book's primary key includes effective_from, which defaults to now().
 * Seeding with the default would stack a new price row on every run and the
 * "current price" query would keep finding a different one. Pin it instead.
 */
const SEED_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z');

const SEEDED_BY = 'seed';

/** Spec 8: "a number in each cell", default 15. */
const UNITS_PER_MODEL_PER_REGION = 15;

/* ------------------------------------------------------------------ */
/* Dealers - PLACEHOLDER                                               */
/* ------------------------------------------------------------------ */

interface SeedDealer {
  dealerCode: string;
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  homeServiceable: boolean;
}

const DEALERS: SeedDealer[] = [
  // North
  {
    dealerCode: 'AMP-N-001',
    name: 'Ampere Connaught Place',
    phone: '+911140000001',
    address: 'Block A, Connaught Place, New Delhi 110001',
    lat: 28.6315,
    lng: 77.2167,
    homeServiceable: true,
  },
  {
    dealerCode: 'AMP-N-002',
    name: 'Ampere Jaipur Tonk Road',
    phone: '+911410000002',
    address: 'Tonk Road, Jaipur 302001',
    lat: 26.8894,
    lng: 75.8064,
    homeServiceable: false,
  },
  // West
  {
    dealerCode: 'AMP-W-001',
    name: 'Ampere Andheri West',
    phone: '+912240000003',
    address: 'Link Road, Andheri West, Mumbai 400053',
    lat: 19.1364,
    lng: 72.8296,
    homeServiceable: true,
  },
  {
    dealerCode: 'AMP-W-002',
    name: 'Ampere Ahmedabad SG Highway',
    phone: '+917940000004',
    address: 'SG Highway, Ahmedabad 380015',
    lat: 23.0301,
    lng: 72.5101,
    homeServiceable: false,
  },
  // South
  {
    dealerCode: 'AMP-S-001',
    name: 'Ampere Indiranagar',
    phone: '+918040000005',
    address: '100 Feet Road, Indiranagar, Bengaluru 560038',
    lat: 12.9784,
    lng: 77.6408,
    homeServiceable: true,
  },
  {
    dealerCode: 'AMP-S-002',
    name: 'Ampere Chennai Anna Salai',
    phone: '+914440000006',
    address: 'Anna Salai, Chennai 600002',
    lat: 13.0604,
    lng: 80.2496,
    homeServiceable: true,
  },
  // East
  {
    dealerCode: 'AMP-E-001',
    name: 'Ampere Salt Lake',
    phone: '+913340000007',
    address: 'Sector V, Salt Lake, Kolkata 700091',
    lat: 22.5697,
    lng: 88.4322,
    homeServiceable: false,
  },
  {
    dealerCode: 'AMP-E-002',
    name: 'Ampere Bhubaneswar Patia',
    phone: '+916740000008',
    address: 'Patia, Bhubaneswar 751024',
    lat: 20.3549,
    lng: 85.8197,
    homeServiceable: false,
  },
];

/* ------------------------------------------------------------------ */
/* Pincodes - PLACEHOLDER                                              */
/* ------------------------------------------------------------------ */

interface SeedPincode {
  pincode: string;
  stateCode: string;
  regionCode: string;
  dealerCode: string;
}

const PINCODES: SeedPincode[] = [
  // North
  { pincode: '110001', stateCode: 'DL', regionCode: 'north', dealerCode: 'AMP-N-001' },
  { pincode: '122001', stateCode: 'HR', regionCode: 'north', dealerCode: 'AMP-N-001' },
  { pincode: '201301', stateCode: 'UP', regionCode: 'north', dealerCode: 'AMP-N-001' },
  { pincode: '302001', stateCode: 'RJ', regionCode: 'north', dealerCode: 'AMP-N-002' },
  // West
  { pincode: '400001', stateCode: 'MH', regionCode: 'west', dealerCode: 'AMP-W-001' },
  { pincode: '411001', stateCode: 'MH', regionCode: 'west', dealerCode: 'AMP-W-001' },
  { pincode: '380001', stateCode: 'GJ', regionCode: 'west', dealerCode: 'AMP-W-002' },
  { pincode: '452001', stateCode: 'MP', regionCode: 'west', dealerCode: 'AMP-W-002' },
  // South
  { pincode: '560001', stateCode: 'KA', regionCode: 'south', dealerCode: 'AMP-S-001' },
  { pincode: '560038', stateCode: 'KA', regionCode: 'south', dealerCode: 'AMP-S-001' },
  { pincode: '600001', stateCode: 'TN', regionCode: 'south', dealerCode: 'AMP-S-002' },
  { pincode: '682001', stateCode: 'KL', regionCode: 'south', dealerCode: 'AMP-S-002' },
  // East
  { pincode: '700001', stateCode: 'WB', regionCode: 'east', dealerCode: 'AMP-E-001' },
  { pincode: '700091', stateCode: 'WB', regionCode: 'east', dealerCode: 'AMP-E-001' },
  { pincode: '751001', stateCode: 'OD', regionCode: 'east', dealerCode: 'AMP-E-002' },
  { pincode: '800001', stateCode: 'BR', regionCode: 'east', dealerCode: 'AMP-E-002' },
];

/* ------------------------------------------------------------------ */
/* Prices - PLACEHOLDER, pending Finance (open item #5)                */
/* ------------------------------------------------------------------ */

/** Indicative ex-showroom, in rupees. */
const BASE_PRICE: Record<string, number> = {
  // Published ex-showroom prices, from each model's page on ampere-electric.com.
  // Uniform across states on the site today; price_book still keys on region so
  // Finance can vary them later without a code change.
  'nexus-ex-plus': 129999,
  'magnus-gmax-iot': 109999,
  'magnus-gmax': 102999,
  'magnus-neo': 90999,
  'reo-vyb': 71999,
};

/**
 * Registration and road tax, as a fraction of ex-showroom. Invented, and a
 * placeholder twice over: the real figure varies by state, not by region, and
 * Finance has not supplied any of it (open item #5).
 */
const RTO_RATE = 0.1;

/**
 * PLACEHOLDER booking amount so the buy journey can be exercised end to end.
 *
 * Open item #1: Ampere and Sales have not decided between a flat token and a
 * percentage of ex-showroom. This seeds a flat ₹5,000 purely so the flow is
 * clickable; the moment the real figure arrives it is one UPDATE on price_book,
 * not a deploy.
 */
const SEED_PARTIAL_MODE = 'fixed';
const SEED_PARTIAL_VALUE = 5000;

/** Stand-in for regional levies and logistics. Invented. */
const REGION_DELTA: Record<string, number> = {
  north: 0,
  west: 1500,
  south: 2000,
  east: 2500,
};

/* ------------------------------------------------------------------ */

async function seedDealers(): Promise<number> {
  for (const d of DEALERS) {
    await prisma.dealer.upsert({
      where: { dealerCode: d.dealerCode },
      create: { ...d, active: true },
      update: { ...d, active: true },
    });
  }
  return DEALERS.length;
}

async function seedPincodes(): Promise<number> {
  for (const p of PINCODES) {
    await prisma.pincodeMap.upsert({
      where: { pincode: p.pincode },
      create: p,
      update: p,
    });
  }
  return PINCODES.length;
}

async function seedPriceBook(): Promise<number> {
  let count = 0;
  for (const model of MODELS) {
    const base = BASE_PRICE[model.code];
    if (base === undefined) {
      throw new Error(`No seed price for model "${model.code}" - add one to BASE_PRICE.`);
    }

    for (const region of REGIONS) {
      const delta = REGION_DELTA[region.code] ?? 0;
      const amountTotal = new Prisma.Decimal(base + delta);
      const rtoCharges = amountTotal.mul(RTO_RATE).toDecimalPlaces(2);

      await prisma.priceBook.upsert({
        where: {
          modelCode_regionCode_effectiveFrom: {
            modelCode: model.code,
            regionCode: region.code,
            effectiveFrom: SEED_EFFECTIVE_FROM,
          },
        },
        create: {
          modelCode: model.code,
          regionCode: region.code,
          amountTotal,
          rtoCharges,
          effectiveFrom: SEED_EFFECTIVE_FROM,
          // Spec 6: both null hides the option entirely. Seeded with a
          // placeholder so the journey is testable — see SEED_PARTIAL_VALUE.
          partialMode: SEED_PARTIAL_MODE,
          partialValue: new Prisma.Decimal(SEED_PARTIAL_VALUE),
        },
        update: {
          amountTotal,
          rtoCharges,
          partialMode: SEED_PARTIAL_MODE,
          partialValue: new Prisma.Decimal(SEED_PARTIAL_VALUE),
        },
      });
      count++;
    }
  }
  return count;
}

async function seedInventory(): Promise<number> {
  let count = 0;
  for (const model of MODELS) {
    for (const region of REGIONS) {
      await prisma.inventory.upsert({
        where: {
          modelCode_regionCode: { modelCode: model.code, regionCode: region.code },
        },
        create: {
          modelCode: model.code,
          regionCode: region.code,
          unitsTotal: UNITS_PER_MODEL_PER_REGION,
          unitsReserved: 0,
          updatedBy: SEEDED_BY,
        },
        // unitsReserved is deliberately left alone - re-running the seed must
        // not wipe a hold belonging to a checkout that is in flight.
        update: {
          unitsTotal: UNITS_PER_MODEL_PER_REGION,
          updatedAt: new Date(),
          updatedBy: SEEDED_BY,
        },
      });
      count++;
    }
  }
  return count;
}

/**
 * Remove price and stock rows for models the catalog no longer lists.
 *
 * The line-up has been corrected twice against ampere-electric.com, and a
 * stale price row is worse than a missing one: it is a real amount, for a
 * model nobody can buy, sitting in the table the order route reads.
 */
async function pruneRetiredModels(): Promise<number> {
  const live = MODELS.map((m) => m.code);

  const [prices, stock, audit] = await Promise.all([
    prisma.priceBook.deleteMany({ where: { modelCode: { notIn: live } } }),
    prisma.inventory.deleteMany({ where: { modelCode: { notIn: live } } }),
    prisma.inventoryAudit.deleteMany({ where: { modelCode: { notIn: live } } }),
  ]);

  return prices.count + stock.count + audit.count;
}

async function main(): Promise<void> {
  console.log('Seeding placeholder data...\n');

  const pruned = await pruneRetiredModels();
  if (pruned > 0) console.log(`  pruned       ${pruned} rows for retired models`);

  const dealers = await seedDealers();
  console.log(`  dealers      ${dealers}`);

  const pincodes = await seedPincodes();
  console.log(`  pincodes     ${pincodes}`);

  const prices = await seedPriceBook();
  console.log(`  price_book   ${prices}  (${MODELS.length} models x ${REGIONS.length} regions)`);

  const inventory = await seedInventory();
  console.log(
    `  inventory    ${inventory}  (${UNITS_PER_MODEL_PER_REGION} units per model per region)`,
  );

  console.log('\nDone. Dealers, pincodes, regions and prices are all placeholders.');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
