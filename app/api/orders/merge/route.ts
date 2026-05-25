import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildSpecialNotes, splitSpecialNotes } from '@/lib/special-notes-utils';

interface MergeRequest {
  targetOrderId: string;
  sourceOrderIds: string[];
  finalCustomerId?: string;
}

interface MergeItemInput {
  serviceName: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  aiWarning?: string | null;
  reviewReasons?: string[] | null;
}

const normalizeMergeKeyPart = (value?: string | null) =>
  (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const buildItemMergeKey = (item: MergeItemInput) => {
  return [
    normalizeMergeKeyPart(item.serviceName),
    normalizeMergeKeyPart(item.unit),
    Number(item.unitPrice || 0).toFixed(2),
  ].join('|');
};

const normalizeVatRate = (value?: number | string | null) => {
  const rate = Number(value || 0);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(rate * 100) / 100;
};

const getVatRateKey = (order: { vatRate?: number | string | null }) =>
  normalizeVatRate(order.vatRate).toFixed(2);

const formatVatRateLabel = (rate: number) => {
  if (rate <= 0) return 'keine MwSt';

  return `${rate.toLocaleString('de-CH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} % MwSt`;
};

const buildVatMismatchNote = (targetOrder: any, sourceOrders: any[]) => {
  const allOrders = [targetOrder, ...sourceOrders];
  const vatKeys = new Set(allOrders.map(getVatRateKey));

  if (vatKeys.size <= 1) return '';

  const targetVatRate = normalizeVatRate(targetOrder.vatRate);
  const sourceLabels = sourceOrders.map((order, index) => {
    const rate = normalizeVatRate(order.vatRate);
    return `Quelle ${index + 1}: ${formatVatRateLabel(rate)}`;
  });

  return [
    'MwSt prüfen: Die verbundenen Aufträge hatten unterschiedliche MwSt-Einstellungen.',
    `Der verbundene Auftrag verwendet den MwSt-Satz des Hauptauftrags: ${formatVatRateLabel(targetVatRate)}.`,
    sourceLabels.join('; '),
    'Bitte vor Angebot oder Rechnung prüfen.',
  ]
    .filter(Boolean)
    .join(' ');
};

const toMergeItem = (item: any): MergeItemInput => {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);

  return {
  serviceName: item.serviceName || 'Manuell prüfen',
  description: item.description || item.serviceName || '',
  quantity,
  unit: item.unit || 'Stück',
  unitPrice,
  totalPrice: quantity * unitPrice,
  aiWarning: item.aiWarning || null,
  reviewReasons: item.reviewReasons || [],
};
};

const mergeOrderItems = (orders: any[]) => {
  const merged = new Map<string, MergeItemInput>();

  for (const order of orders) {
    for (const rawItem of order.items || []) {
      const item = toMergeItem(rawItem);
     const hasUnsafeMerge =
  item.aiWarning?.trim() ||
  item.reviewReasons?.some((r) =>
    r.startsWith('unit_mismatch:'),
  ) ||
  Number(item.quantity || 0) <= 0 ||
  Number(item.unitPrice || 0) <= 0;

const key = hasUnsafeMerge
  ? `${buildItemMergeKey(item)}|${order.id}|${Math.random()}`
  : buildItemMergeKey(item);

const existing = merged.get(key);

if (existing && !hasUnsafeMerge) {
  const quantity = existing.quantity + item.quantity;

  merged.set(key, {
    ...existing,
    quantity,
    totalPrice: quantity * existing.unitPrice,
    description:
      existing.description === item.description
        ? existing.description
        : [existing.description, item.description]
            .filter(Boolean)
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .join('\n'),
  });
} else {
  merged.set(key, item);
}
    }
  }

  return Array.from(merged.values());
};

const uniqueTrimmedLines = (lines: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const cleaned = String(line || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(cleaned);
  }

  return result;
};

