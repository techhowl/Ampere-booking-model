-- CreateEnum
CREATE TYPE "LeadIntent" AS ENUM ('undecided', 'testride', 'buy');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('initiated', 'pending', 'paid', 'failed', 'expired', 'refunded');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('full', 'partial', 'emi');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('held', 'converted', 'released');

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone_enc" BYTEA NOT NULL,
    "phone_hash" CHAR(64) NOT NULL,
    "phone_last4" CHAR(4) NOT NULL,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "pincode" CHAR(6) NOT NULL,
    "state_code" TEXT,
    "region_code" TEXT,
    "dealer_code" TEXT,
    "model_code" TEXT,
    "colour_code" TEXT,
    "intent" "LeadIntent" NOT NULL DEFAULT 'undecided',
    "status" TEXT NOT NULL DEFAULT 'new',
    "src" TEXT,
    "utm" JSONB,
    "gclid" TEXT,
    "fbclid" TEXT,
    "source_raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "notice_version" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_attempts" (
    "otp_ref" TEXT NOT NULL,
    "phone_hash" CHAR(64) NOT NULL,
    "code_hash" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'sms',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_attempts_pkey" PRIMARY KEY ("otp_ref")
);

-- CreateTable
CREATE TABLE "inventory" (
    "model_code" TEXT NOT NULL,
    "region_code" TEXT NOT NULL,
    "units_total" INTEGER NOT NULL DEFAULT 15,
    "units_reserved" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("model_code","region_code")
);

-- CreateTable
CREATE TABLE "inventory_audit" (
    "id" BIGSERIAL NOT NULL,
    "model_code" TEXT NOT NULL,
    "region_code" TEXT NOT NULL,
    "units_before" INTEGER NOT NULL,
    "units_after" INTEGER NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "model_code" TEXT NOT NULL,
    "region_code" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'held',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "order_id" TEXT NOT NULL,
    "lead_id" UUID NOT NULL,
    "dealer_code" TEXT,
    "model_code" TEXT NOT NULL,
    "colour_code" TEXT,
    "region_code" TEXT NOT NULL,
    "payment_type" "PaymentType" NOT NULL,
    "amount_total" DECIMAL(12,2) NOT NULL,
    "amount_charged" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2),
    "status" "OrderStatus" NOT NULL DEFAULT 'initiated',
    "status_source" TEXT,
    "juspay_status_raw" TEXT,
    "emi_context" JSONB,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" BIGSERIAL NOT NULL,
    "order_id" TEXT NOT NULL,
    "event_type" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_ride_bookings" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "dealer_code" TEXT NOT NULL,
    "model_code" TEXT NOT NULL,
    "colour_code" TEXT,
    "mode" TEXT NOT NULL,
    "slot_date" DATE NOT NULL,
    "slot_window" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_ride_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealers" (
    "dealer_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "home_serviceable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dealers_pkey" PRIMARY KEY ("dealer_code")
);

-- CreateTable
CREATE TABLE "pincode_map" (
    "pincode" CHAR(6) NOT NULL,
    "state_code" TEXT NOT NULL,
    "region_code" TEXT NOT NULL,
    "dealer_code" TEXT,

    CONSTRAINT "pincode_map_pkey" PRIMARY KEY ("pincode")
);

-- CreateTable
CREATE TABLE "price_book" (
    "model_code" TEXT NOT NULL,
    "region_code" TEXT NOT NULL,
    "amount_total" DECIMAL(12,2) NOT NULL,
    "partial_mode" TEXT,
    "partial_value" DECIMAL(12,2),
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_book_pkey" PRIMARY KEY ("model_code","region_code","effective_from")
);

-- CreateIndex
CREATE INDEX "leads_phone_hash_idx" ON "leads"("phone_hash");

-- CreateIndex
CREATE INDEX "leads_phone_verified_created_at_idx" ON "leads"("phone_verified", "created_at" DESC);

-- CreateIndex
CREATE INDEX "leads_dealer_code_status_idx" ON "leads"("dealer_code", "status");

-- CreateIndex
CREATE INDEX "consents_lead_id_idx" ON "consents"("lead_id");

-- CreateIndex
CREATE INDEX "otp_attempts_phone_hash_created_at_idx" ON "otp_attempts"("phone_hash", "created_at");

-- CreateIndex
CREATE INDEX "otp_attempts_expires_at_idx" ON "otp_attempts"("expires_at");

-- CreateIndex
CREATE INDEX "inventory_audit_model_code_region_code_changed_at_idx" ON "inventory_audit"("model_code", "region_code", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_order_id_key" ON "inventory_reservations"("order_id");

-- CreateIndex
CREATE INDEX "inventory_reservations_status_expires_at_idx" ON "inventory_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_lead_id_idx" ON "orders"("lead_id");

-- CreateIndex
CREATE INDEX "payment_events_order_id_received_at_idx" ON "payment_events"("order_id", "received_at");

-- CreateIndex
CREATE INDEX "test_ride_bookings_dealer_code_slot_date_idx" ON "test_ride_bookings"("dealer_code", "slot_date");

-- CreateIndex
CREATE INDEX "pincode_map_region_code_idx" ON "pincode_map"("region_code");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_dealer_code_fkey" FOREIGN KEY ("dealer_code") REFERENCES "dealers"("dealer_code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_dealer_code_fkey" FOREIGN KEY ("dealer_code") REFERENCES "dealers"("dealer_code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_ride_bookings" ADD CONSTRAINT "test_ride_bookings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_ride_bookings" ADD CONSTRAINT "test_ride_bookings_dealer_code_fkey" FOREIGN KEY ("dealer_code") REFERENCES "dealers"("dealer_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pincode_map" ADD CONSTRAINT "pincode_map_dealer_code_fkey" FOREIGN KEY ("dealer_code") REFERENCES "dealers"("dealer_code") ON DELETE SET NULL ON UPDATE CASCADE;
