export type DocumentSiteLike = {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  sourceOrderId?: string | null;
};

export type DocumentSiteOperationalContext = DocumentSiteLike & {
  label: string;
  text: string;
};

const compact = (value: unknown) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

const normalize = (value: unknown) =>
  String(value ?? "")
    .toLocaleLowerCase("de-CH")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const documentSiteAddressKey = (site?: DocumentSiteLike | null) =>
  [site?.siteAddress, site?.sitePlz, site?.siteCity]
    .map(normalize)
    .join("|");

const hasCompleteAddress = (site?: DocumentSiteLike | null) =>
  Boolean(
    String(site?.siteAddress || "").trim() &&
      String(site?.sitePlz || "").trim() &&
      String(site?.siteCity || "").trim(),
  );

function splitMergedMessageSections(value: unknown): string[] {
  const source = compact(value);
  if (!source) return [];
  const sections = source
    .split(
      /\n\s*(?:─{3,}|-{3,})\s*\n|\n\s*(?:Hauptauftrag|Zusammengeführt mit|Zusammengefuehrt mit)\s*:\s*/gi,
    )
    .map((section) => section.trim())
    .filter(Boolean);
  return sections.length > 0 ? sections : [source];
}

function extractOperationalTail(section: string): string {
  const source = compact(section);
  if (!source) return "";

  const appointmentMarker = source.search(
    /(?:^|\n)\s*(?:Gewünschter\s+)?Ausführungs?termin\s*:\s*/i,
  );
  if (appointmentMarker >= 0) {
    return source.slice(appointmentMarker).trim().slice(0, 2400);
  }

  const lines = source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstOperationalIndex = lines.findIndex((line) =>
    /\b(?:vor\s+der\s+ankunft|vorher|whatsapp|sms|e-?mail|anrufen|zugang|zutritt|schlüssel|schluessel|code|tor|parkplatz|parken|achtung|hund|keine\s+reinigungsarbeiten|keine\s+arbeiten|nichts\s+reinigen)\b/i.test(
      line,
    ),
  );
  return firstOperationalIndex >= 0
    ? lines.slice(firstOperationalIndex).join("\n").slice(0, 2400)
    : "";
}

function findSiteSection(source: unknown, site: DocumentSiteLike): string {
  const sections = splitMergedMessageSections(source);
  if (sections.length === 0) return "";
  const nameKey = normalize(site.siteName);
  const addressKey = normalize(site.siteAddress);
  const locationKey = normalize(
    [site.sitePlz, site.siteCity].filter(Boolean).join(" "),
  );

  const scored = sections
    .map((section) => {
      const key = normalize(section);
      let score = 0;
      if (nameKey && key.includes(nameKey)) score += 40;
      if (addressKey && key.includes(addressKey)) score += 60;
      if (locationKey && key.includes(locationKey)) score += 10;
      return { section, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.section || "";
}

export function buildDocumentSiteOperationalContexts(
  orders: Array<{
    id?: string | null;
    notes?: string | null;
    workSites?: DocumentSiteLike[] | null;
  }> | null | undefined,
): DocumentSiteOperationalContext[] {
  const result: DocumentSiteOperationalContext[] = [];
  const seen = new Set<string>();

  for (const order of orders || []) {
    const sites = (order?.workSites || []).filter(hasCompleteAddress);
    if (sites.length <= 1) continue;

    for (const site of sites) {
      const key = documentSiteAddressKey(site);
      if (!key || seen.has(key)) continue;
      const section = findSiteSection(order?.notes, site);
      const text = extractOperationalTail(section);
      if (!text) continue;
      seen.add(key);
      result.push({
        siteName: site.siteName || null,
        siteAddress: site.siteAddress || null,
        sitePlz: site.sitePlz || null,
        siteCity: site.siteCity || null,
        sourceOrderId: site.sourceOrderId || order?.id || null,
        label:
          String(site.siteName || "").trim() ||
          String(site.siteAddress || "").trim() ||
          "Ausführungsort",
        text,
      });
    }
  }

  return result;
}
