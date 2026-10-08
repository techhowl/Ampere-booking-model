import type { PrismaClient } from '@prisma/client';
import { MODELS, type Colour } from '@/lib/catalog/catalog';
import { getAvailable, STALE_AFTER_DAYS } from '@/lib/inventory/inventory';
import { formatRupees, resolvePrice, toMoneyView, type MoneyView } from '@/lib/pricing/price';
import { MIN_DOWN_PAYMENT_RATIO, lowestInstalment } from '@/lib/emi/emi';

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
    /**
     * The "EMIs start at ... p/m" line the design puts on every model card.
     * Indicative, computed from the interim rate table — never an approval.
     */
    emiFrom: MoneyView;
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
 */
export async function buildCatalog(
  prisma: PrismaClient,
  regionCode: string | null,
): Promise<ModelAvailability[]> {
  return Promise.all(
    [...MODELS]
      .sort((a, b) => a.sort - b.sort)
      .map((model) => describeModel(prisma, model.code, model.name, [...model.colours], regionCode)),
  );
}

async function describeModel(
  prisma: PrismaClient,
  code: string,
  name: string,
  colours: Colour[],
  regionCode: string | null,
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
    getAvailable(prisma, code, regionCode),
  ]);

  const inStock = stock.available > 0;

  return {
    code,
    name,
    colours,
    price: price
      ? {
          exShowroom: toMoneyView(price.exShowroom),
          rtoCharges: toMoneyView(price.rtoCharges),
          onRoad: toMoneyView(price.onRoad),
          emiFrom: emiFromView(price.onRoad.toNumber()),
          partial: price.partial
            ? {
                mode: price.partial.mode,
                amount: toMoneyView(price.partial.amount),
                balance: toMoneyView(price.partial.balance),
              }
            : null,
        }
      : null,
    available: stock.available,
    inStock,
    stale: stock.stale,
    // No price means no sale, however much stock sits in the warehouse.
    purchasable: inStock && price !== null,
  };
}

/**
 * The lowest instalment across tenures, at the minimum down payment. This is
 * the headline figure, and it is also the most expensive option overall — the
 * EMI widget shows the total so that trade-off is visible.
 */
function emiFromView(onRoad: number) {
  const quote = lowestInstalment(onRoad, Math.round(onRoad * MIN_DOWN_PAYMENT_RATIO));
  return { amount: quote.monthlyInstalment, display: formatRupees(quote.monthlyInstalment) };
}

export { STALE_AFTER_DAYS };
