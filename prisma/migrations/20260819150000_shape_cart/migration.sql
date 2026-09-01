-- CreateTable
CREATE TABLE "ShapeCartItem" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "gauge" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "girth" DOUBLE PRECISION NOT NULL,
    "bends" INTEGER NOT NULL DEFAULT 0,
    "lengthIn" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShapeCartItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShapeCartItem_shop_customerId_createdAt_idx" ON "ShapeCartItem"("shop", "customerId", "createdAt");
