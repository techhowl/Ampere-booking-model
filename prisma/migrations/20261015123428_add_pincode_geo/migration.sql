-- CreateTable
CREATE TABLE "pincode_geo" (
    "pincode" CHAR(6) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "pincode_geo_pkey" PRIMARY KEY ("pincode")
);
