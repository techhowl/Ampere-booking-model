-- Inventory moves from region-keyed to dealer-keyed.
--
-- Why: the region was never the thing a customer collects from. Keying stock
-- on it meant "in stock" could be true because a unit sat in a showroom forty
-- kilometres away, and it made the dealer fallback impossible to express —
-- there was nothing to fall back to.
--
-- Keyed on the dealer, "the nearest dealer is out, try the next one in range"
-- becomes a query rather than a guess.

-- 1. inventory -------------------------------------------------------------
-- Rebuilt rather than migrated. The existing rows are seeded placeholders
-- keyed on region, and there is no honest way to split "15 units in West" over
-- the dealers in West. The real numbers arrive with the dealer master and are
-- maintained by hand; until then the seed repopulates this.
DROP TABLE IF EXISTS "inventory";

CREATE TABLE "inventory" (
    "model_code"    TEXT NOT NULL,
    "dealer_code"   TEXT NOT NULL,
    "units_total"   INTEGER NOT NULL DEFAULT 15,
    "units_reserved" INTEGER NOT NULL DEFAULT 0,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by"    TEXT,
    CONSTRAINT "inventory_pkey" PRIMARY KEY ("model_code", "dealer_code")
);

ALTER TABLE "inventory"
    ADD CONSTRAINT "inventory_dealer_code_fkey"
    FOREIGN KEY ("dealer_code") REFERENCES "dealers"("dealer_code")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. reservations ----------------------------------------------------------
-- These CAN be migrated: the order already records which dealer is fulfilling
-- it, so the held unit belongs to that dealer's stock.
ALTER TABLE "inventory_reservations" ADD COLUMN "dealer_code" TEXT;

UPDATE "inventory_reservations" r
   SET "dealer_code" = o."dealer_code"
  FROM "orders" o
 WHERE o."order_id" = r."order_id"
   AND o."dealer_code" IS NOT NULL;

-- A hold whose order names no dealer cannot be expressed in the new model, and
-- the stock it was holding no longer exists. Development leftovers; dropping
-- them releases nothing real.
DELETE FROM "inventory_reservations" WHERE "dealer_code" IS NULL;

ALTER TABLE "inventory_reservations" ALTER COLUMN "dealer_code" SET NOT NULL;
ALTER TABLE "inventory_reservations" DROP COLUMN "region_code";

-- 3. audit -----------------------------------------------------------------
-- Renamed, not dropped. The history of who changed what is worth keeping even
-- though the old rows name a region in a column now called dealer_code.
ALTER TABLE "inventory_audit" RENAME COLUMN "region_code" TO "dealer_code";

DROP INDEX IF EXISTS "inventory_audit_model_code_region_code_changed_at_idx";
CREATE INDEX "inventory_audit_model_code_dealer_code_changed_at_idx"
    ON "inventory_audit"("model_code", "dealer_code", "changed_at");
