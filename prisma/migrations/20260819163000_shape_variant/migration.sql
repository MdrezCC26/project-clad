-- CreateTable
CREATE TABLE "ShapeVariant" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "specKey" TEXT NOT NULL,
    "geometryHash" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "gauge" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "girth" DOUBLE PRECISION NOT NULL,
    "bends" INTEGER NOT NULL DEFAULT 0,
    "lengthIn" DOUBLE PRECISION NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShapeVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShapeVariant_shop_specKey_key" ON "ShapeVariant"("shop", "specKey");

-- CreateIndex
CREATE INDEX "ShapeVariant_shop_variantId_idx" ON "ShapeVariant"("shop", "variantId");
