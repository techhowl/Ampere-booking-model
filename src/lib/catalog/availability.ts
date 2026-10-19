import type { PrismaClient } from '@prisma/client';
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
