import { prisma } from '@/lib/prisma';
import { processIncomingMessage } from '@/lib/order-intake';
import { logAuditAsync } from '@/lib/audit';
import { maskPhoneForLog } from '@/lib/phone';

const DEFAULT_WHATSAPP_TEXT_DELAY_MS = 4_000;
const MIN_WHATSAPP_TEXT_DELAY_MS = 2_500;
const MAX_WHATSAPP_TEXT_DELAY_MS = 20_000;

const WHATSAPP_TEXT_DELAY_MS = Number.parseInt(
  process.env.WHATSAPP_TEXT_DELAY_MS ||
    process.env.WHATSAPP_TEXT_DEBOUNCE_MS ||
    String(DEFAULT_WHATSAPP_TEXT_DELAY_MS),
  10,
);

const CHANNEL = 'whatsapp';
const PROCESSING_TIMEOUT_MS = 90_000;

const scheduledWorkers = new Map<string, ReturnType<typeof setTimeout>>();

function queueDelayMs(): number {
  if (!Number.isFinite(WHATSAPP_TEXT_DELAY_MS)) {
    return DEFAULT_WHATSAPP_TEXT_DELAY_MS;
  }

  return Math.min(
    Math.max(WHATSAPP_TEXT_DELAY_MS, MIN_WHATSAPP_TEXT_DELAY_MS),
    MAX_WHATSAPP_TEXT_DELAY_MS,
  );
}

// Important:
// This key is intentionally account/user based, not phone based.
// If the same Smartflow account receives WhatsApp messages from multiple
// customer/partner numbers, AI/order creation still runs one-by-one.
// Messages are NOT merged. Each queued row becomes one separate order attempt.
function normalizeQueueKey(resolvedUserId: string): string {
  const userId = String(resolvedUserId || '').trim();
  return `${CHANNEL}:user:${userId || 'unknown-user'}`;
}

