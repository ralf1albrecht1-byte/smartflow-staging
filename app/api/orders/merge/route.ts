import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { targetOrderId, sourceOrderIds } = body;

    if (!targetOrderId || !sourceOrderIds || !Array.isArray(sourceOrderIds)) {
      return NextResponse.json(
        { error: 'Ungültige Parameter' },
        { status: 400 }
      );
    }

    if (sourceOrderIds.length === 0) {
      return NextResponse.json(
        { error: 'Mindestens ein Quell-Auftrag erforderlich' },
        { status: 400 }
      );
    }

    if (sourceOrderIds.includes(targetOrderId)) {
      return NextResponse.json(
        { error: 'Ziel-Auftrag darf nicht in Quell-Aufträgen enthalten sein' },
        { status: 400 }
      );
    }

    const userId = session.user.id;

    const result = await prisma.$transaction(async (tx) => {
      const targetOrder = await tx.order.findUnique({
        where: { id: targetOrderId },
        include: { customer: true },
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
        include: { customer: true },
      });

      if (sourceOrders.length !== sourceOrderIds.length) {
        throw new Error('Einige Quell-Aufträge wurden nicht gefunden oder gehören nicht Ihnen');
      }

      const hasInvoiceOrOffer =
        sourceOrders.some((o) => (o as any).invoiceId || (o as any).offerId) ||
        (targetOrder as any).invoiceId ||
        (targetOrder as any).offerId;

      if (hasInvoiceOrOffer) {
        throw new Error('Aufträge mit Rechnungen oder Angeboten können nicht zusammengeführt werden');
      }

      const allCustomerIds = [targetOrder.customerId, ...sourceOrders.map((o) => o.customerId)];
      const uniqueCustomerIds = [...new Set(allCustomerIds)];
      const hasCustomerMismatch = uniqueCustomerIds.length > 1;

      const mergedImageUrls = [
        ...(targetOrder.imageUrls || []),
        ...sourceOrders.flatMap((o) => o.imageUrls || []),
      ];

      const mergedThumbnailUrls = [
        ...(targetOrder.thumbnailUrls || []),
        ...sourceOrders.flatMap((o) => o.thumbnailUrls || []),
      ];

      const additionalNotes = sourceOrders
        .filter((o) => o.notes || o.specialNotes)
        .map((o) => `[Zusammengeführt von Auftrag ${o.id.slice(-8)}]\n${o.notes || ''}\n${o.specialNotes || ''}`)
        .join('\n\n');

      const mergedNotes = targetOrder.notes
        ? `${targetOrder.notes}\n\n${additionalNotes}`
        : additionalNotes;

      const newReviewReasons = [
        ...(targetOrder.reviewReasons || []),
        'manual_order_merge',
      ];

      let warningText = 'Mehrere Aufträge wurden manuell zusammengeführt. Bitte prüfen.';

      if (hasCustomerMismatch) {
        newReviewReasons.push('merged_different_customers');
        warningText += '\nZusammengeführte Aufträge hatten unterschiedliche oder unvollständige Kundendaten. Bitte prüfen.';
      }

      sourceOrders.forEach((o) => {
        if (o.reviewReasons) {
          newReviewReasons.push(...o.reviewReasons);
        }
      });

      const uniqueReviewReasons = [...new Set(newReviewReasons)];

      const updatedOrder = await tx.order.update({
        where: { id: targetOrderId },
        data: {
          imageUrls: mergedImageUrls,
          thumbnailUrls: mergedThumbnailUrls,
          notes: mergedNotes,
          specialNotes: targetOrder.specialNotes
            ? `${targetOrder.specialNotes}\n\n${warningText}`
            : warningText,
          reviewReasons: uniqueReviewReasons,
          needsReview: true,
          hinweisLevel: 'warning',
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
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[ORDER MERGE] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Fehler beim Zusammenführen der Aufträge' },
      { status: 500 }
    );
  }
}
