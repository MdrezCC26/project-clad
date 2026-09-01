-- CreateTable
CREATE TABLE "ShapeTemplate" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShapeTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShapeLibraryEntry" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "geometryHash" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "girth" DOUBLE PRECISION NOT NULL,
    "gauge" TEXT,
    "color" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShapeLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShapeTemplate_shop_idx" ON "ShapeTemplate"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShapeTemplate_shop_slug_key" ON "ShapeTemplate"("shop", "slug");

-- CreateIndex
CREATE INDEX "ShapeLibraryEntry_shop_updatedAt_idx" ON "ShapeLibraryEntry"("shop", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShapeLibraryEntry_shop_geometryHash_key" ON "ShapeLibraryEntry"("shop", "geometryHash");
