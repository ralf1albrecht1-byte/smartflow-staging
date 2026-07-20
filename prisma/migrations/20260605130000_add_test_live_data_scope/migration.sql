-- V17.90L44: echte TEST/LIVE-Datentrennung.
-- Bestehende Daten werden absichtlich dem TEST-Bestand zugeordnet.
-- Der LIVE-Bestand wird danach nur über den sicheren Echtstart-/Reparatur-Flow aufgebaut.

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "dataScope" TEXT NOT NULL DEFAULT 'TEST';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "dataScope" TEXT NOT NULL DEFAULT 'TEST';
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "dataScope" TEXT NOT NULL DEFAULT 'TEST';
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "dataScope" TEXT NOT NULL DEFAULT 'TEST';

UPDATE "Customer" SET "dataScope" = 'TEST' WHERE "dataScope" IS NULL OR "dataScope" NOT IN ('TEST', 'LIVE');
UPDATE "Order" SET "dataScope" = 'TEST' WHERE "dataScope" IS NULL OR "dataScope" NOT IN ('TEST', 'LIVE');
UPDATE "Offer" SET "dataScope" = 'TEST' WHERE "dataScope" IS NULL OR "dataScope" NOT IN ('TEST', 'LIVE');
UPDATE "Invoice" SET "dataScope" = 'TEST' WHERE "dataScope" IS NULL OR "dataScope" NOT IN ('TEST', 'LIVE');

DROP INDEX IF EXISTS "Customer_customerNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_userId_dataScope_customerNumber_key"
  ON "Customer"("userId", "dataScope", "customerNumber");

CREATE INDEX IF NOT EXISTS "Customer_userId_dataScope_deletedAt_idx"
  ON "Customer"("userId", "dataScope", "deletedAt");
CREATE INDEX IF NOT EXISTS "Order_userId_dataScope_deletedAt_idx"
  ON "Order"("userId", "dataScope", "deletedAt");
CREATE INDEX IF NOT EXISTS "Offer_userId_dataScope_deletedAt_idx"
  ON "Offer"("userId", "dataScope", "deletedAt");
CREATE INDEX IF NOT EXISTS "Invoice_userId_dataScope_deletedAt_idx"
  ON "Invoice"("userId", "dataScope", "deletedAt");
