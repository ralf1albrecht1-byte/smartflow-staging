ALTER TABLE "Order"
ADD COLUMN "intakeSchemaVersion" TEXT,
ADD COLUMN "intakeSnapshot" JSONB;

ALTER TABLE "OrderItem"
ADD COLUMN "sourceText" TEXT,
ADD COLUMN "detectedCurrency" TEXT,
ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reviewReason" TEXT,
ADD COLUMN "sourceFingerprint" TEXT;
