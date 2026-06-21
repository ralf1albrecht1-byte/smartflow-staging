// SMARTFLOW_V17_90L371J_POSITION_TYPE_ADDITIONAL_COSTS_FREE_TEXT
// SMARTFLOW_V17_90L371L_INTAKE_POSITION_TYPE_PREFIX_FIX
// SMARTFLOW_V17_90L371M_INTAKE_TYPED_PREFIX_RESCUE_FIX
export type PositionType =
  | "service"
  | "material"
  | "equipment"
  | "disposal"
  | "expense"
  | "flat_fee"
  | "other";

export const DEFAULT_POSITION_TYPE: PositionType = "service";

export const POSITION_TYPE_OPTIONS: Array<{ value: PositionType; label: string }> = [
  { value: "service", label: "Dienstleistung" },
  { value: "material", label: "Material" },
  { value: "equipment", label: "Gerät / Maschine" },
  { value: "disposal", label: "Entsorgung" },
  { value: "expense", label: "Zusatzkosten" },
  { value: "flat_fee", label: "Pauschale" },
  { value: "other", label: "Sonstiges" },
];

export const POSITION_UNIT_SUGGESTIONS = [
  "Stunde",
  "Tag",
  "Pauschal",
  "Meter",
  "Quadratmeter",
  "Kubikmeter",
  "Stück",
  "Kilogramm",
  "Tonne",
  "Liter",
  "Sack",
  "Kartusche",
  "Eimer",
  "Rolle",
  "Gebinde",
  "Palette",
  "Laufmeter",
  "m²",
  "m³",
  "Einsatz",
  "Standzeit",
];

export function normalizePositionType(value: unknown): PositionType {
  const raw = String(value ?? "").trim().toLowerCase();
  const aliases: Record<string, PositionType> = {
    dienstleistung: "service",
    service: "service",
    leistung: "service",
    arbeit: "service",
    material: "material",
    geraet: "equipment",
    gerät: "equipment",
    maschine: "equipment",
    equipment: "equipment",
    geruest: "equipment",
    gerüst: "equipment",
    disposal: "disposal",
    entsorgung: "disposal",
    expense: "expense",
    zusatzkosten: "expense",
    "zusatz kosten": "expense",
    additional_costs: "expense",
    additional_cost: "expense",
    zusatz: "expense",
    kosten: "expense",
    anfahrt: "expense",
    fahrtkosten: "expense",
    spesen: "expense",
    fahrspesen: "expense",
    pauschale: "flat_fee",
    flat_fee: "flat_fee",
    flatfee: "flat_fee",
    pauschal: "flat_fee",
    other: "other",
    sonstiges: "other",
  };
  if (aliases[raw]) return aliases[raw];
  if (POSITION_TYPE_OPTIONS.some((option) => option.value === raw)) return raw as PositionType;
  return DEFAULT_POSITION_TYPE;
}

export function getPositionTypeLabel(value: unknown): string {
  const type = normalizePositionType(value);
  return POSITION_TYPE_OPTIONS.find((option) => option.value === type)?.label || "Dienstleistung";
}

