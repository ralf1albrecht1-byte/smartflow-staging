export type CustomerExecutionAddressInput = {
  customerId?: string | null;
  userId?: string | null;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  country?: string | null;
};

const compact = (value?: string | null) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

const normalizeKeyPart = (value?: string | null) =>
  compact(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/strasse|straße|str\./g, "str")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function normalizeExecutionAddress(input: CustomerExecutionAddressInput) {
  const customerId = compact(input.customerId);
  const siteAddress = compact(input.siteAddress);
  const sitePlz = compact(input.sitePlz);
  const siteCity = compact(input.siteCity);

  if (!customerId || !siteAddress || !sitePlz || !siteCity) return null;

  return {
    customerId,
    userId: compact(input.userId) || null,
    siteName: compact(input.siteName) || null,
    siteAddress,
    sitePlz,
    siteCity,
    siteNote: compact(input.siteNote) || null,
    country: compact(input.country) || "CH",
  };
}

export function executionAddressIdentityKey(input: CustomerExecutionAddressInput): string {
  const normalized = normalizeExecutionAddress(input);
  if (!normalized) return "";
  return [
    normalizeKeyPart(normalized.siteAddress),
    normalizeKeyPart(normalized.sitePlz),
    normalizeKeyPart(normalized.siteCity),
  ].join("|");
}

