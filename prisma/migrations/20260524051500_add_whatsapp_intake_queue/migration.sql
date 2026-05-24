-- Add persistent WhatsApp text intake queue for sender-level debounce.
CREATE TABLE "IntakeQueueMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "senderKey" TEXT NOT NULL,
    "messageKey" TEXT NOT NULL,
    "messageSid" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WhatsApp',
    "senderName" TEXT,
    "phoneNumber" TEXT,
    "userId" TEXT,
    "messageText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "groupKey" TEXT,
    "processAfter" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeQueueMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntakeQueueMessage_messageKey_key" ON "IntakeQueueMessage"("messageKey");
CREATE INDEX "IntakeQueueMessage_channel_messageSid_idx" ON "IntakeQueueMessage"("channel", "messageSid");
CREATE INDEX "IntakeQueueMessage_channel_senderKey_status_idx" ON "IntakeQueueMessage"("channel", "senderKey", "status");
CREATE INDEX "IntakeQueueMessage_status_processAfter_idx" ON "IntakeQueueMessage"("status", "processAfter");
CREATE INDEX "IntakeQueueMessage_groupKey_idx" ON "IntakeQueueMessage"("groupKey");
