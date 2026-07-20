ALTER TABLE "Invoice"
  ADD COLUMN "archivedCustomerSnapshot" JSONB,
  ADD COLUMN "archivedCustomerSnapshotAt" TIMESTAMP(3);

-- Only invoices without an existing immutable archive PDF can be safely
-- backfilled from the document snapshot. Existing archived PDFs remain the
-- historical source of truth and are deliberately not overwritten.
UPDATE "Invoice"
SET
  "archivedCustomerSnapshot" = "customerSnapshot",
  "archivedCustomerSnapshotAt" = COALESCE("customerSnapshotAt", CURRENT_TIMESTAMP)
WHERE "status" = 'Erledigt'
  AND "archivedPdfPath" IS NULL
  AND "customerSnapshot" IS NOT NULL
  AND "archivedCustomerSnapshot" IS NULL;
