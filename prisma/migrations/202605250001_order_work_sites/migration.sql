-- V16.54: Structured work sites for merged orders.
-- Safe additive migration: no destructive column/table changes.

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "originOrderIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "OrderWorkSite" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "siteName" TEXT,
  "siteAddress" TEXT,
  "sitePlz" TEXT,
  "siteCity" TEXT,
  "siteNote" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "sourceOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderWorkSite_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderWorkSite_orderId_fkey'
  ) THEN
    ALTER TABLE "OrderWorkSite"
      ADD CONSTRAINT "OrderWorkSite_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "workSiteId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OrderItem_workSiteId_fkey'
  ) THEN
    ALTER TABLE "OrderItem"
      ADD CONSTRAINT "OrderItem_workSiteId_fkey"
      FOREIGN KEY ("workSiteId") REFERENCES "OrderWorkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "OfferItem"
  ADD COLUMN IF NOT EXISTS "siteName" TEXT,
  ADD COLUMN IF NOT EXISTS "siteAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "sitePlz" TEXT,
  ADD COLUMN IF NOT EXISTS "siteCity" TEXT,
  ADD COLUMN IF NOT EXISTS "siteNote" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceOrderId" TEXT;

ALTER TABLE "InvoiceItem"
  ADD COLUMN IF NOT EXISTS "siteName" TEXT,
  ADD COLUMN IF NOT EXISTS "siteAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "sitePlz" TEXT,
  ADD COLUMN IF NOT EXISTS "siteCity" TEXT,
  ADD COLUMN IF NOT EXISTS "siteNote" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceOrderId" TEXT;

CREATE INDEX IF NOT EXISTS "OrderWorkSite_orderId_idx" ON "OrderWorkSite"("orderId");
CREATE INDEX IF NOT EXISTS "OrderWorkSite_sourceOrderId_idx" ON "OrderWorkSite"("sourceOrderId");
CREATE INDEX IF NOT EXISTS "OrderItem_workSiteId_idx" ON "OrderItem"("workSiteId");
CREATE INDEX IF NOT EXISTS "OfferItem_offerId_idx" ON "OfferItem"("offerId");
CREATE INDEX IF NOT EXISTS "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
