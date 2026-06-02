-- V17.68 Phase 3: Persistente Ausführungsorte pro Kunde.
-- TEST/Railway only. Keine bestehende Tabelle wird verändert oder gelöscht.

CREATE TABLE "CustomerExecutionAddress" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "userId" TEXT,
  "siteName" TEXT,
  "siteAddress" TEXT NOT NULL,
  "sitePlz" TEXT NOT NULL,
  "siteCity" TEXT NOT NULL,
  "siteNote" TEXT,
  "country" TEXT NOT NULL DEFAULT 'CH',
  "usageCount" INTEGER NOT NULL DEFAULT 1,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerExecutionAddress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerExecutionAddress_customerId_idx" ON "CustomerExecutionAddress"("customerId");
CREATE INDEX "CustomerExecutionAddress_userId_idx" ON "CustomerExecutionAddress"("userId");
CREATE INDEX "CustomerExecutionAddress_customerId_deletedAt_lastUsedAt_idx" ON "CustomerExecutionAddress"("customerId", "deletedAt", "lastUsedAt");

ALTER TABLE "CustomerExecutionAddress"
ADD CONSTRAINT "CustomerExecutionAddress_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerExecutionAddress"
ADD CONSTRAINT "CustomerExecutionAddress_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
