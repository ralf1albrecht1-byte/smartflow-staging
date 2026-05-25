import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildSpecialNotes,
  splitSpecialNotes,
} from "@/lib/special-notes-utils";

interface MergeRequest {
  targetOrderId: string;
  sourceOrderIds: string[];
  finalCustomerId?: string;
}

interface MergeWorkSiteInput {
  key: string;
  siteName: string | null;
  siteAddress: string | null;
  sitePlz: string | null;
  siteCity: string | null;
  siteNote: string | null;
  sortOrder: number;
  isPrimary: boolean;
  sourceOrderId: string | null;
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
  workSiteKey: string;
  sourceOrderId: string;
}

const normalizeMergeKeyPart = (value?: string | null) =>
  (value || "").trim().replace(/\s+/g, " ").toLowerCase();

const normalizeServiceKey = (value?: string | null) =>
  normalizeMergeKeyPart(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

const canonicalMergeServiceName = (value?: string | null) => {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  const key = normalizeServiceKey(name);

  if (
    /\b(anfahrt|anfahrt pauschal|fahrtkosten|fahrkosten|fahrpauschale|wegpauschale|deplacement|travel fee|travel cost|travel costs|trip fee|transport fee|trasferta|transferta|viaje)\b/i.test(
      key,
    )
  ) {
    return "Anfahrt";
  }

  if (
    /\b(clean floor|floor cleaning|bodenreinigung|boden reinigen|nettoyage du sol|nettoyage sol|pulizia pavimento|pulizia del pavimento|limpieza suelo|limpieza de suelo)\b/i.test(
      key,
    )
  ) {
    return "Boden reinigen";
  }

  if (
    /\b(clean windows|window cleaning|windows cleaning|fensterreinigung|fenster reinigen|nettoyage des vitres|nettoyage vitres|nettoyage des vitrines|nettoyage vitrines|vitres|vitrines|fenetres|pulizia finestre|pulizia delle finestre|limpieza ventanas|limpieza de ventanas)\b/i.test(
      key,
    )
  ) {
    return "Fenster reinigen";
  }

  return name;
};

const normalizeVatRate = (value?: number | string | null) => {
  const rate = Number(value || 0);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(rate * 100) / 100;
};

const getVatRateKey = (order: { vatRate?: number | string | null }) =>
  normalizeVatRate(order.vatRate).toFixed(2);

const formatVatRateLabel = (rate: number) => {
  if (rate <= 0) return "keine MwSt";

  return `${rate.toLocaleString("de-CH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} % MwSt`;
};

const buildVatMismatchNote = (targetOrder: any, sourceOrders: any[]) => {
  const allOrders = [targetOrder, ...sourceOrders];
  const vatKeys = new Set(allOrders.map(getVatRateKey));

  if (vatKeys.size <= 1) return "";

  const targetVatRate = normalizeVatRate(targetOrder.vatRate);
  const sourceLabels = sourceOrders.map((order, index) => {
    const rate = normalizeVatRate(order.vatRate);
    return `Quelle ${index + 1}: ${formatVatRateLabel(rate)}`;
  });

  return [
    "MwSt prüfen: Die verbundenen Aufträge hatten unterschiedliche MwSt-Einstellungen.",
    `Der verbundene Auftrag verwendet den MwSt-Satz des Hauptauftrags: ${formatVatRateLabel(targetVatRate)}.`,
    sourceLabels.join("; "),
    "Bitte vor Angebot oder Rechnung prüfen.",
  ]
    .filter(Boolean)
    .join(" ");
};

const uniqueTrimmedLines = (lines: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const cleaned = String(line || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(cleaned);
  }

  return result;
};

const cleanSiteValue = (value?: string | null) => {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (/^ausführungsadresse$/i.test(cleaned)) return null;
  if (/^ausfuehrungsadresse$/i.test(cleaned)) return null;
  return cleaned;
};

const siteKey = (site: {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
}) =>
  [site.siteName, site.siteAddress, site.sitePlz, site.siteCity]
    .map((value) => normalizeMergeKeyPart(value))
    .filter(Boolean)
    .join("|");

const siteLines = (site: {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
}) =>
  [
    cleanSiteValue(site.siteName),
    cleanSiteValue(site.siteAddress),
    [cleanSiteValue(site.sitePlz), cleanSiteValue(site.siteCity)]
      .filter(Boolean)
      .join(" "),
    cleanSiteValue(site.siteNote),
  ]
    .map((line) => String(line || "").trim())
    .filter(Boolean);

const fallbackSiteForOrder = (order: any): MergeWorkSiteInput => {
  const base = {
    siteName: cleanSiteValue(order.siteName),
    siteAddress: cleanSiteValue(order.siteAddress),
    sitePlz: cleanSiteValue(order.sitePlz),
    siteCity: cleanSiteValue(order.siteCity),
    siteNote: cleanSiteValue(order.siteNote),
  };

  const hasOrderSite = Boolean(
    base.siteName ||
    base.siteAddress ||
    base.sitePlz ||
    base.siteCity ||
    base.siteNote,
  );

  const site = hasOrderSite
    ? base
    : {
        siteName: null,
        siteAddress: cleanSiteValue(order.customer?.address),
        sitePlz: cleanSiteValue(order.customer?.plz),
        siteCity: cleanSiteValue(order.customer?.city),
        siteNote: null,
      };

  const key = siteKey(site) || `order:${order.id}`;

  return {
    key,
    ...site,
    sortOrder: 0,
    isPrimary: false,
    sourceOrderId: order.id,
  };
};

const getOrderSites = (order: any): MergeWorkSiteInput[] => {
  if (Array.isArray(order.workSites) && order.workSites.length > 0) {
    return order.workSites
      .slice()
      .sort(
        (a: any, b: any) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
      )
      .map((site: any, index: number) => {
        const normalized = {
          siteName: cleanSiteValue(site.siteName),
          siteAddress: cleanSiteValue(site.siteAddress),
          sitePlz: cleanSiteValue(site.sitePlz),
          siteCity: cleanSiteValue(site.siteCity),
          siteNote: cleanSiteValue(site.siteNote),
        };

        return {
          key:
            siteKey(normalized) || `worksite:${site.id || order.id}:${index}`,
          ...normalized,
          sortOrder: index,
          isPrimary: Boolean(site.isPrimary),
          sourceOrderId: site.sourceOrderId || order.id,
        };
      });
  }

  return [fallbackSiteForOrder(order)];
};

const getPrimarySiteForOrder = (order: any) => {
  const sites = getOrderSites(order);
  return sites.find((site) => site.isPrimary) || sites[0];
};

const getItemSiteKey = (order: any, item: any) => {
  if (item?.workSite) {
    const normalized = {
      siteName: cleanSiteValue(item.workSite.siteName),
      siteAddress: cleanSiteValue(item.workSite.siteAddress),
      sitePlz: cleanSiteValue(item.workSite.sitePlz),
      siteCity: cleanSiteValue(item.workSite.siteCity),
      siteNote: cleanSiteValue(item.workSite.siteNote),
    };
    return siteKey(normalized) || `worksite:${item.workSite.id}`;
  }

  return getPrimarySiteForOrder(order).key;
};

const buildItemMergeKey = (item: MergeItemInput) => {
  return [
    item.workSiteKey,
    normalizeMergeKeyPart(item.serviceName),
    normalizeMergeKeyPart(item.unit),
    Number(item.unitPrice || 0).toFixed(2),
  ].join("|");
};

const toMergeItem = (order: any, item: any): MergeItemInput => {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);

  const serviceName = canonicalMergeServiceName(
    item.serviceName || item.description || "Manuell prüfen",
  );

  return {
    serviceName,
    description: item.description || serviceName || "",
    quantity,
    unit: item.unit || "Stück",
    unitPrice,
    totalPrice: quantity * unitPrice,
    aiWarning: item.aiWarning || null,
    reviewReasons: item.reviewReasons || [],
    workSiteKey: getItemSiteKey(order, item),
    sourceOrderId: order.id,
  };
};

