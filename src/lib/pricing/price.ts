import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Prices, resolved server-side from price_book.
 *
 * Spec 12, rule 1: "Amounts are computed server-side from price_book. The
 * client sends selections, never money. A client-supplied amount is a trivially
 * exploitable vulnerability."
 *
 * Nothing in this file accepts an amount from anywhere but the database.
 *
 * All arithmetic is Prisma.Decimal. Money in floating point is how a scooter
 * ends up costing 109899.99999999999.
 */

export type PartialMode = 'fixed' | 'percent';

export interface PartialPaymentOption {
  mode: PartialMode;
  /** The configured number: rupees for `fixed`, a percentage for `percent`. */
  value: Prisma.Decimal;
  /** What the customer actually pays now. */
  amount: Prisma.Decimal;
  /** Settled at the dealer. */
  balance: Prisma.Decimal;
}

export interface ResolvedPrice {
  modelCode: string;
  regionCode: string;
  /** The vehicle itself. Juspay's `product_price`. */
  exShowroom: Prisma.Decimal;
  /** Registration and road tax. Juspay's `rto_charges`. */
  rtoCharges: Prisma.Decimal;
  /** What the customer owes in total. Juspay's `total_amount`. */
  onRoad: Prisma.Decimal;
  /**
   * Null means the partial payment option does not render at all. Spec 6: it
   * stays hidden until Ampere decides the amount, and that decision is a number
   * typed into the admin page, not a deploy.
   */
  partial: PartialPaymentOption | null;
  /** Which price_book row this came from, for disputes. */
  effectiveFrom: Date;
}

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/**
 * The price in force right now.
 *
 * price_book is append-only by design — its primary key includes
 * effective_from, so a price change is a new row and the old one survives for
 * any order that referenced it. "The current price" therefore means the newest
 * row that has already taken effect; a row dated in the future is a scheduled
 * change and must not be charged yet.
 */
export async function resolvePrice(
  prisma: PrismaClient,
  modelCode: string,
  regionCode: string,
  asOf: Date = new Date(),
): Promise<ResolvedPrice | null> {
  const row = await prisma.priceBook.findFirst({
    where: { modelCode, regionCode, effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (!row) return null;

  const exShowroom = row.amountTotal;
  const rtoCharges = row.rtoCharges;
  const onRoad = exShowroom.add(rtoCharges);

  return {
    modelCode,
    regionCode,
    exShowroom,
    rtoCharges,
    onRoad,
    partial: computePartial(row.partialMode, row.partialValue, onRoad),
    effectiveFrom: row.effectiveFrom,
  };
}

/**
 * Both null means the option does not render. A mode without a value, or a
 * value without a mode, is a half-finished configuration and is treated the
 * same way — hidden — rather than guessed at.
 */
export function computePartial(
  mode: string | null,
  value: Prisma.Decimal | null,
  onRoad: Prisma.Decimal,
): PartialPaymentOption | null {
  if (!mode || value === null) return null;
  if (mode !== 'fixed' && mode !== 'percent') return null;
  if (value.lte(ZERO)) return null;

  // Percentage is taken on the on-road price, because that is what the
  // customer owes. Worth confirming with Ampere when the amount is decided.
  const raw = mode === 'fixed' ? value : onRoad.mul(value).div(HUNDRED);

  // Round to whole rupees. A deposit of 21,990.37 looks like a bug to a
  // customer, and paise serve no purpose on a booking amount.
  const amount = raw.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  // A deposit at or above the full price is not a deposit. Rather than quietly
  // charging the full amount under a "partial" label, hide the option.
  if (amount.lte(ZERO) || amount.gte(onRoad)) return null;

  return { mode, value, amount, balance: onRoad.sub(amount) };
}

/**
 * The lowest current ex-showroom price for a model across every region.
 *
 * The reference page this replaces shows a price before the customer has typed
 * anything, and it is right to: making someone give a name, a number and an OTP
 * before they learn what a scooter costs is a conversion problem, not just a
 * layout one.
 *
 * Labelled "onwards" and ex-showroom, because the exact on-road figure depends
 * on a region we do not know yet. It is replaced by the real one the moment a
 * pincode is entered.
 */
export async function resolveIndicativePrice(
  prisma: PrismaClient,
  modelCode: string,
  asOf: Date = new Date(),
): Promise<Prisma.Decimal | null> {
  const rows = await prisma.priceBook.findMany({
    where: { modelCode, effectiveFrom: { lte: asOf } },
    orderBy: [{ regionCode: 'asc' }, { effectiveFrom: 'desc' }],
  });

  // One row per region: the newest that has taken effect.
  const currentByRegion = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    if (!currentByRegion.has(row.regionCode)) {
      currentByRegion.set(row.regionCode, row.amountTotal);
    }
  }

  let lowest: Prisma.Decimal | null = null;
  for (const amount of currentByRegion.values()) {
    if (!lowest || amount.lt(lowest)) lowest = amount;
  }
  return lowest;
}

/* ------------------------------------------------------------------ */

/** Money as the client should see it: a number of rupees and a formatted string. */
export interface MoneyView {
  amount: number;
  display: string;
}

export function toMoneyView(value: Prisma.Decimal): MoneyView {
  return {
    amount: value.toNumber(),
    display: formatRupees(value),
  };
}

/** Indian digit grouping: 1,09,900 rather than 109,900. */
export function formatRupees(value: Prisma.Decimal | number): string {
  const n = typeof value === 'number' ? value : value.toNumber();
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}
