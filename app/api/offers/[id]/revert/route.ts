export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveDataScope } from "@/lib/data-scope";
import {
  requireUserId,
  unauthorizedResponse,
  getSessionUser,
} from "@/lib/get-session";
import { logAuditAsync } from "@/lib/audit";

const compact = (value: unknown) => String(value ?? "").trim();

const hasCompleteExecutionAddress = (site: {
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
}) =>
  Boolean(
    compact(site.siteAddress) && compact(site.sitePlz) && compact(site.siteCity),
  );

/**
 * POST /api/offers/[id]/revert
 * Moves an offer back to orders stage without duplicating records.
 *
 * V17.90L280:
 * - Multi-Site orders remain untouched.
 * - A single execution site is valid only with street, postal code and city.
 * - Impossible reverse-handoff leftovers such as siteName="stermin" with an
 *   empty address are cleared while the order is reactivated.
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

    const offer = await prisma.offer.findFirst({
      where: { id: params?.id, userId, dataScope, deletedAt: null },
      include: {
        orders: {
          where: { dataScope },
          select: {
            id: true,
            siteAddressDifferent: true,
            siteName: true,
            siteAddress: true,
            sitePlz: true,
            siteCity: true,
            siteNote: true,
            workSites: {
              select: {
                siteName: true,
                siteAddress: true,
                sitePlz: true,
                siteCity: true,
              },
            },
          },
        },
      },
    });

    if (!offer) {
      return NextResponse.json(
        { error: "Angebot nicht gefunden" },
        { status: 404 },
      );
    }

    const linkedInvoice = await prisma.invoice.findFirst({
      where: {
        sourceOfferId: offer.id,
        userId,
        dataScope,
        deletedAt: null,
      },
      select: { id: true, invoiceNumber: true },
    });

    if (linkedInvoice) {
      return NextResponse.json(
        {
          error: `Kann nicht zurücksetzen — Rechnung ${linkedInvoice.invoiceNumber} ist mit diesem Angebot verknüpft. Bitte zuerst die Rechnung löschen oder zurücksetzen.`,
        },
        { status: 409 },
      );
    }

    const orderIds = offer.orders.map((order) => order.id);
    const repairedOrderIds: string[] = [];

    await prisma.$transaction([
      ...offer.orders.map((order) => {
        const completeWorkSites = (order.workSites || []).filter(
          hasCompleteExecutionAddress,
        );
        const flatSiteIsComplete = hasCompleteExecutionAddress(order);
        const hasValidStoredExecutionSite = Boolean(
          completeWorkSites.length > 0 || flatSiteIsComplete,
        );
        const mustClearInvalidReverseState = Boolean(
          order.siteAddressDifferent && !hasValidStoredExecutionSite,
        );

        if (mustClearInvalidReverseState) {
          repairedOrderIds.push(order.id);
        }

        return prisma.order.update({
          where: { id: order.id },
          data: mustClearInvalidReverseState
            ? {
                offerId: null,
                siteAddressDifferent: false,
                siteName: null,
                siteAddress: null,
                sitePlz: null,
                siteCity: null,
                siteNote: null,
              }
            : { offerId: null },
        });
      }),
      prisma.offer.update({
        where: { id: offer.id },
        data: { deletedAt: new Date() },
      }),
    ]);

    const sessionUser = await getSessionUser();
    logAuditAsync({
      userId,
      action: "OFFER_REVERT_TO_ORDER",
      area: "OFFERS",
      targetType: "Offer",
      targetId: offer.id,
      success: true,
      userEmail: sessionUser?.email,
      userRole: sessionUser?.role,
      details: {
        offerNumber: offer.offerNumber,
        revertedOrderIds: orderIds,
        repairedInvalidExecutionStateOrderIds: repairedOrderIds,
      },
    });

    return NextResponse.json({
      success: true,
      revertedOrders: orderIds.length,
      repairedExecutionStates: repairedOrderIds.length,
    });
  } catch (error) {
    console.error("Offer revert error:", error);
    return NextResponse.json(
      { error: "Fehler beim Zurücksetzen" },
      { status: 500 },
    );
  }
}
