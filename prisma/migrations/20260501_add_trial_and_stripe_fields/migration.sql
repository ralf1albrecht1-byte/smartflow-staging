-- Add trial/subscription columns to existing User table
ALTER TABLE "User"
  ADD COLUMN "trialStart" TIMESTAMP(3),
  ADD COLUMN "audioExtraMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stripeCustomerId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "subscriptionStatus" TEXT,
  ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);

-- New request queue for manual extra audio-minute approvals
CREATE TABLE "AudioMinuteRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestedMinutes" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AudioMinuteRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");
CREATE INDEX "AudioMinuteRequest_userId_idx" ON "AudioMinuteRequest"("userId");
CREATE INDEX "AudioMinuteRequest_status_idx" ON "AudioMinuteRequest"("status");

ALTER TABLE "AudioMinuteRequest"
  ADD CONSTRAINT "AudioMinuteRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
