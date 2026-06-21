// SMARTFLOW_V17_90L371J_POSITION_TYPE_ADDITIONAL_COSTS_FREE_TEXT
// SMARTFLOW_V17_90L371L_INTAKE_POSITION_TYPE_PREFIX_FIX
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
