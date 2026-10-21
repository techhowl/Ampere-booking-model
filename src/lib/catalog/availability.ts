import type { PrismaClient } from '@prisma/client';
import { resolvePincode, type ResolvedDealer } from '@/lib/dealers/resolve';
import { findNearbyDealers } from '@/lib/dealers/nearby';
import { MODELS, type Colour } from '@/lib/catalog/catalog';
import { availabilityAcross, STALE_AFTER_DAYS } from '@/lib/inventory/inventory';
import { resolvePrice, toMoneyView, type MoneyView } from '@/lib/pricing/price';

/**
 * The catalog as the buy journey needs it: every model, its colours, its price
 * in this customer's region, and whether we can actually deliver one.
 *
 * Spec 8: "They are never allowed to pay for something we cannot deliver." The
 * availability flag here is what the UI uses to decide whether payment options
 * render at all.
 */

export interface ModelAvailability {
  code: string;
  name: string;
  colours: Colour[];
  /** Null when we have no price for this model in this region. */
  price: {
    exShowroom: MoneyView;
    rtoCharges: MoneyView;
    onRoad: MoneyView;
    /*
     * There is deliberately no emiFrom here.
     *
     * We do not quote instalments. Juspay owns the EMI journey end to end:
     * the customer picks EMI, we redirect, and their page shows the real
     * lenders, tenures and rates. Any figure we computed on this side would be
     * from a placeholder rate table, and a monthly number that disagrees with
     * the one on the payment page is worse than no number at all.
     */
    /** Null means the partial payment option does not render. */
    partial: { mode: string; amount: MoneyView; balance: MoneyView } | null;
  } | null;
  /** Units a customer could buy right now. */
  available: number;
  inStock: boolean;
  /**
   * The stock count has not been touched in over fifteen days. Spec 8: "Stale
   * inventory should announce itself rather than quietly overselling." Surfaced
   * to admin, not to the customer.
   */
  stale: boolean;
  /** Everything needed to sell: a price and at least one unit. */
  purchasable: boolean;
}

/**
 * Without a region we still return the line-up — a customer who has not given a
 * pincode yet should see the scooters, just not prices or stock.
 *
 * `dealerCodes` is the dealers within range of this customer, nearest first.
 * Stock is the sum across them, because any one of them can fulfil: the buy
 * button should stay up while a showroom in range still has a unit, and go
 * down the moment none of them does.
 *
 * An empty list is therefore a complete answer — nothing to sell from here.
 */
export async function buildCatalog(
  prisma: PrismaClient,
  regionCode: string | null,
  dealerCodes: string[] = [],
): Promise<ModelAvailability[]> {
  return Promise.all(
    [...MODELS]
      .sort((a, b) => a.sort - b.sort)
      .map((model) =>
        describeModel(prisma, model.code, model.name, [...model.colours], regionCode, dealerCodes),
      ),
  );
}

export interface PincodeCatalog {
  region: string | null;
  dealer: ResolvedDealer | null;
  models: ModelAvailability[];
  /**
   * A customer outside every region we cover can still be a lead and can
   * still book a test ride; they just cannot be sold to online.
   */
  serviceable: boolean;
}

/**
 * The catalog for one customer: priced in their region, stocked from the
 * dealers within range of their pincode. What GET /api/catalog returns, and
 * what a refreshed page is rendered with.
 */
export async function catalogForPincode(
  prisma: PrismaClient,
  pincode: string | null,
): Promise<PincodeCatalog> {
  let regionCode: string | null = null;
  let dealer: ResolvedDealer | null = null;
  let dealerCodes: string[] = [];

  if (pincode) {
    const location = await resolvePincode(prisma, pincode);
    regionCode = location.regionCode;
    dealer = location.dealer;

    // Only dealers within the radius. Nothing further away can fulfil, so
    // nothing further away may contribute stock.
    const nearby = await findNearbyDealers(prisma, pincode);
    dealerCodes = nearby.dealers.map((d) => d.code);
  }

  return {
    region: regionCode,
    dealer,
    models: await buildCatalog(prisma, regionCode, dealerCodes),
    serviceable: regionCode !== null,
  };
}

async function describeModel(
  prisma: PrismaClient,
  code: string,
  name: string,
  colours: Colour[],
  regionCode: string | null,
  dealerCodes: string[],
): Promise<ModelAvailability> {
  if (!regionCode) {
    return {
      code,
      name,
      colours,
      price: null,
      available: 0,
      inStock: false,
      stale: false,
      purchasable: false,
    };
  }

  const [price, stock] = await Promise.all([
    resolvePrice(prisma, code, regionCode),
    // Everything a dealer in range could sell this customer today.
    availabilityAcross(prisma, code, dealerCodes),
  ]);

  const inStock = stock.total > 0;

  return {
    code,
    name,
    colours,
    price: price
      ? {
          exShowroom: toMoneyView(price.exShowroom),
          rtoCharges: toMoneyView(price.rtoCharges),
          onRoad: toMoneyView(price.onRoad),
          partial: price.partial
            ? {
                mode: price.partial.mode,
                amount: toMoneyView(price.partial.amount),
                balance: toMoneyView(price.partial.balance),
              }
            : null,
        }
      : null,
    available: stock.total,
    inStock,
    stale: stock.stale,
    // No price means no sale, however much stock sits in the warehouse.
    purchasable: inStock && price !== null,
  };
}

export { STALE_AFTER_DAYS };
