import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

      if (finalCustomerId && !allCustomerIds.includes(finalCustomerId)) {
        throw new Error('Kunde muss aus ausgewählten Aufträgen stammen');
      }

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



const additionalNotes = sourceOrders
  .filter((o) => !o.reviewReasons?.includes('image_only_no_text'))
  .map((o) => {
    const parts: string[] = [];

    const customerName =
      o.customer?.name?.trim() || 'Unbekannter Kunde';

    parts.push(`Verbunden mit: ${customerName}`);

    if (o.customer?.address) {
      parts.push(o.customer.address);
    }

    const cityLine = [o.customer?.plz, o.customer?.city]
      .filter(Boolean)
      .join(' ');

    if (cityLine) {
      parts.push(cityLine);
    }

    parts.push('');

    for (const item of o.items || []) {
      const quantity = Number(item.quantity || 0);
      const unit = item.unit || '';
      const unitPrice = Number(item.unitPrice || 0);

      const quantityText =
        quantity > 0
          ? `${quantity} ${unit}`.trim()
          : unit;

      parts.push(
        `${item.serviceName || 'Leistung'} ${quantityText} à CHF ${unitPrice}`,
      );
    }

    if (o.notes) {
      parts.push('');
      parts.push(o.notes);
    }

    return parts.join('\n');
  })
  .filter(Boolean)
  .join('\n\n----------------------\n\n');

      const mergedNotes = [targetOrder.notes, additionalNotes]
        .filter(Boolean)
        .join('\n\n');

      const mergedItems = mergeOrderItems(allOrders);

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
          customerId: finalCustomerId || targetOrder.customerId,
          imageUrls: mergedImageUrls,
          thumbnailUrls: mergedThumbnailUrls,
          notes: mergedNotes,
          specialNotes: targetOrder.specialNotes,
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