const mergeOrderItems = (orders: any[]) => {
  const merged = new Map<string, MergeItemInput>();

  for (const order of orders) {
    for (const rawItem of order.items || []) {
      const item = toMergeItem(order, rawItem);
      const hasUnsafeMerge =
        item.aiWarning?.trim() ||
        item.reviewReasons?.some((r) => r.startsWith("unit_mismatch:")) ||
        Number(item.quantity || 0) <= 0 ||
        Number(item.unitPrice || 0) <= 0;

      const key = hasUnsafeMerge
        ? `${buildItemMergeKey(item)}|${order.id}|${rawItem.id || Math.random()}`
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
                  .join("\n"),
        });
      } else {
        merged.set(key, item);
      }
    }
  }

  return Array.from(merged.values());
};

const buildWorkSiteGroups = (orders: any[]) => {
  const groups = new Map<string, MergeWorkSiteInput>();

  orders.forEach((order, orderIndex) => {
    getOrderSites(order).forEach((site, siteIndex) => {
      const key = site.key || `order:${order.id}:${siteIndex}`;
      if (groups.has(key)) return;

      groups.set(key, {
        ...site,
        key,
        sortOrder: groups.size,
        isPrimary: orderIndex === 0 && (site.isPrimary || siteIndex === 0),
        sourceOrderId: site.sourceOrderId || order.id,
      });
    });
  });

  const values = Array.from(groups.values());
  if (!values.some((site) => site.isPrimary) && values[0]) {
    values[0].isPrimary = true;
  }
  return values;
};