const normalizeMergeCompareValue = (value?: string | null) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const getOrderExecutionAddressLines = (order: any): string[] => {
  const lines = [
    order.siteName,
    order.siteAddress,
    [order.sitePlz, order.siteCity].filter(Boolean).join(' '),
    order.siteNote,
  ]
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  if (lines.length > 0) return lines;

  const customerFallback = [
    order.customer?.address,
    [order.customer?.plz, order.customer?.city].filter(Boolean).join(' '),
  ]
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  return customerFallback;
};

const getOrderExecutionAddressKey = (order: any) =>
  getOrderExecutionAddressLines(order)
    .map(normalizeMergeCompareValue)
    .filter(Boolean)
    .join('|');

const buildExecutionAddressMismatchNote = (targetOrder: any, sourceOrders: any[]) => {
  const allOrders = [targetOrder, ...sourceOrders];
  const uniqueAddresses = Array.from(
    new Map(
      allOrders
        .map((order) => [getOrderExecutionAddressKey(order), getOrderExecutionAddressLines(order)] as const)
        .filter(([key, lines]) => Boolean(key) && lines.length > 0),
    ).values(),
  );

  if (uniqueAddresses.length <= 1) return '';

  const targetAddress = getOrderExecutionAddressLines(targetOrder).join(', ') || 'nicht angegeben';
  const sourceAddresses = sourceOrders
    .map((order, index) => {
      const address = getOrderExecutionAddressLines(order).join(', ');
      return address ? `Quelle ${index + 1}: ${address}` : '';
    })
    .filter(Boolean)
    .join('; ');

  return [
    'Ausführungsadresse prüfen: Die verbundenen Aufträge hatten unterschiedliche Arbeitsorte.',
    `Sichtbarer Arbeitsort bleibt der Hauptauftrag: ${targetAddress}.`,
    sourceAddresses,
    'Bitte vor Angebot oder Rechnung prüfen.',
  ]
    .filter(Boolean)
    .join(' ');
};