const compact = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const normalizePositionText = (value: unknown) =>
  compact(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function inferPositionTypeFromText(value: unknown): PositionType | null {
  const key = normalizePositionText(value);
  if (!key) return null;

  if (/^(?:material|reinigungsmaterial|verbrauchsmaterial)\b/.test(key)) return "material";
  if (/^(?:geraet|gerat|maschine|equipment|spezialmaschine|einscheibenmaschine)\b/.test(key)) return "equipment";
  if (/^(?:zusatzkosten|zusatz kosten|spesen|fahrtkosten|fahrspesen|reisekosten|parkgebuehren|parkgebuhren)\b/.test(key)) return "expense";
  if (/^(?:anfahrt|deplacement|travel cost|travel costs)\b/.test(key)) return "expense";
  if (/^(?:entsorgung)\b/.test(key)) return "disposal";
  if (/^(?:pauschale)\b/.test(key)) return "flat_fee";

  return null;
}

export function inferPositionTypeFromItem(item: any): PositionType {
  const explicit = normalizePositionType(item?.positionType);
  if (explicit !== DEFAULT_POSITION_TYPE) return explicit;

  const inferred = inferPositionTypeFromText(
    [item?.serviceName, item?.description, item?.name].filter(Boolean).join(" "),
  );
  return inferred ?? explicit;
}



// V17.90L371M: The first L371L pass normalized already-created items only.
// Some intake paths drop explicit non-service lines before persistence, e.g.
// "Material Reinigungsmittel pauschal CHF 15" or keep them only as a red
// service review. This helper rescues those clearly priced typed lines before
// the order API calculates totals.
function parsePositionPrefixPriceNumber(value: unknown): number | null {
  const raw = compact(value);
  const match = raw.match(/(?:\bCHF\b|\bFr\.?\b|\bSFr\.?\b|€|\bEUR\b)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i) ||
    raw.match(/([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:\bCHF\b|\bFr\.?\b|\bSFr\.?\b|€|\bEUR\b)/i);
  if (!match) return null;
  const amount = Number(String(match[1] || "").replace(",", "."));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizePositionPrefixUnit(unit: unknown): string {
  const key = normalizePositionText(unit);
  if (/^(?:m2|qm|quadratmeter)$/.test(key)) return "m²";
  if (/^(?:m3|kubikmeter)$/.test(key)) return "m³";
  if (/^(?:stueck|stuck|stk)$/.test(key)) return "Stück";
  if (/^(?:tag|tage)$/.test(key)) return "Tag";
  if (/^(?:stunde|stunden|std|h)$/.test(key)) return "Stunde";
  if (/^(?:pauschal|pauschale|pausch)$/.test(key)) return "Pauschal";
  if (/^(?:kg|kilogramm)$/.test(key)) return "Kilogramm";
  if (/^(?:liter|l)$/.test(key)) return "Liter";
  if (/^(?:meter|m)$/.test(key)) return "Meter";
  if (/^(?:laufmeter|lfm)$/.test(key)) return "Laufmeter";
  if (/^(?:sack)$/.test(key)) return "Sack";
  if (/^(?:eimer)$/.test(key)) return "Eimer";
  if (/^(?:rolle)$/.test(key)) return "Rolle";
  if (/^(?:gebinde)$/.test(key)) return "Gebinde";
  if (/^(?:kartusche)$/.test(key)) return "Kartusche";
  if (/^(?:palette)$/.test(key)) return "Palette";
  return compact(unit) || "Pauschal";
}

function parseTypedPrefixPositionLine(line: string): any | null {
  const raw = compact(line)
    .replace(/^[•\-*]\s*/, "")
    .replace(/[.;,\s]+$/g, "")
    .trim();
  if (!raw) return null;

  const match = raw.match(/^(material|geraet|gerät|maschine|equipment|zusatzkosten|zusatz\s+kosten|spesen|entsorgung)\s+(.+)$/i);
  if (!match) return null;

  const prefix = normalizePositionText(match[1]);
  const rest = compact(match[2]);
  const unitPrice = parsePositionPrefixPriceNumber(rest);
  if (!unitPrice) return null;

  const amountMatch = rest.match(/(?:\bCHF\b|\bFr\.?\b|\bSFr\.?\b|€|\bEUR\b)\s*[0-9]+(?:[.,][0-9]{1,2})?/i) ||
    rest.match(/[0-9]+(?:[.,][0-9]{1,2})?\s*(?:\bCHF\b|\bFr\.?\b|\bSFr\.?\b|€|\bEUR\b)/i);
  const amountIndex = amountMatch && typeof amountMatch.index === "number" ? amountMatch.index : null;
  const beforePrice = compact((amountIndex !== null ? rest.slice(0, amountIndex) : rest)
    .replace(/(?:à|a|x|×)\s*$/i, "")
    .replace(/[.;,\s]+$/g, ""));

  let quantity = 1;
  let unit = "Pauschal";
  let serviceName = beforePrice;

  const quantityUnitMatch = beforePrice.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(m²|m2|m³|m3|qm|quadratmeter|kubikmeter|stück|stueck|stuck|stk|tag|tage|stunde|stunden|std|h|pauschal|pauschale|kg|kilogramm|liter|l|meter|laufmeter|lfm|sack|eimer|rolle|gebinde|kartusche|palette)\b\s*$/i);
  if (quantityUnitMatch && quantityUnitMatch.index !== undefined) {
    const parsedQuantity = Number(String(quantityUnitMatch[1] || "").replace(",", "."));
    if (Number.isFinite(parsedQuantity) && parsedQuantity > 0) quantity = parsedQuantity;
    unit = normalizePositionPrefixUnit(quantityUnitMatch[2]);
    serviceName = compact(beforePrice.slice(0, quantityUnitMatch.index));
  } else {
    const unitOnlyMatch = beforePrice.match(/\b(pauschal|pauschale|tag|tage|stunde|stunden|std|h|stück|stueck|stuck|stk|m²|m2|qm|quadratmeter|m³|m3|kubikmeter|kg|kilogramm|liter|l|meter|laufmeter|lfm|sack|eimer|rolle|gebinde|kartusche|palette)\b\s*$/i);
    if (unitOnlyMatch && unitOnlyMatch.index !== undefined) {
      unit = normalizePositionPrefixUnit(unitOnlyMatch[1]);
      serviceName = compact(beforePrice.slice(0, unitOnlyMatch.index));
    }
  }

  if (!serviceName) return null;

  const positionType: PositionType =
    prefix === "material"
      ? "material"
      : prefix === "geraet" || prefix === "gerat" || prefix === "maschine" || prefix === "equipment"
        ? "equipment"
        : prefix === "entsorgung"
          ? "disposal"
          : "expense";

  return {
    serviceName,
    description: raw,
    positionType,
    quantity,
    unit,
    unitPrice,
    totalPrice: quantity * unitPrice,
    _sourceLineV17_90L371M: raw,
  };
}

function typedPrefixPositionKey(value: unknown): string {
  return normalizePositionText(value).replace(/^(?:material|geraet|gerat|maschine|equipment|zusatzkosten|zusatz kosten|spesen|entsorgung)\s+/, "");
}

export function extractTypedPrefixPositionItemsFromText(source: unknown): any[] {
  const text = String(source ?? "");
  if (!text.trim()) return [];

  const seen = new Set<string>();
  const items: any[] = [];
  for (const line of text.split(/\r?\n/)) {
    const item = parseTypedPrefixPositionLine(line);
    if (!item) continue;
    const key = `${item.positionType}|${typedPrefixPositionKey(item.serviceName)}|${item.unit}|${item.quantity}|${item.unitPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

export function mergeTypedPrefixPositionItemsFromSource(data: any): any {
  if (!data || typeof data !== "object") return data;
  const source = [
    data?.notes,
    data?.description,
    data?.serviceName,
    data?.specialNotes,
    data?.audioTranscript,
  ].filter(Boolean).join("\n");
  const extracted = extractTypedPrefixPositionItemsFromText(source);
  if (extracted.length === 0) return data;

  const currentItems = Array.isArray(data?.items) ? data.items : [];
  const currentKeys = new Set(
    currentItems.map((item: any) => typedPrefixPositionKey(item?.serviceName ?? item?.description ?? item?.name)).filter(Boolean),
  );
  const missing = extracted.filter((item) => !currentKeys.has(typedPrefixPositionKey(item.serviceName)));
  const patchedCurrentItems = currentItems.map((item: any) => {
    const inferred = inferPositionTypeFromItem(item);
    return inferred !== normalizePositionType(item?.positionType)
      ? { ...item, positionType: inferred }
      : item;
  });
  if (missing.length === 0 && patchedCurrentItems === currentItems) return data;

  const rescuedReviewKeys = new Set(
    extracted.flatMap((item) => [item.serviceName, item.description, item._sourceLineV17_90L371M].map(typedPrefixPositionKey)).filter(Boolean),
  );
  const reviewReasons = Array.isArray(data?.reviewReasons)
    ? data.reviewReasons.filter((reason: any) => {
        const key = typedPrefixPositionKey(reason);
        if (!key) return true;
        for (const rescued of rescuedReviewKeys) {
          if (rescued && (key.includes(rescued) || rescued.includes(key))) return false;
        }
        return true;
      })
    : data?.reviewReasons;

  return {
    ...data,
    items: [...patchedCurrentItems, ...missing],
    ...(Array.isArray(data?.reviewReasons) ? { reviewReasons } : {}),
    ...(Array.isArray(reviewReasons) && reviewReasons.length === 0 && data?.needsReview === true
      ? { needsReview: false }
      : {}),
  };
}

const normalizeUnit = (value: unknown) =>
  compact(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

export function isUnresolvedPositionUnit(value: unknown): boolean {
  const key = normalizeUnit(value);
  return (
    !key ||
    key === "pruefen" ||
    key === "prufen" ||
    key === "einheit pruefen" ||
    key === "einheit prufen" ||
    key.includes("einheit fehlt") ||
    key.includes("einheit unklar") ||
    key.includes("unit missing") ||
    key.includes("unit unclear")
  );
}

export function getPositionBlockingIssues(item: any): string[] {
  const issues: string[] = [];
  if (!normalizePositionType(item?.positionType)) issues.push("Typ fehlt");
  const name = compact(item?.serviceName ?? item?.description ?? item?.name);
  if (!name || /^(leistung prüfen|leistung prufen|position prüfen|position prufen|unbekannte leistung|unklare leistung)$/i.test(name)) {
    issues.push("Bezeichnung fehlt");
  }
  const quantity = Number(item?.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) issues.push("Menge fehlt");
  if (isUnresolvedPositionUnit(item?.unit)) issues.push("Einheit fehlt");
  const unitPrice = Number(item?.unitPrice ?? 0);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) issues.push("Preis fehlt");
  return Array.from(new Set(issues));
}

export function hasPositionBlockingIssues(item: any): boolean {
  return getPositionBlockingIssues(item).length > 0;
}
