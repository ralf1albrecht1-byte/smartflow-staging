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
import { calculateLineTotal, roundMoney } from "@/lib/currency";

const compact = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text || null;
};

type SnapshotSite = {
  siteName: string | null;
  siteAddress: string | null;
  sitePlz: string | null;
  siteCity: string | null;
  siteNote: string | null;
  sourceOrderId: string | null;
};

const siteKey = (site: SnapshotSite): string =>
  [
    site.siteName,
    site.siteAddress,
    site.sitePlz,
    site.siteCity,
    site.siteNote,
    site.sourceOrderId,
  ]
    .map((value) => value || "")
    .join("\u241f");

const siteLocationKey = (site: SnapshotSite): string =>
  [site.siteName, site.siteAddress, site.sitePlz, site.siteCity, site.siteNote]
    .map((value) => value || "")
    .join("\u241f");

const hasSiteValue = (site: SnapshotSite): boolean =>
  Boolean(
    site.siteName ||
    site.siteAddress ||
    site.sitePlz ||
    site.siteCity ||
    site.siteNote,
  );

const snapshotSiteFromItem = (item: any): SnapshotSite => ({
  siteName: compact(item?.siteName),
  siteAddress: compact(item?.siteAddress),
  sitePlz: compact(item?.sitePlz),
  siteCity: compact(item?.siteCity),
  siteNote: compact(item?.siteNote),
  sourceOrderId: compact(item?.sourceOrderId),
});

const orderSourceAliases = (order: any): Set<string> => {
  const aliases = new Set<string>();
  const add = (value: unknown) => {
    const text = compact(value);
    if (text) aliases.add(text);
  };

  add(order?.id);
  (Array.isArray(order?.originOrderIds) ? order.originOrderIds : []).forEach(
    add,
  );
  (Array.isArray(order?.workSites) ? order.workSites : []).forEach(
    (site: any) => add(site?.sourceOrderId),
  );
  return aliases;
};

const orderLocationKeys = (order: any): Set<string> => {
  const keys = new Set<string>();
  const addSite = (site: SnapshotSite) => {
    if (hasSiteValue(site)) keys.add(siteLocationKey(site));
  };

  (Array.isArray(order?.workSites) ? order.workSites : []).forEach(
    (site: any) =>
      addSite({
        siteName: compact(site?.siteName),
        siteAddress: compact(site?.siteAddress),
        sitePlz: compact(site?.sitePlz),
        siteCity: compact(site?.siteCity),
        siteNote: compact(site?.siteNote),
        sourceOrderId: compact(site?.sourceOrderId),
      }),
  );

  if (order?.siteAddressDifferent) {
    addSite({
      siteName: compact(order?.siteName),
      siteAddress: compact(order?.siteAddress),
      sitePlz: compact(order?.sitePlz),
      siteCity: compact(order?.siteCity),
      siteNote: compact(order?.siteNote),
      sourceOrderId: compact(order?.id),
    });
  }

  return keys;
};

function resolveSnapshotOrderId(orders: any[], item: any): string | null {
  if (orders.length === 1) return orders[0].id;

  const explicitSourceOrderId = compact(item?.sourceOrderId);
  if (explicitSourceOrderId) {
    const matches = orders.filter((order) =>
      orderSourceAliases(order).has(explicitSourceOrderId),
    );
    if (matches.length === 1) return matches[0].id;
  }

  const itemSite = snapshotSiteFromItem(item);
  if (hasSiteValue(itemSite)) {
    const location = siteLocationKey(itemSite);
    const matches = orders.filter((order) =>
      orderLocationKeys(order).has(location),
    );
    if (matches.length === 1) return matches[0].id;
  }

  return null;
}

