ALTER TABLE "Offer"
  ADD COLUMN "customerSnapshot" JSONB,
  ADD COLUMN "customerSnapshotAt" TIMESTAMP(3);

ALTER TABLE "Invoice"
  ADD COLUMN "customerSnapshot" JSONB,
  ADD COLUMN "customerSnapshotAt" TIMESTAMP(3);

UPDATE "Offer" AS offer
SET
  "customerSnapshot" = jsonb_build_object(
    'id', customer."id",
    'customerNumber', customer."customerNumber",
    'name', customer."name",
    'address', customer."address",
    'plz', customer."plz",
    'city', customer."city",
    'country', customer."country",
    'phone', customer."phone",
    'email', customer."email"
  ),
  "customerSnapshotAt" = CURRENT_TIMESTAMP
FROM "Customer" AS customer
WHERE offer."customerId" = customer."id"
  AND offer."status" IN ('Gesendet', 'Abgelehnt')
  AND offer."customerSnapshot" IS NULL;

UPDATE "Invoice" AS invoice
SET
  "customerSnapshot" = jsonb_build_object(
    'id', customer."id",
    'customerNumber', customer."customerNumber",
    'name', customer."name",
    'address', customer."address",
    'plz', customer."plz",
    'city', customer."city",
    'country', customer."country",
    'phone', customer."phone",
    'email', customer."email"
  ),
  "customerSnapshotAt" = CURRENT_TIMESTAMP
FROM "Customer" AS customer
WHERE invoice."customerId" = customer."id"
  AND invoice."status" IN ('Gesendet', 'Überfällig', 'Bezahlt', 'Erledigt')
  AND invoice."customerSnapshot" IS NULL;
