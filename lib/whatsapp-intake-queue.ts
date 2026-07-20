import { prisma } from "@/lib/prisma";
import {
  createFallbackOrderFromRawPayload,
  processIncomingMessage,
} from "@/lib/order-intake";
import { logAuditAsync } from "@/lib/audit";
import { maskPhoneForLog } from "@/lib/phone";
import { rememberExecutionAddressesFromOrder } from "@/lib/customer-execution-addresses";

const DEFAULT_WHATSAPP_TEXT_DELAY_MS = 4_000;
const MIN_WHATSAPP_TEXT_DELAY_MS = 2_500;
const MAX_WHATSAPP_TEXT_DELAY_MS = 20_000;

const WHATSAPP_TEXT_DELAY_MS = Number.parseInt(
  process.env.WHATSAPP_TEXT_DELAY_MS ||
    process.env.WHATSAPP_TEXT_DEBOUNCE_MS ||
    String(DEFAULT_WHATSAPP_TEXT_DELAY_MS),
  10,
);

const CHANNEL = "whatsapp";
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
  const userId = String(resolvedUserId || "").trim();
  return `${CHANNEL}:user:${userId || "unknown-user"}`;
}

function buildMessageKey(messageSid: string, queueKey: string): string {
  const sid = String(messageSid || "").trim();
  if (sid) return `${CHANNEL}:${sid}`;
  return `${CHANNEL}:no-sid:${queueKey}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function scheduleWorker(queueKey: string, delayMs: number): void {
  const safeDelay = Math.min(
    Math.max(delayMs, 500),
    MAX_WHATSAPP_TEXT_DELAY_MS + 1_000,
  );

  const existing = scheduledWorkers.get(queueKey);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    scheduledWorkers.delete(queueKey);
    processWhatsAppTextQueueForSender(queueKey).catch((err) => {
      console.error(
        `[WhatsAppQueue] Worker failed for queueKey=${queueKey}:`,
        err,
      );
    });
  }, safeDelay);

  scheduledWorkers.set(queueKey, timer);
}

async function scheduleNextPendingForSender(queueKey: string): Promise<void> {
  const next = await prisma.intakeQueueMessage.findFirst({
    where: {
      channel: CHANNEL,
      senderKey: queueKey,
      status: "pending",
    },
    orderBy: [{ processAfter: "asc" }, { createdAt: "asc" }],
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
      status: "processing",
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: "pending",
      groupKey: null,
      error: "processing_timeout_reset",
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
  const enqueueStartedAtMsV17_90L337 = Date.now();
  const messageText = String(params.messageText || "").trim();
  if (!messageText) return { queued: false, duplicate: false };

  const delay = queueDelayMs();
  const processAfter = new Date(Date.now() + delay);
  const queueKey = normalizeQueueKey(params.resolvedUserId);
  const messageKey = buildMessageKey(params.messageSid, queueKey);

  // Twilio retries normally reuse the same SID and are caught by messageKey.
  // In practice we also see duplicate webhook deliveries with different SIDs
  // but identical text within seconds. Keep this as an exact short-window
  // idempotency guard so the same WhatsApp body cannot create two orders.
  const recentDuplicate = await prisma.intakeQueueMessage.findFirst({
    where: {
      channel: CHANNEL,
      senderKey: queueKey,
      messageText,
      status: { in: ["pending", "processing", "done"] },
      createdAt: { gte: new Date(Date.now() - 2 * 60_000) },
    },
    select: { id: true, messageSid: true, status: true },
  });

  if (recentDuplicate) {
    console.log(
      `[WhatsAppQueue] Duplicate text skipped: existingStatus=${recentDuplicate.status} sid=${recentDuplicate.messageSid || "none"} newSid=${params.messageSid || "none"}`,
    );
    return { queued: false, duplicate: true };
  }

  let queuedMessageV17_90L337: { id: string } | null = null;
  try {
    queuedMessageV17_90L337 = await prisma.intakeQueueMessage.create({
      data: {
        channel: CHANNEL,
        senderKey: queueKey,
        messageKey,
        messageSid: params.messageSid || null,
        source: "WhatsApp",
        senderName: params.profileName || "Unbekannt",
        phoneNumber: params.phoneNumber || null,
        userId: params.resolvedUserId || null,
        messageText,
        status: "pending",
        processAfter,
      },
    });
  } catch (err: any) {
    // DB-level dedupe for Twilio retries / parallel webhook delivery.
    if (err?.code === "P2002") {
      console.log(
        `[WhatsAppQueue] Duplicate SID skipped: ${params.messageSid}`,
      );
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
    action: "WHATSAPP_TEXT_QUEUED",
    area: "WEBHOOK",
    details: {
      phone: maskPhoneForLog(params.phoneNumber),
      sid: params.messageSid || null,
      delayMs: delay,
      mode: "individual_serial_queue",
      chars: messageText.length,
    },
  });

  console.log(
    `[WhatsAppQueue] Queued 1 text message for ${maskPhoneForLog(params.phoneNumber)}: ${messageText.length} chars delayMs=${delay}`,
  );
  console.log(
    `[WhatsAppPerf] queue_enqueued queueKey=${queueKey} id=${queuedMessageV17_90L337?.id || "unknown"} sid=${params.messageSid || "none"} chars=${messageText.length} delayMs=${delay} enqueueMs=${Date.now() - enqueueStartedAtMsV17_90L337} processAfter=${processAfter.toISOString()}`,
  );

  // Always schedule the earliest pending item. If a new item arrives while an
  // earlier item is already waiting, this may reschedule the same worker, but
  // it still processes FIFO and never combines texts.
  const scheduleStartMsV17_90L337 = Date.now();
  await scheduleNextPendingForSender(queueKey);
  console.log(
    `[WhatsAppPerf] queue_worker_scheduled queueKey=${queueKey} sid=${params.messageSid || "none"} scheduleMs=${Date.now() - scheduleStartMsV17_90L337} totalEnqueueMs=${Date.now() - enqueueStartedAtMsV17_90L337}`,
  );

  return { queued: true, duplicate: false };
}

const DEFAULT_MAX_PARALLEL_WHATSAPP_TEXT_JOBS = 2;
const MAX_ALLOWED_PARALLEL_WHATSAPP_TEXT_JOBS = 3;

function maxParallelWhatsAppTextJobs(): number {
  const configured = Number.parseInt(
    process.env.WHATSAPP_TEXT_MAX_PARALLEL ||
      String(DEFAULT_MAX_PARALLEL_WHATSAPP_TEXT_JOBS),
    10,
  );

  if (!Number.isFinite(configured)) {
    return DEFAULT_MAX_PARALLEL_WHATSAPP_TEXT_JOBS;
  }

  return Math.min(
    Math.max(configured, 1),
    MAX_ALLOWED_PARALLEL_WHATSAPP_TEXT_JOBS,
  );
}

async function claimNextPendingWhatsAppTextMessage(
  queueKey: string,
): Promise<any | null> {
  const next = await prisma.intakeQueueMessage.findFirst({
    where: {
      channel: CHANNEL,
      senderKey: queueKey,
      status: "pending",
      processAfter: { lte: new Date() },
    },
    orderBy: [{ processAfter: "asc" }, { createdAt: "asc" }],
  });

  if (!next) return null;

  const groupKey = `wa_text_parallel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const locked = await prisma.intakeQueueMessage.updateMany({
    where: {
      id: next.id,
      status: "pending",
    },
    data: {
      status: "processing",
      groupKey,
    },
  });

  if (locked.count === 0) return undefined;

  return {
    ...next,
    status: "processing",
    groupKey,
  };
}