const buildExecutionAddressMismatchNote = (workSites: MergeWorkSiteInput[]) => {
  if (workSites.length <= 1) return "";

  const lines = workSites.map((site, index) => {
    const label = siteLines(site).join(", ") || "nicht angegeben";
    return `${index + 1}. ${label}`;
  });

  return [
    "Mehrere Ausführungsorte: Die verbundenen Aufträge haben unterschiedliche Arbeitsorte.",
    "Die Leistungen bleiben nach Ausführungsort getrennt gespeichert und müssen vor Angebot/Rechnung/PDF geprüft werden.",
    lines.join("; "),
  ]
    .filter(Boolean)
    .join(" ");
};

const mergeSpecialNotes = (orders: any[], extraJobHints: string[] = []) => {
  const safetyWarnings: string[] = [];
  const jobHints: string[] = [];
  const systemHints: string[] = [];

  for (const order of orders) {
    const split = splitSpecialNotes(order.specialNotes || "");

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

const getOriginOrderIds = (order: any) => {
  const existing = Array.isArray(order.originOrderIds)
    ? order.originOrderIds
        .map((id: unknown) => String(id || "").trim())
        .filter(Boolean)
    : [];
  return existing.length > 0 ? existing : [order.id];
};

const compactMergeText = (text: string) => {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^\s*WhatsApp:\s*\n?/gim, "")
    .replace(/\[Verbunden von Auftrag [^\]]+\]/g, "")
    .replace(/^\s*Hauptauftrag:\s*/im, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Nicht authentifiziert" },
        { status: 401 },
      );
    }

    const body: MergeRequest = await request.json();
    const { targetOrderId, sourceOrderIds, finalCustomerId } = body;

    if (!targetOrderId || !sourceOrderIds || !Array.isArray(sourceOrderIds)) {
      return NextResponse.json(
        { error: "Ungültige Parameter" },
        { status: 400 },
      );
    }

    if (sourceOrderIds.length === 0) {
      return NextResponse.json(
        { error: "Mindestens ein Quell-Auftrag erforderlich" },
        { status: 400 },
      );
    }

    if (sourceOrderIds.includes(targetOrderId)) {
      return NextResponse.json(
        { error: "Ziel-Auftrag darf nicht in Quell-Aufträgen enthalten sein" },
        { status: 400 },
      );
    }

    const userId = session.user.id;

    const result = await prisma.$transaction(async (tx) => {
      const orderInclude = {
        customer: true,
        workSites: true,
        items: { include: { workSite: true } },
      } as const;

      const targetOrder = await tx.order.findUnique({
        where: { id: targetOrderId },
        include: orderInclude,
      });

      if (!targetOrder) {
        throw new Error("Ziel-Auftrag nicht gefunden");
      }

      if (targetOrder.userId !== userId) {
        throw new Error("Keine Berechtigung für diesen Auftrag");
      }

      if (targetOrder.deletedAt) {
        throw new Error(
          "Gelöschte Aufträge können nicht zusammengeführt werden",
        );
      }

      const sourceOrders = await tx.order.findMany({
        where: {
          id: { in: sourceOrderIds },
          userId,
          deletedAt: null,
        },
        include: orderInclude,
      });

      if (sourceOrders.length !== sourceOrderIds.length) {
        throw new Error(
          "Einige Quell-Aufträge wurden nicht gefunden oder gehören nicht Ihnen",
        );
      }

      const allOrders = [targetOrder, ...sourceOrders];
      const originOrderIds = Array.from(
        new Set(allOrders.flatMap(getOriginOrderIds)),
      );

      if (originOrderIds.length > 5) {
        throw new Error(
          `Zusammenführen nicht möglich: Dieser Merge würde ${originOrderIds.length} Ursprungsaufträge enthalten. Maximal erlaubt sind 5.`,
        );
      }

      const hasInvoiceOrOffer =
        sourceOrders.some((o) => o.invoiceId || o.offerId) ||
        targetOrder.invoiceId ||
        targetOrder.offerId;

      if (hasInvoiceOrOffer) {
        throw new Error(
          "Aufträge mit Rechnungen oder Angeboten können nicht zusammengeführt werden",
        );
      }

      const ordersWithAudio = allOrders.filter(
        (order) => order.mediaUrl && order.mediaType === "audio",
      );

      if (ordersWithAudio.length > 1) {
        throw new Error(
          "Mehrere Aufträge mit Audio erkannt. Bitte nur einen Audio-Auftrag auswählen.",
        );
      }

      const targetHasAudio =
        targetOrder.mediaUrl && targetOrder.mediaType === "audio";
      const sourceWithAudio = sourceOrders.find(
        (order) => order.mediaUrl && order.mediaType === "audio",
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

      const currencies = Array.from(
        new Set(allOrders.map((order) => (order.currency || "CHF").trim())),
      );

      if (currencies.length > 1) {
        throw new Error(
          "Aufträge mit unterschiedlichen Währungen können nicht verbunden werden",
        );
      }

      const vatKeys = new Set(allOrders.map(getVatRateKey));
      const hasVatMismatch = vatKeys.size > 1;
      const vatMismatchNote = buildVatMismatchNote(targetOrder, sourceOrders);

      const workSiteGroups = buildWorkSiteGroups(allOrders);
      if (workSiteGroups.length > 5) {
        throw new Error(
          `Zusammenführen nicht möglich: ${workSiteGroups.length} unterschiedliche Arbeitsorte erkannt. Maximal erlaubt sind 5.`,
        );
      }

      const hasExecutionAddressMismatch = workSiteGroups.length > 1;
      const executionAddressMismatchNote =
        buildExecutionAddressMismatchNote(workSiteGroups);

      const hasDoubleMerge = allOrders.some(
        (o) =>
          o.reviewReasons?.includes("manual_order_merge") ||
          getOriginOrderIds(o).length > 1,
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
        .filter((o) => !o.reviewReasons?.includes("image_only_no_text"))
        .map((o) => {
          const originalText = compactMergeText(
            o.notes || o.audioTranscript || "",
          );
          const parts: string[] = [];

          parts.push("────────────");
          parts.push("Zusammengeführt mit:");
          parts.push("");

          if (originalText) {
            parts.push(originalText);
          }

          return parts.join("\n").trim();
        })
        .filter(Boolean)
        .join("\n");

      const mergedNotes = [
        "Hauptauftrag:",
        "",
        compactMergeText(targetOrder.notes || ""),
        additionalNotes,
      ]
        .filter((part) => part !== undefined && part !== null && part !== "")
        .join("\n");

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
        "manual_order_merge",
      ];

      if (hasCustomerMismatch)
        newReviewReasons.push("merged_different_customers");
      if (hasVatMismatch) newReviewReasons.push("vat_mismatch");
      if (hasExecutionAddressMismatch)
        newReviewReasons.push("merged_different_execution_addresses");
      if (hasDoubleMerge) newReviewReasons.push("double_merge");
      if (mergedItems.some((item) => Number(item.unitPrice || 0) <= 0)) {
        newReviewReasons.push("unit_price_review");
      }

      sourceOrders.forEach((o) => {
        if (o.reviewReasons) newReviewReasons.push(...o.reviewReasons);
      });

      const uniqueReviewReasons = [...new Set(newReviewReasons)];

      await tx.orderItem.deleteMany({ where: { orderId: targetOrderId } });
      await tx.orderWorkSite.deleteMany({ where: { orderId: targetOrderId } });

      const primarySite =
        workSiteGroups.find((site) => site.isPrimary) || workSiteGroups[0];
      const createdWorkSiteByKey = new Map<string, string>();

      for (const [index, site] of workSiteGroups.entries()) {
        const created = await tx.orderWorkSite.create({
          data: {
            orderId: targetOrderId,
            siteName: site.siteName,
            siteAddress: site.siteAddress,
            sitePlz: site.sitePlz,
            siteCity: site.siteCity,
            siteNote: site.siteNote,
            isPrimary: site.key === primarySite?.key,
            sortOrder: index,
            sourceOrderId: site.sourceOrderId,
          },
        });
        createdWorkSiteByKey.set(site.key, created.id);
      }

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
          hinweisLevel: "warning",
          totalPrice,
          vatAmount,
          total,
          originOrderIds,
          siteAddressDifferent: Boolean(primarySite),
          siteName: primarySite?.siteName || null,
          siteAddress: primarySite?.siteAddress || null,
          sitePlz: primarySite?.sitePlz || null,
          siteCity: primarySite?.siteCity || null,
          siteNote: primarySite?.siteNote || null,
          items: {
            create: mergedItems.map((item) => ({
              serviceName: item.serviceName,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              workSiteId: createdWorkSiteByKey.get(item.workSiteKey) || null,
            })),
          },
          ...audioData,
          audioTranscript:
            targetOrder.audioTranscript || sourceWithAudio
              ? mergedNotes
              : targetOrder.audioTranscript,
        },
        include: {
          items: { include: { workSite: true } },
          workSites: true,
          customer: true,
        },
      });

      await tx.order.updateMany({
        where: { id: { in: sourceOrderIds } },
        data: { deletedAt: new Date() },
      });

      return {
        success: true,
        mergedOrder: updatedOrder,
        mergedCount: sourceOrders.length,
        mergedItemsCount: mergedItems.length,
        hasDoubleMerge,
        hasCustomerMismatch,
        hasVatMismatch,
        hasExecutionAddressMismatch,
        workSiteCount: workSiteGroups.length,
        originOrderCount: originOrderIds.length,
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[ORDER MERGE] Error:", error);
    return NextResponse.json(
      { error: error.message || "Fehler beim Verbinden der Aufträge" },
      { status: 500 },
    );
  }
}
