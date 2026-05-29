import { prisma } from '@/lib/prisma';
import { processIncomingMessage } from '@/lib/order-intake';
import { logAuditAsync } from '@/lib/audit';
import { maskPhoneForLog } from '@/lib/phone';

const WHATSAPP_TEXT_DELAY_MS = Number.parseInt(
  process.env.WHATSAPP_TEXT_DELAY_MS ||
    process.env.WHATSAPP_TEXT_DEBOUNCE_MS ||
    '12000',
  10,
);

const CHANNEL = 'whatsapp';
const PROCESSING_TIMEOUT_MS = 90_000;

const scheduledWorkers = new Map<string, ReturnType<typeof setTimeout>>();


type WhatsAppQueueHourRepairCandidate = {
  raw: string;
  quantity: number;
  price: number;
  topic: string | null;
  key: string;
};

type WhatsAppQueueHourRepairItem = {
  id: string;
  serviceName?: string | null;
  description?: string | null;
  quantity?: any;
  unit?: string | null;
  unitPrice?: any;
  totalPrice?: any;
};

function normalizeWhatsAppQueueText(value: any): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[ä]/g, 'ae')
    .replace(/[ö]/g, 'oe')
    .replace(/[ü]/g, 'ue')
    .replace(/[ß]/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWhatsAppQueueDecimal(value?: string | null): number | null {
  const parsed = Number(String(value || '').replace("'", '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const WHATSAPP_QUEUE_HOUR_WORD_VALUES: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  eins: 1,
  viertel: 0.25,
  halb: 0.5,
  halbe: 0.5,
  dreiviertel: 0.75,
  anderthalb: 1.5,
  eineinhalb: 1.5,
  zwei: 2,
  zweieinhalb: 2.5,
  drei: 3,
  dreieinhalb: 3.5,
  vier: 4,
  viereinhalb: 4.5,
  fuenf: 5,
  funf: 5,
  fuenfeinhalb: 5.5,
  funfeinhalb: 5.5,
  sechs: 6,
  sechseinhalb: 6.5,
  sieben: 7,
  siebeneinhalb: 7.5,
  acht: 8,
  achteinhalb: 8.5,
  neun: 9,
  neuneinhalb: 9.5,
  zehn: 10,
};

function parseWhatsAppQueueHourQuantityToken(value?: string | null): number | null {
  const numeric = parseWhatsAppQueueDecimal(value);
  if (numeric) return numeric;

  const key = normalizeWhatsAppQueueText(value || '').replace(/\s+/g, '');
  return WHATSAPP_QUEUE_HOUR_WORD_VALUES[key] || null;
}

function roundWhatsAppQueueMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeWhatsAppQueueHourQuantity(value: number | null | undefined): number | null {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return roundWhatsAppQueueMoney(Math.round(quantity * 4) / 4);
}

function isWhatsAppQueueHourUnit(value?: string | null): boolean {
  const unit = normalizeWhatsAppQueueText(value || '').replace(/[^a-z0-9]/g, '');
  return ['stunde', 'stunden', 'std', 'h', 'hour', 'hours'].includes(unit);
}

function detectWhatsAppQueueExplicitHourQuantity(line?: string | null): number | null {
  const source = normalizeWhatsAppQueueText(line || '');
  if (!source) return null;

  const numberOrWord =
    '(?:\\d+(?:[.,]\\d+)?|ein|eine|einen|einem|einer|eins|viertel|halbe|halb|dreiviertel|anderthalb|eineinhalb|zweieinhalb|dreieinhalb|viereinhalb|fuenfeinhalb|funfeinhalb|sechseinhalb|siebeneinhalb|achteinhalb|neuneinhalb|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun|zehn)';
  const hourUnit = '(?:stunden?|std\\.?|h|hours?)';
  const minuteUnit = '(?:min\\.?|minuten?|minutes?)';

  const hourMatch = source.match(new RegExp(`\\b(${numberOrWord})\\s*${hourUnit}\\b`, 'i'));
  if (hourMatch?.[1]) {
    const base = parseWhatsAppQueueHourQuantityToken(hourMatch[1]);
    if (base) {
      let total = base;
      const after = source.slice((hourMatch.index || 0) + hourMatch[0].length);
      const minuteAfter = after.match(new RegExp(`^\\s*(?:und|\\+)?\\s*(15|30|45)\\s*${minuteUnit}\\b`, 'i'));
      if (minuteAfter?.[1]) total += Number(minuteAfter[1]) / 60;
      const normalized = normalizeWhatsAppQueueHourQuantity(total);
      if (normalized) return normalized;
    }
  }

  const compactHourMinute = source.match(new RegExp(`\\b(\\d{1,2})\\s*(?:h|std\\.?|stunden?)\\s*(15|30|45)\\s*(?:${minuteUnit})?\\b`, 'i'));
  if (compactHourMinute?.[1] && compactHourMinute?.[2]) {
    const normalized = normalizeWhatsAppQueueHourQuantity(
      Number(compactHourMinute[1]) + Number(compactHourMinute[2]) / 60,
    );
    if (normalized) return normalized;
  }

  const wordFraction = source.match(
    /\b(?:eine?n?\s+)?(viertel|halb|halbe|dreiviertel)\s*(?:stunde|stunden|std\.?|h)\b/i,
  );
  if (wordFraction?.[1]) {
    const normalized = normalizeWhatsAppQueueHourQuantity(parseWhatsAppQueueHourQuantityToken(wordFraction[1]));
    if (normalized) return normalized;
  }

  return null;
}

function detectWhatsAppQueueExplicitUnitPrice(line?: string | null): number | null {
  const source = normalizeWhatsAppQueueText(line || '');
  if (!source) return null;

  const currencyWords = '(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€)';
  const number = '(\\d+(?:[.,]\\d{1,2})?)';
  const anchor = '(?:à|a|pro|je|per|zu|fuer|für|/)';

  const patterns = [
    new RegExp(`${anchor}\\s*${currencyWords}\\s*${number}\\b`, 'i'),
    new RegExp(`${anchor}\\s*${number}\\s*${currencyWords}\\b`, 'i'),
    new RegExp(`${currencyWords}\\s*${number}\\s*(?:${anchor})\\s*(?:stunde|stunden|std\\.?|h|hour|hours)\\b`, 'i'),
    new RegExp(`${number}\\s*${currencyWords}\\s*(?:${anchor})\\s*(?:stunde|stunden|std\\.?|h|hour|hours)\\b`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const value = match?.[1] || match?.[2];
    const parsed = parseWhatsAppQueueDecimal(value);
    if (parsed) return parsed;
  }

  const currencyMatches = Array.from(
    source.matchAll(new RegExp(`(?:${currencyWords}\\s*${number}|${number}\\s*${currencyWords})`, 'gi')),
  );
  for (const match of currencyMatches) {
    const parsed = parseWhatsAppQueueDecimal(match[1] || match[2]);
    if (parsed) return parsed;
  }

  return null;
}

function whatsAppQueueServiceTopic(value?: string | null): string | null {
  const text = normalizeWhatsAppQueueText(value || '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  const hasCleaningIntent = /reinig|putz|putze|saeuber|clean|nettoyage|nettoyer|pulizia|limpieza|limpeza|wisch|aufnehmen/.test(text);
  if (/\bboden\b|\bfloor\b|\bsol\b|\bpaviment|\bsuelo\b/.test(text) && hasCleaningIntent) return 'boden_reinigen';
  if (/fenster|fensterli|vitrin|vitre|window|fenetre|finestr|ventan/.test(text)) return 'fenster_reinigen';
  if (/\bteppich\b|carpet|moquette/.test(text) && hasCleaningIntent) return 'teppich_reinigen';
  if (/\banfahrt\b|\bfahrtkosten\b|\bfahrkosten\b|\bfahrpauschale\b|\bwegpauschale\b|\bdeplacement\b|\btravel\b|\btrip\b/.test(text)) return 'anfahrt';

  return null;
}

function buildWhatsAppQueueHourCandidates(originalText: string): WhatsAppQueueHourRepairCandidate[] {
  return String(originalText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line))
    .map((line) => ({
      raw: line,
      quantity: detectWhatsAppQueueExplicitHourQuantity(line),
      price: detectWhatsAppQueueExplicitUnitPrice(line),
      topic: whatsAppQueueServiceTopic(line),
      key: normalizeWhatsAppQueueText(line),
    }))
    .filter((candidate) =>
      Boolean(candidate.quantity && candidate.quantity > 0 && candidate.price && candidate.price > 0),
    ) as WhatsAppQueueHourRepairCandidate[];
}

function chooseWhatsAppQueueHourCandidate(
  item: WhatsAppQueueHourRepairItem,
  candidates: WhatsAppQueueHourRepairCandidate[],
): WhatsAppQueueHourRepairCandidate | null {
  const currentPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const samePrice = candidates.filter((candidate) => Math.abs(candidate.price - currentPrice) < 0.01);
  if (samePrice.length === 0) return null;

  const itemText = [item.serviceName, item.description].filter(Boolean).join(' ');
  const itemTopic = whatsAppQueueServiceTopic(itemText);
  const itemKey = normalizeWhatsAppQueueText(itemText);

  const sameTopic = itemTopic ? samePrice.filter((candidate) => candidate.topic === itemTopic) : [];
  if (sameTopic.length === 1) return sameTopic[0];
  if (sameTopic.length > 1) return sameTopic.sort((a, b) => b.raw.length - a.raw.length)[0];

  const sameDomain = samePrice.filter((candidate) => {
    if (itemKey.includes('boden') && candidate.key.includes('boden')) return true;
    if (itemKey.includes('fenster') && candidate.key.includes('fenster')) return true;
    if (itemKey.includes('teppich') && candidate.key.includes('teppich')) return true;
    return false;
  });
  if (sameDomain.length === 1) return sameDomain[0];
  if (sameDomain.length > 1) return sameDomain.sort((a, b) => b.raw.length - a.raw.length)[0];

  // Safety fallback: repair only when this exact price appears in one hourly line.
  // This is designed for the live failure where the item has already been reduced
  // to "Std. à CHF xx" and the original service words are gone.
  if (samePrice.length === 1) return samePrice[0];

  return null;
}

async function repairWhatsAppQueueZeroHourOrderItems(params: {
  orderId: string;
  originalText: string;
}): Promise<void> {
  const orderId = String(params.orderId || '').trim();
  if (!orderId) return;

  try {
    const candidates = buildWhatsAppQueueHourCandidates(params.originalText);
    if (candidates.length === 0) {
      console.info(`[WhatsAppQueueHourFixV17_02] orderId=${orderId} candidates=0`);
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order || !Array.isArray(order.items) || order.items.length === 0) return;

    const zeroHourItems = (order.items as WhatsAppQueueHourRepairItem[]).filter(
      (item) =>
        isWhatsAppQueueHourUnit(item.unit) &&
        Number(item.unitPrice || 0) > 0 &&
        Number(item.quantity || 0) <= 0,
    );

    console.info(
      `[WhatsAppQueueHourFixV17_02] start orderId=${orderId} zeroHourRows=${zeroHourItems.length} candidates=${candidates.length}`,
    );

    if (zeroHourItems.length === 0) return;

    const updates: Array<{
      id: string;
      quantity: number;
      totalPrice: number;
      description: string;
    }> = [];

    for (const item of zeroHourItems) {
      const chosen = chooseWhatsAppQueueHourCandidate(item, candidates);
      if (!chosen) {
        console.warn(
          `[WhatsAppQueueHourFixV17_02] no-match orderId=${orderId} itemId=${item.id} service=${item.serviceName || '?'} price=${Number(item.unitPrice || 0)}`,
        );
        continue;
      }

      const quantity = normalizeWhatsAppQueueHourQuantity(chosen.quantity);
      const price = Number(item.unitPrice || chosen.price || 0);
      if (!quantity || quantity <= 0 || !Number.isFinite(price) || price <= 0) continue;

      updates.push({
        id: item.id,
        quantity,
        totalPrice: roundWhatsAppQueueMoney(quantity * price),
        description: chosen.raw,
      });

      console.info(
        `[WhatsAppQueueHourFixV17_02] repair orderId=${orderId} itemId=${item.id} service=${item.serviceName || '?'} quantity=${quantity} price=${price} line=${chosen.raw}`,
      );
    }

    if (updates.length === 0) {
      console.info(`[WhatsAppQueueHourFixV17_02] done orderId=${orderId} repaired=0`);
      return;
    }

    const updatedItems = (order.items as WhatsAppQueueHourRepairItem[]).map((item) => {
      const update = updates.find((entry) => entry.id === item.id);
      return update
        ? {
            ...item,
            quantity: update.quantity,
            totalPrice: update.totalPrice,
            description: update.description,
          }
        : item;
    });

    const newOrderTotal = roundWhatsAppQueueMoney(
      updatedItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0),
    );

    await prisma.order.update({
      where: { id: orderId },
      data: {
        totalPrice: newOrderTotal,
        items: {
          update: updates.map((update) => ({
            where: { id: update.id },
            data: {
              quantity: update.quantity,
              totalPrice: update.totalPrice,
              description: update.description,
            },
          })),
        },
      },
    });

    console.info(
      `[WhatsAppQueueHourFixV17_02] done orderId=${orderId} repaired=${updates.length} total=${newOrderTotal}`,
    );
  } catch (err) {
    console.error(`[WhatsAppQueueHourFixV17_02] failed orderId=${orderId}:`, err);
  }
}

function queueDelayMs(): number {
  if (!Number.isFinite(WHATSAPP_TEXT_DELAY_MS)) return 12_000;
  return Math.min(Math.max(WHATSAPP_TEXT_DELAY_MS, 3_000), 60_000);
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
  const safeDelay = Math.min(Math.max(delayMs, 500), 60_000);

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
      await repairWhatsAppQueueZeroHourOrderItems({
        orderId: orderCreated.orderId,
        originalText: text,
      });
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
