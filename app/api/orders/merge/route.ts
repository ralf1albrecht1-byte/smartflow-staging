import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface MergeRequest {
  targetOrderId: string;
  sourceOrderIds: string[];
  finalCustomerId?: string; // Optional customer switch (must be from selected orders)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      );
    }

    const body: MergeRequest = await request.json();
    const { targetOrderId, sourceOrderIds, finalCustomerId } = body;

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

    // Max 5 orders total validation
    const totalOrders = 1 + sourceOrderIds.length;
    if (totalOrders > 5) {
      return NextResponse.json(
        { error: 'Maximal 5 Aufträge gleichzeitig verbinden' },
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
        sourceOrders.some((o) => o.invoiceId || o.offerId) ||
        targetOrder.invoiceId ||
        targetOrder.offerId;

      if (hasInvoiceOrOffer) {
        throw new Error('Aufträge mit Rechnungen oder Angeboten können nicht zusammengeführt werden');
      }

      // AUDIO VALIDATION: Check for multiple audio orders
      const ordersWithAudio = [targetOrder, ...sourceOrders].filter(
        (order) => order.mediaUrl && order.mediaType === 'audio'
      );

      if (ordersWithAudio.length > 1) {
        throw new Error('Mehrere Aufträge mit Audio erkannt. Bitte nur einen Audio-Auftrag auswählen.');
      }

      // AUDIO PRESERVATION: Find audio to preserve
      const targetHasAudio = targetOrder.mediaUrl && targetOrder.mediaType === 'audio';
      const sourceWithAudio = sourceOrders.find(
        (order) => order.mediaUrl && order.mediaType === 'audio'
      );

      let audioData: Record<string, unknown> = {};

      if (sourceWithAudio && !targetHasAudio) {
        // Copy audio fields from source to target
        audioData = {
          mediaUrl: sourceWithAudio.mediaUrl,
          mediaType: sourceWithAudio.mediaType,
          audioTranscript: sourceWithAudio.audioTranscript,
          audioDurationSec: sourceWithAudio.audioDurationSec,
          audioTranscriptionStatus: sourceWithAudio.audioTranscriptionStatus,
        };
      }
      // If target already has audio, keep it (audioData stays empty)

      // Validate finalCustomerId if provided — must come from selected orders
      const allCustomerIds = [targetOrder.customerId, ...sourceOrders.map((o) => o.customerId)];
      if (finalCustomerId) {
        if (!allCustomerIds.includes(finalCustomerId)) {
          throw new Error('Kunde muss aus ausgewählten Aufträgen stammen');
        }
      }

      const uniqueCustomerIds = [...new Set(allCustomerIds)];
      const hasCustomerMismatch = uniqueCustomerIds.length > 1;

      // Double-merge detection: check if any order was already merged before
      const allOrders = [targetOrder, ...sourceOrders];
      const hasDoubleMerge = allOrders.some(
        (o) => o.reviewReasons?.includes('manual_order_merge')
      );

      // Merge images
      const mergedImageUrls = [
        ...(targetOrder.imageUrls || []),
        ...sourceOrders.flatMap((o) => o.imageUrls || []),
      ];

      const mergedThumbnailUrls = [
        ...(targetOrder.thumbnailUrls || []),
        ...sourceOrders.flatMap((o) => o.thumbnailUrls || []),
      ];

      // Merge notes - skip AI-generated descriptions from image-only orders
      const additionalNotes = sourceOrders
        .filter((o) => !o.reviewReasons?.includes('image_only_no_text'))
        .map((o) => {
          const parts: string[] = [];
          if (o.notes) parts.push(o.notes);
          if (o.audioTranscript && !o.notes?.includes(o.audioTranscript)) {
            parts.push(`Transkript: ${o.audioTranscript}`);
          }
          if (parts.length > 0) {
            return `[Verbunden von Auftrag ${o.id.slice(-8)}]\n${parts.join('\n\n')}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n\n');

      const mergedNotes = targetOrder.notes
        ? `${targetOrder.notes}\n\n${additionalNotes}`
        : additionalNotes;

      const newReviewReasons = [
        ...(targetOrder.reviewReasons || []),
        'manual_order_merge',
      ];

      let warningText = 'Mehrere Aufträge wurden manuell verbunden. Bitte prüfen.';

      if (hasCustomerMismatch) {
        newReviewReasons.push('merged_different_customers');
        warningText +=
          '\nVerbundene Aufträge hatten unterschiedliche oder unvollständige Kundendaten. Bitte prüfen.';
      }

      if (hasDoubleMerge) {
        newReviewReasons.push('double_merge');
        warningText +=
          '\nMindestens ein ausgewählter Auftrag wurde bereits früher verbunden.';
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
          customerId: finalCustomerId || targetOrder.customerId,
          imageUrls: mergedImageUrls,
          thumbnailUrls: mergedThumbnailUrls,
          notes: mergedNotes,
          specialNotes: targetOrder.specialNotes
            ? `${targetOrder.specialNotes}\n\n${warningText}`
            : warningText,
          reviewReasons: uniqueReviewReasons,
          needsReview: true,
          hinweisLevel: 'warning',
          // Preserve audio fields from source if target has no audio
          ...audioData,
        },
      });

      // Soft-delete source orders (move to Papierkorb)
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
        hasDoubleMerge,
        hasCustomerMismatch,
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[ORDER MERGE] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Fehler beim Verbinden der Aufträge' },
      { status: 500 }
    );
  }
}