export async function rememberCustomerExecutionAddress(
  prisma: any,
  input: CustomerExecutionAddressInput,
): Promise<any | null> {
  const normalized = normalizeExecutionAddress(input);
  if (!normalized) return null;

  const table = prisma?.customerExecutionAddress;
  if (!table) return null;

  const existingRows = await table.findMany({
    where: {
      customerId: normalized.customerId,
      deletedAt: null,
    },
    orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }],
    take: 50,
  });

  const key = executionAddressIdentityKey(normalized);
  const existing = existingRows.find(
    (row: any) => executionAddressIdentityKey(row) === key,
  );

  if (existing) {
    return table.update({
      where: { id: existing.id },
      data: {
        siteName: existing.siteName || normalized.siteName,
        siteNote: normalized.siteNote || existing.siteNote,
        country: normalized.country || existing.country || "CH",
        userId: existing.userId || normalized.userId,
        usageCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  }

  return table.create({
    data: {
      customerId: normalized.customerId,
      userId: normalized.userId,
      siteName: normalized.siteName,
      siteAddress: normalized.siteAddress,
      sitePlz: normalized.sitePlz,
      siteCity: normalized.siteCity,
      siteNote: normalized.siteNote,
      country: normalized.country,
      usageCount: 1,
      lastUsedAt: new Date(),
    },
  });
}

function hasUnresolvedAddressRoleReview(order: any): boolean {
  const reasons = Array.isArray(order?.reviewReasons) ? order.reviewReasons : [];
  return reasons.some((reason: any) => {
    const key = String(reason || "").toLowerCase();
    return (
      key === "address_role_uncertain" ||
      key.includes("address_role_uncertain") ||
      key.includes("customer_address_quarantined") ||
      key.includes("ambiguous_role")
    );
  });
}

function hasCompleteExecutionAddress(input: CustomerExecutionAddressInput): boolean {
  return Boolean(
    compact(input.siteAddress) &&
      compact(input.sitePlz) &&
      compact(input.siteCity),
  );
}

function isSameAsBillingAddress(order: any, input: CustomerExecutionAddressInput): boolean {
  const customer = order?.customer;
  if (!customer) return false;

  const executionKey = [
    normalizeKeyPart(input.siteAddress),
    normalizeKeyPart(input.sitePlz),
    normalizeKeyPart(input.siteCity),
  ].join("|");
  const billingKey = [
    normalizeKeyPart(customer?.address),
    normalizeKeyPart(customer?.plz),
    normalizeKeyPart(customer?.city),
  ].join("|");

  return Boolean(executionKey && billingKey && executionKey === billingKey);
}

export async function rememberExecutionAddressesFromOrder(
  prisma: any,
  params: {
    userId?: string | null;
    order: any;
  },
): Promise<number> {
  const order = params.order;
  const customerId = compact(order?.customerId);
  if (!customerId) return 0;

  // V17.69: Unsichere Adressrollen dürfen nicht automatisch als
  // kundenbasierter Ausführungsort gespeichert werden. Wenn die Rolle noch
  // offen ist, muss der Nutzer zuerst im Prüfkasten entscheiden.
  if (hasUnresolvedAddressRoleReview(order)) return 0;

  const seen = new Set<string>();
  let saved = 0;

  const remember = async (input: CustomerExecutionAddressInput) => {
    const candidate = { ...input, customerId };
    if (!hasCompleteExecutionAddress(candidate)) return;
    if (isSameAsBillingAddress(order, candidate)) return;

    const key = executionAddressIdentityKey(candidate);
    if (!key || seen.has(key)) return;
    seen.add(key);

    const row = await rememberCustomerExecutionAddress(prisma, {
      ...candidate,
      userId: params.userId || order?.userId || null,
    });
    if (row) saved += 1;
  };

  // V17.69: Nicht mehr nur vom Flag `siteAddressDifferent` abhängig machen.
  // Bei WhatsApp-/Order-Create kann die vollständige Ausführungsadresse bereits
  // vorhanden sein, während das Flag noch nicht sauber gesetzt ist. Genau dann
  // muss der Ausführungsort trotzdem sofort am Kunden gespeichert werden.
  await remember({
    siteName: order?.siteName,
    siteAddress: order?.siteAddress,
    sitePlz: order?.sitePlz,
    siteCity: order?.siteCity,
    siteNote: order?.siteNote,
  });

  const workSites = Array.isArray(order?.workSites) ? order.workSites : [];
  for (const site of workSites) {
    await remember({
      siteName: site?.siteName,
      siteAddress: site?.siteAddress,
      sitePlz: site?.sitePlz,
      siteCity: site?.siteCity,
      siteNote: site?.siteNote,
    });
  }

  return saved;
}

export type ParsedExecutionAddressBlock = {
  siteName: string | null;
  siteAddress: string;
  sitePlz: string;
  siteCity: string;
  siteNote: string | null;
};

function parseStreetFromExecutionAddressLine(value: string): string | null {
  const raw = compact(value)
    .replace(/^\s*(?:adresse|anschrift|strasse|straße|street\s+address|address)\s*:?\s*/i, "")
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return null;

  const houseNumber = "\\d+[a-zA-Z]?(?:\\s*[/-]\\s*\\d+[a-zA-Z]?)?";
  const word = "[A-ZÄÖÜa-zäöüß][A-Za-zÄÖÜäöüß'.-]*";
  const suffix =
    "(?:strasse|straße|str\\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|street|road|lane)";
  const patterns = [
    new RegExp(`\\b((?:${word}\\s+){0,3}${word}${suffix}\\s+${houseNumber})\\b`, "i"),
    new RegExp(`\\b((?:${word}\\s+){1,4}${suffix}\\s+${houseNumber})\\b`, "i"),
    new RegExp(
      `\\b((?:rue|avenue|av\\.?|chemin|via|viale)\\s+${word}(?:\\s+(?:de|des|du|del|della|la|le|les|l['’]?|d['’]?|${word})){0,6}\\s+${houseNumber})\\b`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, " ").trim();
  }

  return null;
}

function parsePlzCityFromExecutionAddressLine(
  value: string,
): { plz: string | null; city: string | null } {
  const cleaned = compact(value)
    .replace(/^\s*(?:plz\s*\/\s*ort|plz|ort|postleitzahl|zip|postal\s+code|ville|city)\s*:?\s*/i, "")
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const match = cleaned.match(
    /\b(\d{4,5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{1,60}?)(?=\s*(?:$|[,;.]))/i,
  );
  if (!match) return { plz: null, city: null };

  const city = String(match[2] || "")
    .replace(/[,;:.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return { plz: match[1] || null, city: city || null };
}

export function extractExplicitExecutionAddressFromText(
  ...values: unknown[]
): ParsedExecutionAddressBlock | null {
  const source = compact(
    values
      .map((value) => String(value ?? ""))
      .filter(Boolean)
      .join("\n"),
  );
  if (!source) return null;

  const lines = source
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const markerRegex =
    /^\s*(?:ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsadresse|arbeitsort|einsatzadresse|einsatzort|serviceadresse|baustelle|job\s*site|work\s*address|work\s*site|lieu\s+d['’]?intervention|adresse\s+de\s+travail|ausführung|ausfuehrung|objekt)\b\s*:?\s*(.*)$/i;
  const stopRegex =
    /^\s*(?:rechnung\s+(?:geht\s+)?an|rechnungsadresse|rechnungskunde|billing\s+address|bill\s+to|invoice\s+customer|kontakt|kontaktperson|ansprechperson|besonderheiten|bemerkungen|hinweise|leistungen|leistungsübersicht|leistungsuebersicht|termin|datum)\s*:?/i;
  const priceOrCalculationLineRegex =
    /(?:\b(?:chf|eur|franken|euro|sfr|stutz)\b|€|\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|stk|stück|stueck|pcs?|meter|m)\b|\b(?:à|a|je|mal|x)\s*\d+(?:[.,]\d+)?\b|\d+(?:[.,]\d+)?\s*(?:chf|eur|fr\.?|€)\b)/i;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].match(markerRegex);
    if (!marker) continue;

    const blockLines: string[] = [];
    if (marker[1]?.trim()) blockLines.push(marker[1].trim());

    for (let offset = 1; offset <= 8; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (stopRegex.test(line)) break;
      if (priceOrCalculationLineRegex.test(line) && blockLines.length > 0) break;
      blockLines.push(line);
    }

    if (blockLines.length === 0) continue;

    let siteName: string | null = null;
    let siteAddress: string | null = null;
    let sitePlz: string | null = null;
    let siteCity: string | null = null;
    const notes: string[] = [];

    for (const line of blockLines) {
      if (priceOrCalculationLineRegex.test(line)) break;

      const street = parseStreetFromExecutionAddressLine(line);
      if (street && !siteAddress) {
        siteAddress = street;
        continue;
      }

      const plzCity = parsePlzCityFromExecutionAddressLine(line);
      if (plzCity.plz && !sitePlz) sitePlz = plzCity.plz;
      if (plzCity.city && !siteCity) siteCity = plzCity.city;
      if (plzCity.plz || plzCity.city) continue;

      const cleanedLine = compact(line);
      if (!cleanedLine) continue;
      if (!siteName) siteName = cleanedLine;
      else notes.push(cleanedLine);
    }

    if (!siteAddress || !sitePlz || !siteCity) continue;

    return {
      siteName: siteName || null,
      siteAddress,
      sitePlz,
      siteCity,
      siteNote: notes.length > 0 ? notes.join(" · ") : null,
    };
  }

  return null;
}

export async function rememberExplicitExecutionAddressFromTextForOrder(
  prisma: any,
  params: {
    userId?: string | null;
    order: any;
    text?: string | null;
  },
): Promise<number> {
  const order = params.order;
  const customerId = compact(order?.customerId);
  if (!customerId) return 0;
  if (hasUnresolvedAddressRoleReview(order)) return 0;

  // V17.90L194: Legacy callers may still invoke this helper, but raw text may
  // never create or alter an execution address after the canonical order has
  // been persisted. The text parser is diagnostic only. A write is permitted
  // only when it resolves to exactly the same address identity already stored
  // on the order; the canonical order fields remain authoritative.
  const canonical: CustomerExecutionAddressInput = {
    customerId,
    userId: params.userId || order?.userId || null,
    siteName: order?.siteName || null,
    siteAddress: order?.siteAddress || null,
    sitePlz: order?.sitePlz || null,
    siteCity: order?.siteCity || null,
    siteNote: order?.siteNote || null,
  };
  if (!hasCompleteExecutionAddress(canonical)) return 0;
  if (isSameAsBillingAddress(order, canonical)) return 0;

  const explicit = extractExplicitExecutionAddressFromText(params.text);
  if (!explicit) return 0;
  if (executionAddressIdentityKey(explicit) !== executionAddressIdentityKey(canonical)) {
    return 0;
  }

  const row = await rememberCustomerExecutionAddress(prisma, canonical);
  return row ? 1 : 0;
}