const mergeSpecialNotes = (orders: any[], extraJobHints: string[] = []) => {
  const safetyWarnings: string[] = [];
  const jobHints: string[] = [];
  const systemHints: string[] = [];

  for (const order of orders) {
    const split = splitSpecialNotes(order.specialNotes || '');

    safetyWarnings.push(...split.safetyWarnings);
    jobHints.push(...split.jobHints);
    systemHints.push(...split.systemHints);
  }

  jobHints.push(...extraJobHints);

  return buildSpecialNotes({
    safetyWarnings: uniqueTrimmedLines(safetyWarnings),
    jobHints: uniqueTrimmedLines(jobHints),
    systemHints: uniqueTrimmedLines(systemHints),
  });
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 },
      );
    }

    const body: MergeRequest = await request.json();
    const { targetOrderId, sourceOrderIds, finalCustomerId } = body;

    if (!targetOrderId || !sourceOrderIds || !Array.isArray(sourceOrderIds)) {
      return NextResponse.json(
        { error: 'Ungültige Parameter' },
        { status: 400 },
      );
    }

    if (sourceOrderIds.length === 0) {
      return NextResponse.json(
        { error: 'Mindestens ein Quell-Auftrag erforderlich' },
        { status: 400 },
      );
    }

    if (sourceOrderIds.includes(targetOrderId)) {
      return NextResponse.json(
        { error: 'Ziel-Auftrag darf nicht in Quell-Aufträgen enthalten sein' },
        { status: 400 },
      );
    }

    const totalOrders = 1 + sourceOrderIds.length;
    if (totalOrders > 5) {
      return NextResponse.json(
        { error: 'Maximal 5 Aufträge gleichzeitig verbinden' },
        { status: 400 },
      );
    }

    const userId = session.user.id;

    const result = await prisma.$transaction(async (tx) => {
      const targetOrder = await tx.order.findUnique({
        where: { id: targetOrderId },
        include: {
          customer: true,
          items: true,
        },
      });

      if (!targetOrder) {
        throw new Error('Ziel-Auftrag nicht gefunden');
      }

      if (targetOrder.userId !== userId) {
        throw new Error('Keine Berechtigung für diesen Auftrag');
      }

      if (targetOrder.deletedAt) {
        throw new Error('Gelöschte Aufträge können nicht zusammengeführt werden');
      }

      const sourceOrders = await tx.order.findMany({
        where: {
          id: { in: sourceOrderIds },
          userId,
          deletedAt: null,
        },
        include: {
          customer: true,
          items: true,
        },
      });

      if (sourceOrders.length !== sourceOrderIds.length) {
        throw new Error(
          'Einige Quell-Aufträge wurden nicht gefunden oder gehören nicht Ihnen',
        );
      }

      const hasInvoiceOrOffer =
        sourceOrders.some((o) => o.invoiceId || o.offerId) ||
        targetOrder.invoiceId ||
        targetOrder.offerId;

      if (hasInvoiceOrOffer) {
        throw new Error(
          'Aufträge mit Rechnungen oder Angeboten können nicht zusammengeführt werden',
        );
      }

      const ordersWithAudio = [targetOrder, ...sourceOrders].filter(
        (order) => order.mediaUrl && order.mediaType === 'audio',
      );

      if (ordersWithAudio.length > 1) {
        throw new Error(
          'Mehrere Aufträge mit Audio erkannt. Bitte nur einen Audio-Auftrag auswählen.',
        );
      }

      const targetHasAudio =
        targetOrder.mediaUrl && targetOrder.mediaType === 'audio';
      const sourceWithAudio = sourceOrders.find(
        (order) => order.mediaUrl && order.mediaType === 'audio',
      );

      let audioData: Record<string, unknown> = {};

      if (sourceWithAudio && !targetHasAudio) {
        audioData = {
          mediaUrl: sourceWithAudio.mediaUrl,
          mediaType: sourceWithAudio.mediaType,
          audioTranscript: sourceWithAudio.audioTranscript,
          audioDurationSec: sourceWithAudio.audioDurationSec,
          audioTranscriptionStatus: sourceWithAudio.audioTranscriptionStatus,
        };
      }

      const allCustomerIds = [
        targetOrder.customerId,
        ...sourceOrders.map((o) => o.customerId),
      ];

      const safeFinalCustomerId =
        finalCustomerId && allCustomerIds.includes(finalCustomerId)
          ? finalCustomerId
          : targetOrder.customerId;

      const uniqueCustomerIds = [...new Set(allCustomerIds)];
      const hasCustomerMismatch = uniqueCustomerIds.length > 1;

      const allOrders = [targetOrder, ...sourceOrders];
const currencies = Array.from(
  new Set(
    allOrders.map((order) => (order.currency || 'CHF').trim()),
  ),
);

if (currencies.length > 1) {
  throw new Error(
    'Aufträge mit unterschiedlichen Währungen können nicht verbunden werden',
  );
}

      const vatKeys = new Set(allOrders.map(getVatRateKey));
      const hasVatMismatch = vatKeys.size > 1;
      const vatMismatchNote = buildVatMismatchNote(targetOrder, sourceOrders);
      const executionAddressKeys = new Set(
        allOrders.map(getOrderExecutionAddressKey).filter(Boolean),
      );
      const hasExecutionAddressMismatch = executionAddressKeys.size > 1;
      const executionAddressMismatchNote = buildExecutionAddressMismatchNote(
        targetOrder,
        sourceOrders,
      );

      const hasDoubleMerge = allOrders.some((o) =>
        o.reviewReasons?.includes('manual_order_merge'),
      );

      const mergedImageUrls = [
        ...(targetOrder.imageUrls || []),
        ...sourceOrders.flatMap((o) => o.imageUrls || []),
      ];

      const mergedThumbnailUrls = [
        ...(targetOrder.thumbnailUrls || []),
        ...sourceOrders.flatMap((o) => o.thumbnailUrls || []),
      ];
const compactMergeText = (text: string) => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^\s*WhatsApp:\s*\n?/gim, '')
    .replace(/\[Verbunden von Auftrag [^\]]+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
const additionalNotes = sourceOrders
  .filter((o) => !o.reviewReasons?.includes('image_only_no_text'))
  .map((o) => {
    const originalText = compactMergeText(o.notes || o.audioTranscript || '');

    const parts: string[] = [];

    parts.push('────────────');
    parts.push('Zusammengeführt mit:');
    parts.push('');

    if (originalText) {
      parts.push(originalText);
    }

    return parts.join('\n').trim();
  })
  .filter(Boolean)
  .join('\n');
const mergedNotes = [
  'Hauptauftrag:',
  '',
  compactMergeText(targetOrder.notes || ''),
  additionalNotes,
]
  .filter((part) => part !== undefined && part !== null && part !== '')
  .join('\n');

      const mergedItems = mergeOrderItems(allOrders);
      const mergedSpecialNotes = mergeSpecialNotes(
        allOrders,
        [vatMismatchNote, executionAddressMismatchNote].filter(Boolean),
      );

      const totalPrice = mergedItems.reduce(
        (sum, item) => sum + Number(item.totalPrice || 0),
        0,
      );

      const vatRate = Number(targetOrder.vatRate || 0);
      const vatAmount = vatRate > 0 ? (totalPrice * vatRate) / 100 : 0;
      const total = totalPrice + vatAmount;

      const newReviewReasons = [
        ...(targetOrder.reviewReasons || []),
        'manual_order_merge',
      ];

      if (hasCustomerMismatch) {
        newReviewReasons.push('merged_different_customers');
      }

      if (hasVatMismatch) {
        newReviewReasons.push('vat_mismatch');
      }

      if (hasExecutionAddressMismatch) {
        newReviewReasons.push('merged_different_execution_addresses');
      }

      if (hasDoubleMerge) {
        newReviewReasons.push('double_merge');
      }

      if (mergedItems.some((item) => Number(item.unitPrice || 0) <= 0)) {
        newReviewReasons.push('unit_price_review');
      }

      sourceOrders.forEach((o) => {
        if (o.reviewReasons) {
          newReviewReasons.push(...o.reviewReasons);
        }
      });

      const uniqueReviewReasons = [...new Set(newReviewReasons)];

      await tx.orderItem.deleteMany({
        where: { orderId: targetOrderId },
      });

      const updatedOrder = await tx.order.update({
        where: { id: targetOrderId },
      data: {
  customerId: safeFinalCustomerId || targetOrder.customerId,
  imageUrls: mergedImageUrls,
  thumbnailUrls: mergedThumbnailUrls,
  notes: mergedNotes,
          specialNotes: mergedSpecialNotes,
          reviewReasons: uniqueReviewReasons,
          needsReview: true,
          hinweisLevel: 'warning',
          totalPrice,
          vatAmount,
          total,
          items: {
            create: mergedItems.map((item) => ({
              serviceName: item.serviceName,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
            })),
          },
          ...audioData,
          audioTranscript:
            targetOrder.audioTranscript || sourceWithAudio
              ? mergedNotes
              : targetOrder.audioTranscript,
        },
        include: {
          items: true,
          customer: true,
        },
      });

      await tx.order.updateMany({
        where: {
          id: { in: sourceOrderIds },
        },
        data: {
          deletedAt: new Date(),
        },
      });

      return {
        success: true,
        mergedOrder: updatedOrder,
        mergedCount: sourceOrders.length,
        mergedItemsCount: mergedItems.length,
        hasDoubleMerge,
        hasCustomerMismatch,
        hasVatMismatch,
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[ORDER MERGE] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Fehler beim Verbinden der Aufträge' },
      { status: 500 },
    );
  }
}