/**
 * POST /api/offers/[id]/revert
 *
 * V17.90L283:
 * Das Angebot ist beim Rückweg der aktuelle Workflow-Snapshot. Kunde,
 * Leistungen, Preise, Währung und Arbeitsorte werden exakt in die bereits
 * verknüpften Aufträge zurückgeschrieben. Original-Kundennachricht,
 * Kontakt-/Termin-/Gefahrhinweise, Medien und Auftragsstatus bleiben erhalten.
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
        items: { orderBy: { id: "asc" } },
        orders: {
          where: { dataScope },
          select: {
            id: true,
            description: true,
            serviceName: true,
            status: true,
            originOrderIds: true,
            siteAddressDifferent: true,
            siteName: true,
            siteAddress: true,
            sitePlz: true,
            siteCity: true,
            siteNote: true,
            workSites: {
              select: {
                id: true,
                siteName: true,
                siteAddress: true,
                sitePlz: true,
                siteCity: true,
                siteNote: true,
                sourceOrderId: true,
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

    const assignments = new Map<string, any[]>();
    offer.orders.forEach((order) => assignments.set(order.id, []));
    const unresolvedItems: any[] = [];

    for (const item of offer.items) {
      const orderId = resolveSnapshotOrderId(offer.orders, item);
      if (!orderId) {
        unresolvedItems.push(item);
        continue;
      }
      assignments.get(orderId)?.push(item);
    }

    if (unresolvedItems.length > 0) {
      return NextResponse.json(
        {
          error:
            "Zurücksetzen nicht möglich: Mindestens eine Leistung ist bei mehreren Quellaufträgen keinem Arbeitsort eindeutig zugeordnet.",
          unresolvedItems: unresolvedItems.map((item) => item.description),
        },
        { status: 409 },
      );
    }

    const orderIds = offer.orders.map((order) => order.id);
    const snapshotCounts: Record<string, number> = {};

    await prisma.$transaction(async (tx) => {
      for (const order of offer.orders) {
        const assignedItems = assignments.get(order.id) || [];
        snapshotCounts[order.id] = assignedItems.length;

        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
        await tx.orderWorkSite.deleteMany({ where: { orderId: order.id } });

        const siteMap = new Map<string, string>();
        const distinctSites = new Map<string, SnapshotSite>();

        for (const item of assignedItems) {
          const site = snapshotSiteFromItem(item);
          if (!hasSiteValue(site)) continue;
          distinctSites.set(siteKey(site), site);
        }

        const sites = Array.from(distinctSites.values());
        for (let index = 0; index < sites.length; index += 1) {
          const site = sites[index];
          const saved = await tx.orderWorkSite.create({
            data: {
              orderId: order.id,
              siteName: site.siteName,
              siteAddress: site.siteAddress,
              sitePlz: site.sitePlz,
              siteCity: site.siteCity,
              siteNote: site.siteNote,
              sourceOrderId: site.sourceOrderId,
              isPrimary: index === 0,
              sortOrder: index,
            },
            select: { id: true },
          });
          siteMap.set(siteKey(site), saved.id);
        }

        if (assignedItems.length > 0) {
          await tx.orderItem.createMany({
            data: assignedItems.map((item) => {
              const site = snapshotSiteFromItem(item);
              return {
                orderId: order.id,
                serviceName: compact(item.description) || "Leistung",
                description: compact(item.description) || "",
                quantity: Number(item.quantity ?? 1),
                unit: compact(item.unit) || "Stunde",
                unitPrice: roundMoney(Number(item.unitPrice ?? 0)),
                totalPrice: calculateLineTotal(
                  item.quantity ?? 1,
                  item.unitPrice ?? 0,
                ),
                workSiteId: hasSiteValue(site)
                  ? siteMap.get(siteKey(site)) || null
                  : null,
                sourceText: null,
                detectedCurrency: offer.currency === "EUR" ? "EUR" : "CHF",
                needsReview: false,
                reviewReason: null,
              };
            }),
          });
        }

        const net = roundMoney(
          assignedItems.reduce(
            (sum, item) =>
              sum + calculateLineTotal(item.quantity ?? 1, item.unitPrice ?? 0),
            0,
          ),
        );
        const vatRate = Number(offer.vatRate ?? 0);
        const vatAmount = roundMoney((net * vatRate) / 100);
        const total = roundMoney(net + vatAmount);
        const firstItem = assignedItems[0] || null;
        const firstSite = sites[0] || null;

        await tx.order.update({
          where: { id: order.id },
          data: {
            customerId: offer.customerId,
            offerId: null,
            description:
              assignedItems.length > 0
                ? assignedItems
                    .map((item) => compact(item.description))
                    .filter(Boolean)
                    .join(", ")
                : order.description,
            serviceName:
              compact(firstItem?.description) || compact(order.serviceName),
            priceType: compact(firstItem?.unit) || "Stunde",
            unitPrice: Number(firstItem?.unitPrice ?? 0),
            quantity: Number(firstItem?.quantity ?? 0),
            totalPrice: net,
            vatRate,
            vatAmount,
            total,
            currency: offer.currency === "EUR" ? "EUR" : "CHF",
            siteAddressDifferent: sites.length > 0,
            siteName: firstSite?.siteName || null,
            siteAddress: firstSite?.siteAddress || null,
            sitePlz: firstSite?.sitePlz || null,
            siteCity: firstSite?.siteCity || null,
            siteNote: firstSite?.siteNote || null,
          },
        });
      }

      await tx.offer.update({
        where: { id: offer.id },
        data: { deletedAt: new Date() },
      });
    });

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
        snapshotTransferred: true,
        snapshotItemCount: offer.items.length,
        snapshotCounts,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      revertedOrders: orderIds.length,
      snapshotTransferred: true,
    });
  } catch (error) {
    console.error("Offer revert error:", error);
    return NextResponse.json(
      { error: "Fehler beim Zurücksetzen" },
      { status: 500 },
    );
  }
}
