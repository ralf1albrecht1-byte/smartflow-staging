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
  { value: "expense", label: "Spesen" },
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