async function processClaimedWhatsAppTextMessage(
  message: any,
): Promise<void> {
  const text = String(message.messageText || "").trim();

  if (!text) {
    await prisma.intakeQueueMessage.update({
      where: { id: message.id },
      data: {
        status: "done",
        processedAt: new Date(),
        error: null,
      },
    });
    return;
  }

  const processingStartedAtMsV17_90L337 = Date.now();
  const createdAtMsV17_90L337 = message.createdAt
    ? new Date(message.createdAt).getTime()
    : null;
  const processAfterMsV17_90L337 = message.processAfter
    ? new Date(message.processAfter).getTime()
    : null;

  console.log(
    `[WhatsAppQueue] Processing 1 text message for ${maskPhoneForLog(message.phoneNumber || "")}: ${text.length} chars`,
  );
  console.log(
    `[WhatsAppPerf] queue_processing_start queueKey=${message.senderKey || "unknown"} id=${message.id} sid=${message.messageSid || "none"} chars=${text.length} queuedAgeMs=${createdAtMsV17_90L337 ? processingStartedAtMsV17_90L337 - createdAtMsV17_90L337 : "unknown"} dueLagMs=${processAfterMsV17_90L337 ? processingStartedAtMsV17_90L337 - processAfterMsV17_90L337 : "unknown"}`,
  );

  try {
    const intakeStartedAtMsV17_90L337 = Date.now();
    const orderCreated = await processIncomingMessage({
      source: "WhatsApp",
      senderName: message.senderName || "Unbekannt",
      messageText: text,
      phoneNumber: message.phoneNumber || null,
      imageBase64: null,
      imageMimeType: "image/jpeg",
      savedMediaPath: null,
      savedMediaType: null,
      optimizedPreviewPath: null,
      optimizedThumbnailPath: null,
      userId: message.userId || null,
    });
    console.log(
      `[WhatsAppPerf] queue_intake_done queueKey=${message.senderKey || "unknown"} id=${message.id} sid=${message.messageSid || "none"} durationMs=${Date.now() - intakeStartedAtMsV17_90L337} orderId=${orderCreated?.orderId || "none"}`,
    );

    if (orderCreated?.orderId) {
      console.info(
        `[WhatsAppQueueHourFixV17_27] skipped post-persist repair orderId=${orderCreated.orderId}; semantic intake result kept as source of truth`,
      );

      // V17.71: WhatsApp-Aufträge laufen nicht durch app/api/orders/route.ts.
      // Deshalb muss die kundenbasierte Ausführungsort-Persistenz hier direkt
      // nach der Order-Erstellung passieren. Sonst erscheint der neue Ort erst,
      // wenn der Nutzer im Auftrag manuell "Adresse speichern" drückt.
      try {
        const orderForExecutionAddress = await prisma.order.findUnique({
          where: { id: orderCreated.orderId },
          include: {
            customer: true,
            items: { include: { workSite: true } },
            workSites: true,
          },
        });

        if (orderForExecutionAddress) {
          // V17.90L194: Persist only the already-canonical address stored on
          // the order. Never parse the raw WhatsApp text a second time after
          // the AI result has been validated and saved.
          const savedFromOrder = await rememberExecutionAddressesFromOrder(
            prisma,
            { userId: message.userId || null, order: orderForExecutionAddress },
          );

          if (savedFromOrder > 0) {
            console.info(
              `[CustomerExecutionAddressV17_90L194] WhatsApp persisted canonical execution addresses orderId=${orderCreated.orderId} fromOrder=${savedFromOrder}`,
            );
          }
        }
      } catch (executionAddressError) {
        console.warn(
          `[CustomerExecutionAddressV17_71] WhatsApp execution address persist failed orderId=${orderCreated.orderId}`,
          executionAddressError,
        );
      }
    }

    await prisma.intakeQueueMessage.update({
      where: { id: message.id },
      data: {
        status: "done",
        processedAt: new Date(),
        error: null,
      },
    });
    console.log(
      `[WhatsAppPerf] queue_processing_done queueKey=${message.senderKey || "unknown"} id=${message.id} sid=${message.messageSid || "none"} durationMs=${Date.now() - processingStartedAtMsV17_90L337} orderId=${orderCreated?.orderId || "none"}`,
    );

    logAuditAsync({
      userId: message.userId || undefined,
      action: "WHATSAPP_TEXT_QUEUE_PROCESSED",
      area: "WEBHOOK",
      details: {
        phone: maskPhoneForLog(message.phoneNumber || ""),
        messageCount: 1,
        mode: "individual_parallel_queue",
        chars: text.length,
        orderCreated: Boolean(orderCreated),
        description: orderCreated?.description || null,
      },
    });
  } catch (err: any) {
    const errorMessage =
      err?.message || String(err) || "Unknown queue processing error";

    console.error(
      `[WhatsAppQueue] Processing failed for ${maskPhoneForLog(message.phoneNumber || "")}:`,
      err,
    );

    // V17.90L235: Last-resort fail-visible path.
    // A canonical/DB/runtime error must never make a WhatsApp message disappear.
    // The main intake already attempts the richer safe-canonical recovery. If
    // that still fails, create a raw review order containing the complete
    // customer message so the user can inspect and complete it manually.
    const failureCode = String(errorMessage || "unknown")
      .replace(/[^a-zA-Z0-9:_-]+/g, "_")
      .slice(0, 180);

    // Avoid creating a second fallback order if the main order was already
    // committed and only a later non-critical step threw.
    if (message.userId && text) {
      try {
        const recentCommittedOrder = await prisma.order.findFirst({
          where: {
            userId: message.userId,
            createdAt: { gte: new Date(Date.now() - 90_000) },
            notes: {
              contains: `WhatsApp:\n${text.slice(0, 220)}`,
            },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (recentCommittedOrder?.id) {
          await prisma.intakeQueueMessage.update({
            where: { id: message.id },
            data: {
              status: "done",
              processedAt: new Date(),
              error: `order_already_committed_after_error:${failureCode}`.slice(
                0,
                4000,
              ),
              retryCount: { increment: 1 },
            },
          });
          console.error(
            `[WhatsAppQueue] Main order ${recentCommittedOrder.id} was already committed; no duplicate fallback created`,
          );
          return;
        }
      } catch (dedupeCheckError) {
        console.warn(
          "[WhatsAppQueue] Recent committed-order check failed; continuing with review fallback",
          dedupeCheckError,
        );
      }
    }

    let recoveredReviewOrder: Awaited<
      ReturnType<typeof createFallbackOrderFromRawPayload>
    > = null;

    try {
      recoveredReviewOrder = await createFallbackOrderFromRawPayload(
        {
          source: "WhatsApp",
          senderName: message.senderName || "Unbekannt",
          messageText: text,
          phoneNumber: message.phoneNumber || null,
          imageBase64: null,
          imageMimeType: "image/jpeg",
          savedMediaPath: null,
          savedMediaType: null,
          optimizedPreviewPath: null,
          optimizedThumbnailPath: null,
          userId: message.userId || null,
        },
        `intake_processing_error:${failureCode}`,
      );
    } catch (fallbackError) {
      console.error(
        `[WhatsAppQueue] Raw review fallback also failed for ${maskPhoneForLog(message.phoneNumber || "")}:`,
        fallbackError,
      );
    }

    if (recoveredReviewOrder?.orderId) {
      await prisma.intakeQueueMessage.update({
        where: { id: message.id },
        data: {
          status: "done",
          processedAt: new Date(),
          error: `recovered_as_review_order:${failureCode}`.slice(0, 4000),
          retryCount: { increment: 1 },
        },
      });

      console.error(
        `[WhatsAppQueue] 🛟 Failed intake preserved as review order ${recoveredReviewOrder.orderId}`,
      );

      logAuditAsync({
        userId: message.userId || undefined,
        action: "WHATSAPP_TEXT_QUEUE_RECOVERED_AS_REVIEW_ORDER",
        area: "WEBHOOK",
        targetType: "Order",
        targetId: recoveredReviewOrder.orderId,
        success: true,
        details: {
          phone: maskPhoneForLog(message.phoneNumber || ""),
          messageCount: 1,
          mode: "individual_parallel_queue",
          originalError: errorMessage,
        },
      });
      return;
    }

    await prisma.intakeQueueMessage.update({
      where: { id: message.id },
      data: {
        status: "failed",
        error: errorMessage.slice(0, 4000),
        retryCount: { increment: 1 },
      },
    });

    logAuditAsync({
      userId: message.userId || undefined,
      action: "WHATSAPP_TEXT_QUEUE_FAILED",
      area: "WEBHOOK",
      success: false,
      details: {
        phone: maskPhoneForLog(message.phoneNumber || ""),
        messageCount: 1,
        mode: "individual_parallel_queue",
        error: errorMessage,
      },
    });
  }
}

async function processWhatsAppTextQueueSlot(queueKey: string): Promise<void> {
  while (true) {
    const message = await claimNextPendingWhatsAppTextMessage(queueKey);

    // undefined means another worker claimed the same FIFO row first. Retry
    // immediately so this free slot can claim the next pending message.
    if (message === undefined) continue;
    if (message === null) return;

    await processClaimedWhatsAppTextMessage(message);
  }
}

export async function processWhatsAppTextQueueForSender(
  queueKey: string,
): Promise<void> {
  await resetStaleProcessingMessages(queueKey);

  const maxParallel = maxParallelWhatsAppTextJobs();
  const activeCount = await prisma.intakeQueueMessage.count({
    where: {
      channel: CHANNEL,
      senderKey: queueKey,
      status: "processing",
    },
  });
  const availableSlots = Math.max(0, maxParallel - activeCount);

  if (availableSlots === 0) {
    scheduleWorker(queueKey, 1_000);
    return;
  }

  console.log(
    `[WhatsAppQueue] Parallel worker start queueKey=${queueKey} active=${activeCount} slots=${availableSlots} max=${maxParallel}`,
  );

  await Promise.all(
    Array.from({ length: availableSlots }, () =>
      processWhatsAppTextQueueSlot(queueKey),
    ),
  );

  await scheduleNextPendingForSender(queueKey);
}
