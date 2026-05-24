import { prisma } from '@/lib/prisma';
import { processIncomingMessage } from '@/lib/order-intake';
import { logAuditAsync } from '@/lib/audit';
import { maskPhoneForLog } from '@/lib/phone';

const WHATSAPP_TEXT_DEBOUNCE_MS = Number.parseInt(
  process.env.WHATSAPP_TEXT_DEBOUNCE_MS || '12000',
  10,
);

const CHANNEL = 'whatsapp';
const PROCESSING_TIMEOUT_MS = 90_000;

const scheduledWorkers = new Map<string, ReturnType<typeof setTimeout>>();

function debounceMs(): number {
  if (!Number.isFinite(WHATSAPP_TEXT_DEBOUNCE_MS)) return 12_000;
  return Math.min(Math.max(WHATSAPP_TEXT_DEBOUNCE_MS, 3_000), 60_000);
}

function normalizeSenderKey(phoneNumber: string, resolvedUserId: string): string {
  const phone = String(phoneNumber || '').replace(/\s+/g, '').trim();
  return `${resolvedUserId || 'unknown'}:${phone || 'unknown-phone'}`;
}

function buildMessageKey(messageSid: string, senderKey: string): string {
  const sid = String(messageSid || '').trim();
  if (sid) return `${CHANNEL}:${sid}`;
  return `${CHANNEL}:no-sid:${senderKey}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function buildGroupText(messages: Array<{ messageText: string; createdAt: Date }>): string {
  return messages
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((message, index) => {
      const text = String(message.messageText || '').trim();
      if (!text) return '';
      return messages.length > 1 ? `[Nachricht ${index + 1}]:\n${text}` : text;
    })
    .filter(Boolean)
    .join('\n\n');
}

function scheduleWorker(senderKey: string, delayMs: number): void {
  const safeDelay = Math.min(Math.max(delayMs, 500), 60_000);

  const existing = scheduledWorkers.get(senderKey);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    scheduledWorkers.delete(senderKey);
    processWhatsAppTextQueueForSender(senderKey).catch((err) => {
      console.error(`[WhatsAppQueue] Worker failed for senderKey=${senderKey}:`, err);
    });
  }, safeDelay);

  scheduledWorkers.set(senderKey, timer);
}

async function scheduleNextPendingForSender(senderKey: string): Promise<void> {
  const next = await prisma.intakeQueueMessage.findFirst({
    where: {
      channel: CHANNEL,
      senderKey,
      status: 'pending',
    },
    orderBy: { processAfter: 'asc' },
    select: { processAfter: true },
  });

  if (!next) return;
  const delayMs = next.processAfter.getTime() - Date.now() + 250;
  scheduleWorker(senderKey, delayMs);
}

async function resetStaleProcessingMessages(senderKey: string): Promise<void> {
  const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
  await prisma.intakeQueueMessage.updateMany({
    where: {
      channel: CHANNEL,
      senderKey,
      status: 'processing',
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: 'pending',
      groupKey: null,
      error: 'processing_timeout_reset',
      processAfter: new Date(Date.now() + 5_000),
    },
  });
}

export async function enqueueWhatsAppTextIntakeMessage(params: {
  messageSid: string;
  phoneNumber: string;
  profileName: string;
  resolvedUserId: string;
  messageText: string;
}): Promise<{ queued: boolean; duplicate: boolean }> {
  const messageText = String(params.messageText || '').trim();
  if (!messageText) return { queued: false, duplicate: false };

  const delay = debounceMs();
  const processAfter = new Date(Date.now() + delay);
  const senderKey = normalizeSenderKey(params.phoneNumber, params.resolvedUserId);
  const messageKey = buildMessageKey(params.messageSid, senderKey);

  try {
    await prisma.intakeQueueMessage.create({
      data: {
        channel: CHANNEL,
        senderKey,
        messageKey,
        messageSid: params.messageSid || null,
        source: 'WhatsApp',
        senderName: params.profileName || 'Unbekannt',
        phoneNumber: params.phoneNumber || null,
        userId: params.resolvedUserId || null,
        messageText,
        status: 'pending',
        processAfter,
      },
    });
  } catch (err: any) {
    // DB-level dedupe for Twilio retries / parallel webhook delivery.
    if (err?.code === 'P2002') {
      console.log(`[WhatsAppQueue] Duplicate SID skipped: ${params.messageSid}`);
      return { queued: false, duplicate: true };
    }
    throw err;
  }

  // Debounce: every new message from the same sender extends the processing
  // window for all still-pending text messages. This prevents half orders when
  // the user sends address, site and services as separate fast messages.
  await prisma.intakeQueueMessage.updateMany({
    where: {
      channel: CHANNEL,
      senderKey,
      status: 'pending',
    },
    data: { processAfter },
  });

  logAuditAsync({
    userId: params.resolvedUserId,
    action: 'WHATSAPP_TEXT_QUEUED',
    area: 'WEBHOOK',
    details: {
      phone: maskPhoneForLog(params.phoneNumber),
      sid: params.messageSid || null,
      debounceMs: delay,
      chars: messageText.length,
    },
  });

  scheduleWorker(senderKey, delay + 500);
  return { queued: true, duplicate: false };
}

export async function processWhatsAppTextQueueForSender(senderKey: string): Promise<void> {
  await resetStaleProcessingMessages(senderKey);

  const now = new Date();
  const ready = await prisma.intakeQueueMessage.findMany({
    where: {
      channel: CHANNEL,
      senderKey,
      status: 'pending',
      processAfter: { lte: now },
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  if (ready.length === 0) {
    await scheduleNextPendingForSender(senderKey);
    return;
  }

  const groupKey = `wa_text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ids = ready.map((message) => message.id);

  const locked = await prisma.intakeQueueMessage.updateMany({
    where: {
      id: { in: ids },
      status: 'pending',
    },
    data: {
      status: 'processing',
      groupKey,
    },
  });

  if (locked.count === 0) {
    await scheduleNextPendingForSender(senderKey);
    return;
  }

  const messages = await prisma.intakeQueueMessage.findMany({
    where: { groupKey, status: 'processing' },
    orderBy: { createdAt: 'asc' },
  });

  if (messages.length === 0) {
    await scheduleNextPendingForSender(senderKey);
    return;
  }

  const first = messages[0];
  const last = messages[messages.length - 1];
  const combinedText = buildGroupText(messages);

  if (!combinedText.trim()) {
    await prisma.intakeQueueMessage.updateMany({
      where: { groupKey },
      data: {
        status: 'done',
        processedAt: new Date(),
        error: null,
      },
    });
    await scheduleNextPendingForSender(senderKey);
    return;
  }

  console.log(
    `[WhatsAppQueue] Processing ${messages.length} text message(s) for ${maskPhoneForLog(first.phoneNumber || '')}: ${combinedText.length} chars`,
  );

  try {
    const orderCreated = await processIncomingMessage({
      source: 'WhatsApp',
      senderName: last.senderName || first.senderName || 'Unbekannt',
      messageText: combinedText,
      phoneNumber: first.phoneNumber || null,
      imageBase64: null,
      imageMimeType: 'image/jpeg',
      savedMediaPath: null,
      savedMediaType: null,
      optimizedPreviewPath: null,
      optimizedThumbnailPath: null,
      userId: first.userId || null,
    });

    await prisma.intakeQueueMessage.updateMany({
      where: { groupKey },
      data: {
        status: 'done',
        processedAt: new Date(),
        error: null,
      },
    });

    logAuditAsync({
      userId: first.userId || undefined,
      action: 'WHATSAPP_TEXT_QUEUE_PROCESSED',
      area: 'WEBHOOK',
      details: {
        phone: maskPhoneForLog(first.phoneNumber || ''),
        messageCount: messages.length,
        chars: combinedText.length,
        orderCreated: Boolean(orderCreated),
        description: orderCreated?.description || null,
      },
    });
  } catch (err: any) {
    const errorMessage = err?.message || String(err) || 'Unknown queue processing error';

    console.error(`[WhatsAppQueue] Processing failed for ${maskPhoneForLog(first.phoneNumber || '')}:`, err);

    await prisma.intakeQueueMessage.updateMany({
      where: { groupKey },
      data: {
        status: 'failed',
        error: errorMessage.slice(0, 4000),
        retryCount: { increment: 1 },
      },
    });

    logAuditAsync({
      userId: first.userId || undefined,
      action: 'WHATSAPP_TEXT_QUEUE_FAILED',
      area: 'WEBHOOK',
      success: false,
      details: {
        phone: maskPhoneForLog(first.phoneNumber || ''),
        messageCount: messages.length,
        error: errorMessage,
      },
    });
  }

  await scheduleNextPendingForSender(senderKey);
}
