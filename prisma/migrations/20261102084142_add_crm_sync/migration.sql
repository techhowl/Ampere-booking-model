-- AlterTable
ALTER TABLE "dealers" ADD COLUMN     "crm_id" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "crm_lead_id" TEXT;

-- AlterTable
ALTER TABLE "test_ride_bookings" ADD COLUMN     "crm_test_ride_id" TEXT,
ADD COLUMN     "help_topics" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "crm_vehicle_models" (
    "model_code" TEXT NOT NULL,
    "crm_id" TEXT NOT NULL,
    "crm_name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_vehicle_models_pkey" PRIMARY KEY ("model_code")
);

-- CreateTable
CREATE TABLE "crm_jobs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "lead_id" UUID NOT NULL,
    "test_ride_id" UUID,
    "phone_hash" CHAR(64),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "ambiguous" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT,
    "last_error" TEXT,
    "crm_lead_id" TEXT,
    "crm_test_ride_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "crm_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tokens" (
    "key" TEXT NOT NULL,
    "token_enc" BYTEA NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_tokens_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_jobs_dedupe_key_key" ON "crm_jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "crm_jobs_status_next_attempt_at_idx" ON "crm_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "crm_jobs_lead_id_idx" ON "crm_jobs"("lead_id");

-- AddForeignKey
ALTER TABLE "crm_jobs" ADD CONSTRAINT "crm_jobs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_jobs" ADD CONSTRAINT "crm_jobs_test_ride_id_fkey" FOREIGN KEY ("test_ride_id") REFERENCES "test_ride_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
