-- CreateTable
CREATE TABLE "FulfillmentPhoto" (
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfillmentPhoto_pkey" PRIMARY KEY ("storageKey")
);