function buildMessageKey(messageSid: string, queueKey: string): string {
  const sid = String(messageSid || '').trim();
  if (sid) return `${CHANNEL}:${sid}`;
  return `${CHANNEL}:no-sid:${queueKey}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function scheduleWorker(queueKey: string, delayMs: number): void {
  const safeDelay = Math.min(Math.max(delayMs, 500), MAX_WHATSAPP_TEXT_DELAY_MS + 1_000);

  const existing = scheduledWorkers.get(queueKey);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    scheduledWorkers.delete(queueKey);
    processWhatsAppTextQueueForSender(queueKey).catch((err) => {
      console.error(`[WhatsAppQueue] Worker failed for queueKey=${queueKey}:`, err);
    });
  }, safeDelay);

  scheduledWorkers.set(queueKey, timer);
}

async function scheduleNextPendingForSender(queueKey: string): Promise<void> {
  const next = await prisma.intakeQueueMessage.findFirst({
    where: {
      channel: CHANNEL,
      senderKey: queueKey,
      status: 'pending',
    },
    orderBy: [
      { processAfter: 'asc' },
      { createdAt: 'asc' },
    ],
    select: { processAfter: true },
  });

  if (!next) return;
  const delayMs = next.processAfter.getTime() - Date.now() + 250;
  scheduleWorker(queueKey, delayMs);
}

async function resetStaleProcessingMessages(queueKey: string): Promise<void> {
  const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
  await prisma.intakeQueueMessage.updateMany({
    where: {
      channel: CHANNEL,
      senderKey: queueKey,
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

  const delay = queueDelayMs();
  const processAfter = new Date(Date.now() + delay);
  const queueKey = normalizeQueueKey(params.resolvedUserId);
  const messageKey = buildMessageKey(params.messageSid, queueKey);

  try {
    await prisma.intakeQueueMessage.create({
      data: {
        channel: CHANNEL,
        senderKey: queueKey,
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

  // Delay-only queue:
  // - Do NOT merge messages.
  // - Do NOT extend older pending messages.
  // - Every WhatsApp text message remains one separate order input.
  // - Processing is serialized by Smartflow account/user via queueKey.
  logAuditAsync({
    userId: params.resolvedUserId,
    action: 'WHATSAPP_TEXT_QUEUED',
    area: 'WEBHOOK',
    details: {
      phone: maskPhoneForLog(params.phoneNumber),
      sid: params.messageSid || null,
      delayMs: delay,
      mode: 'individual_serial_queue',
      chars: messageText.length,
    },
  });

  console.log(
    `[WhatsAppQueue] Queued 1 text message for ${maskPhoneForLog(params.phoneNumber)}: ${messageText.length} chars delayMs=${delay}`,
  );

  // Always schedule the earliest pending item. If a new item arrives while an
  // earlier item is already waiting, this may reschedule the same worker, but
  // it still processes FIFO and never combines texts.
  await scheduleNextPendingForSender(queueKey);

  return { queued: true, duplicate: false };
}

export async function processWhatsAppTextQueueForSender(queueKey: string): Promise<void> {
  await resetStaleProcessingMessages(queueKey);

  // Hard account-level lock: if one message is still being processed for this
  // Smartflow account, do not start another AI/order job in parallel.
  const active = await prisma.intakeQueueMessage.findFirst({
    where: {
      channel: CHANNEL,
      senderKey: queueKey,
      status: 'processing',
    },
    select: { id: true },
  });

  if (active) {
    scheduleWorker(queueKey, 5_000);
    return;
  }

  const now = new Date();
  const next = await prisma.intakeQueueMessage.findFirst({
    where: {
      channel: CHANNEL,
      senderKey: queueKey,
      status: 'pending',
      processAfter: { lte: now },
    },
    orderBy: [
      { processAfter: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  if (!next) {
    await scheduleNextPendingForSender(queueKey);
    return;
  }

  const groupKey = `wa_text_single_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const locked = await prisma.intakeQueueMessage.updateMany({
    where: {
      id: next.id,
      status: 'pending',
    },
    data: {
      status: 'processing',
      groupKey,
    },
  });

  if (locked.count === 0) {
    await scheduleNextPendingForSender(queueKey);
    return;
  }

  const message = await prisma.intakeQueueMessage.findFirst({
    where: { id: next.id, status: 'processing' },
  });

  if (!message) {
    await scheduleNextPendingForSender(queueKey);
    return;
  }

  const text = String(message.messageText || '').trim();

  if (!text) {
    await prisma.intakeQueueMessage.update({
      where: { id: message.id },
      data: {
        status: 'done',
        processedAt: new Date(),
        error: null,
      },
    });
    await scheduleNextPendingForSender(queueKey);
    return;
  }

  console.log(
    `[WhatsAppQueue] Processing 1 text message for ${maskPhoneForLog(message.phoneNumber || '')}: ${text.length} chars`,
  );

  try {
    const orderCreated = await processIncomingMessage({
      source: 'WhatsApp',
      senderName: message.senderName || 'Unbekannt',
      messageText: text,
      phoneNumber: message.phoneNumber || null,
      imageBase64: null,
      imageMimeType: 'image/jpeg',
      savedMediaPath: null,
      savedMediaType: null,
      optimizedPreviewPath: null,
      optimizedThumbnailPath: null,
      userId: message.userId || null,
    });

    if (orderCreated?.orderId) {
      console.info(
        `[WhatsAppQueueHourFixV17_27] skipped post-persist repair orderId=${orderCreated.orderId}; semantic intake result kept as source of truth`,
      );
    }

    await prisma.intakeQueueMessage.update({
      where: { id: message.id },
      data: {
        status: 'done',
        processedAt: new Date(),
        error: null,
      },
    });

    logAuditAsync({
      userId: message.userId || undefined,
      action: 'WHATSAPP_TEXT_QUEUE_PROCESSED',
      area: 'WEBHOOK',
      details: {
        phone: maskPhoneForLog(message.phoneNumber || ''),
        messageCount: 1,
        mode: 'individual_serial_queue',
        chars: text.length,
        orderCreated: Boolean(orderCreated),
        description: orderCreated?.description || null,
      },
    });
  } catch (err: any) {
    const errorMessage = err?.message || String(err) || 'Unknown queue processing error';

    console.error(`[WhatsAppQueue] Processing failed for ${maskPhoneForLog(message.phoneNumber || '')}:`, err);

    await prisma.intakeQueueMessage.update({
      where: { id: message.id },
      data: {
        status: 'failed',
        error: errorMessage.slice(0, 4000),
        retryCount: { increment: 1 },
      },
    });

    logAuditAsync({
      userId: message.userId || undefined,
      action: 'WHATSAPP_TEXT_QUEUE_FAILED',
      area: 'WEBHOOK',
      success: false,
      details: {
        phone: maskPhoneForLog(message.phoneNumber || ''),
        messageCount: 1,
        mode: 'individual_serial_queue',
        error: errorMessage,
      },
    });
  }

  await scheduleNextPendingForSender(queueKey);
}
