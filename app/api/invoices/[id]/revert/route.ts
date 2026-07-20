export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePositionType, getPositionBlockingIssues } from "@/lib/position-types";
import { getActiveDataScope } from "@/lib/data-scope";
import {
  requireUserId,
  unauthorizedResponse,
  getSessionUser,
} from "@/lib/get-session";
import { logAuditAsync } from "@/lib/audit";
import { calculateLineTotal, roundMoney } from "@/lib/currency";

/**
 * POST /api/invoices/[id]/revert
 *
 * V17.90L283:
 * Die Rechnung ist beim Rückweg der aktuelle Workflow-Snapshot. Das bestehende
 * Angebot wird reaktiviert und erhält exakt Kunde, Beträge, Leistungen,
 * Reihenfolge und Arbeitsortdaten der Rechnung. Angebotsnummer, Angebotsdatum,
 * Gültigkeit, Angebots-PDF-Text und der vorherige Angebotsstatus bleiben
 * dokumentbezogen erhalten.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }

    const dataScope = await getActiveDataScope(userId);
    const invoice = await prisma.invoice.findFirst({
      where: { id: params?.id, userId, dataScope, deletedAt: null },
      include: {
        items: true,
        orders: {
          where: { dataScope },
          select: { id: true },
        },
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: "Rechnung nicht gefunden" },
        { status: 404 },
      );
    }

    const sourceOfferId = invoice.sourceOfferId;
    const orderIds = invoice.orders.map((order) => order.id);
    let reactivatedOffer = false;

    await prisma.$transaction(async (tx) => {
      if (sourceOfferId) {
        const offer = await tx.offer.findFirst({
          where: { id: sourceOfferId, userId, dataScope },
          select: { id: true },
        });

        if (offer) {
          await tx.offer.update({
            where: { id: offer.id },
            data: {
              customerId: invoice.customerId,
              subtotal: roundMoney(Number(invoice.subtotal ?? 0)),
              vatRate: Number(invoice.vatRate ?? 0),
              vatAmount: roundMoney(Number(invoice.vatAmount ?? 0)),
              total: roundMoney(Number(invoice.total ?? 0)),
              currency: invoice.currency === "EUR" ? "EUR" : "CHF",
              deletedAt: null,
              items: {
                deleteMany: {},
                create: invoice.items.map((item) => ({
                  description: item.description,
                  positionType: normalizePositionType((item as any).positionType),
                  quantity: Number(item.quantity ?? 1),
                  unit: item.unit || "Stunde",
                  unitPrice: roundMoney(Number(item.unitPrice ?? 0)),
                  totalPrice: calculateLineTotal(
                    item.quantity ?? 1,
                    item.unitPrice ?? 0,
                  ),
                  siteName: item.siteName,
                  siteAddress: item.siteAddress,
                  sitePlz: item.sitePlz,
                  siteCity: item.siteCity,
                  siteNote: item.siteNote,
                  sourceOrderId: item.sourceOrderId,
                })),
              },
            },
          });
          reactivatedOffer = true;
        }
      }

      if (orderIds.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: orderIds }, userId, dataScope },
          data: { invoiceId: null },
        });
      }

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          deletedAt: new Date(),
          ...(reactivatedOffer ? { sourceOfferId: null } : {}),
        },
      });
    });

    const sessionUser = await getSessionUser();
    logAuditAsync({
      userId,
      action: "INVOICE_REVERT_TO_OFFER",
      area: "INVOICES",
      targetType: "Invoice",
      targetId: invoice.id,
      success: true,
      userEmail: sessionUser?.email,
      userRole: sessionUser?.role,
      details: {
        invoiceNumber: invoice.invoiceNumber,
        sourceOfferId,
        reactivatedOffer,
        revertedOrderIds: orderIds,
        snapshotTransferred: reactivatedOffer,
        snapshotItemCount: invoice.items.length,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      reactivatedOffer,
      revertedOrders: orderIds.length,
      snapshotTransferred: reactivatedOffer,
    });
  } catch (error) {
    console.error("Invoice revert error:", error);
    return NextResponse.json(
      { error: "Fehler beim Zurücksetzen" },
      { status: 500 },
    );
  }
}
