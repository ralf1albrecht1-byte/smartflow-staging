/**
 * V17.90L283 – zentraler Workflow-Snapshot-Lock.
 *
 * Beim Übergang Auftrag -> Angebot -> Rechnung ist der bereits im Editor
 * gespeicherte Payload die einzige Quelle für Leistungen und Arbeitsorte.
 * Es findet absichtlich kein semantisches oder positionsbasiertes Rematching
 * gegen ältere Auftragspositionen statt.
 */

export type WorkflowHandoffSourceSite = {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  sourceOrderId?: string | null;
};

export type WorkflowHandoffSourceOrder = {
  id?: string | null;
  originOrderIds?: string[] | null;
  siteAddressDifferent?: boolean | null;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  workSites?: WorkflowHandoffSourceSite[] | null;
};

export type WorkflowHandoffItem = {
  description?: string | null;
  serviceName?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unitPrice?: number | string | null;
  totalPrice?: number | string | null;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  sourceOrderId?: string | null;
  [key: string]: unknown;
};

const cleanText = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text || null;
};

const siteIdentity = (site: WorkflowHandoffSourceSite): string =>
  [
    cleanText(site.siteName),
    cleanText(site.siteAddress),
    cleanText(site.sitePlz),
    cleanText(site.siteCity),
    cleanText(site.siteNote),
  ]
    .map((value) => value || "")
    .join("\u241f");

const hasAnySiteValue = (site: WorkflowHandoffSourceSite): boolean =>
  Boolean(
    cleanText(site.siteName) ||
    cleanText(site.siteAddress) ||
    cleanText(site.sitePlz) ||
    cleanText(site.siteCity) ||
    cleanText(site.siteNote),
  );

function sourceSitesForOrder(
  order: WorkflowHandoffSourceOrder,
): WorkflowHandoffSourceSite[] {
  const workSites = Array.isArray(order?.workSites)
    ? order.workSites
        .map((site) => ({
          siteName: cleanText(site?.siteName),
          siteAddress: cleanText(site?.siteAddress),
          sitePlz: cleanText(site?.sitePlz),
          siteCity: cleanText(site?.siteCity),
          siteNote: cleanText(site?.siteNote),
          sourceOrderId: cleanText(site?.sourceOrderId) || cleanText(order?.id),
        }))
        .filter(hasAnySiteValue)
    : [];

  if (workSites.length > 0) return workSites;
  if (!order?.siteAddressDifferent) return [];

  const flatSite: WorkflowHandoffSourceSite = {
    siteName: cleanText(order?.siteName),
    siteAddress: cleanText(order?.siteAddress),
    sitePlz: cleanText(order?.sitePlz),
    siteCity: cleanText(order?.siteCity),
    siteNote: cleanText(order?.siteNote),
    sourceOrderId: cleanText(order?.id),
  };

  return hasAnySiteValue(flatSite) ? [flatSite] : [];
}

/**
 * Bewahrt den ausgehenden Stand byte-/wertnah und ergänzt eine fehlende
 * sourceOrderId nur dann deterministisch:
 * - exakter Arbeitsort-Treffer, oder
 * - genau ein Quellauftrag ohne mehrdeutige Multi-Site-Struktur.
 *
 * Keine Leistungsnamen-, Mengen-, Preis- oder Reihenfolgezuordnung.
 */
export function lockWorkflowHandoffItems<T extends WorkflowHandoffItem>(
  rawItems: T[] | null | undefined,
  rawSourceOrders: WorkflowHandoffSourceOrder[] | null | undefined,
): T[] {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const sourceOrders = Array.isArray(rawSourceOrders)
    ? rawSourceOrders.filter((order) => cleanText(order?.id))
    : [];

  const exactSiteSources = new Map<string, Set<string>>();
  const allSourceSites = sourceOrders.flatMap(sourceSitesForOrder);

  for (const site of allSourceSites) {
    const sourceOrderId = cleanText(site.sourceOrderId);
    if (!sourceOrderId) continue;
    const key = siteIdentity(site);
    const ids = exactSiteSources.get(key) || new Set<string>();
    ids.add(sourceOrderId);
    exactSiteSources.set(key, ids);
  }

  const singleOrder = sourceOrders.length === 1 ? sourceOrders[0] : null;
  const singleOrderSites = singleOrder ? sourceSitesForOrder(singleOrder) : [];
  const singleOrderHasAmbiguousSites =
    new Set(singleOrderSites.map(siteIdentity)).size > 1;

  return items.map((item) => {
    const lockedSite: WorkflowHandoffSourceSite = {
      siteName: cleanText(item?.siteName),
      siteAddress: cleanText(item?.siteAddress),
      sitePlz: cleanText(item?.sitePlz),
      siteCity: cleanText(item?.siteCity),
      siteNote: cleanText(item?.siteNote),
    };

    let sourceOrderId = cleanText(item?.sourceOrderId);

    if (!sourceOrderId && hasAnySiteValue(lockedSite)) {
      const candidates = exactSiteSources.get(siteIdentity(lockedSite));
      if (candidates?.size === 1) {
        sourceOrderId = Array.from(candidates)[0] || null;
      }
    }

    if (!sourceOrderId && singleOrder && !singleOrderHasAmbiguousSites) {
      sourceOrderId = cleanText(singleOrder.id);
    }

    return {
      ...item,
      siteName: lockedSite.siteName,
      siteAddress: lockedSite.siteAddress,
      sitePlz: lockedSite.sitePlz,
      siteCity: lockedSite.siteCity,
      siteNote: lockedSite.siteNote,
      sourceOrderId,
    } as T;
  });
}
