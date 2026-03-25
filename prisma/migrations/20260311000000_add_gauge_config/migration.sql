-- CreateTable
CREATE TABLE "GaugeConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "gauge" INTEGER NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "thicknessInches" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GaugeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GaugeConfig_shop_idx" ON "GaugeConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "GaugeConfig_shop_gauge_key" ON "GaugeConfig"("shop", "gauge");
