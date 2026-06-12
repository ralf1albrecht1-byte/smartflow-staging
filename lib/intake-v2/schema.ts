export const INTAKE_V2_SCHEMA_VERSION = "V2" as const;
export const INTAKE_V2_PIPELINE_VERSION = "V17.90L197" as const;

export type CanonicalContactChannelV2 =
  | "whatsapp"
  | "sms"
  | "call"
  | "mail"
  | null;

export type CanonicalCustomerV2 = {
  name: string | null;
  street: string | null;
  plz: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  evidenceSource: string | null;
};

export type CanonicalExecutionAddressV2 = {
  siteName: string | null;
  siteAddress: string | null;
  sitePlz: string | null;
  siteCity: string | null;
  siteNote: string | null;
} | null;

export type CanonicalOnsiteContactV2 = {
  name: string | null;
  phone: string | null;
  channel: CanonicalContactChannelV2;
  noPhoneCall: boolean;
  hint: string | null;
} | null;

export type CanonicalFactRoleV2 =
  | "safety"
  | "access"
  | "parking"
  | "other"
  | "ordinary";

export type CanonicalFactV2 = {
  factId: string;
  role: CanonicalFactRoleV2;
  text: string;
  evidenceSource: "ai_structured" | "normalized_translation" | "canonical_assembler";
};

export type CanonicalOrderItemV2 = {
  serviceName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  currency: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  sourceText: string | null;
  sourceFingerprint: string | null;
};

export type CanonicalIntakePayloadV2 = {
  schemaVersion: typeof INTAKE_V2_SCHEMA_VERSION;
  pipelineVersion: typeof INTAKE_V2_PIPELINE_VERSION;
  customer: CanonicalCustomerV2;
  executionAddress: CanonicalExecutionAddressV2;
  onsiteContact: CanonicalOnsiteContactV2;
  appointments: string[];
  roles: {
    safety: string[];
    access: string[];
    parking: string[];
    other: string[];
    ordinary: string[];
  };
  /**
   * Optional atomic fact ledger. New intake snapshots populate this list and
   * derive every role array from it. Older V2 snapshots remain valid because
   * the field is optional and the role arrays stay the compatibility contract.
   */
  facts?: CanonicalFactV2[];
  items: CanonicalOrderItemV2[];
  specialNotes: string | null;
  reviewReasons: string[];
};

export type CanonicalIntakeSealV2 = {
  algorithm: "sha256";
  hash: string;
  displayHash: string;
};

export type CanonicalIntakeSnapshotV2 = CanonicalIntakePayloadV2 & {
  seal: CanonicalIntakeSealV2;
};

const compact = (value: unknown): string =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

export const canonicalLineKeyV2 = (value: unknown): string =>
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

export function canonicalLinesV2(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const result: string[] = [];
  const keys: string[] = [];

  for (const entry of raw.flatMap((item) =>
    String(item ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/\n+/g),
  )) {
    const line = compact(entry);
    const key = canonicalLineKeyV2(line);
    if (!line || !key) continue;
    if (
      keys.some(
        (existing) =>
          existing === key ||
          (existing.length >= 12 && existing.includes(key)) ||
          (key.length >= 12 && key.includes(existing)),
      )
    ) {
      continue;
    }
    result.push(line);
    keys.push(key);
  }

  return result;
}

export function normalizeCanonicalChannelV2(
  value: unknown,
): CanonicalContactChannelV2 {
  const key = canonicalLineKeyV2(value);
  if (!key) return null;
  if (/whats\s*app/.test(key)) return "whatsapp";
  if (/\bsms\b/.test(key)) return "sms";
  if (/e\s*mail|email|mail/.test(key)) return "mail";
  if (/anrufen|anruf|telefon|call|rueckruf|ruckruf/.test(key)) return "call";
  return null;
}

function stableValueV2(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValueV2);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValueV2(entry)]),
    );
  }
  return value;
}

export function stableCanonicalStringifyClientV2(value: unknown): string {
  return JSON.stringify(stableValueV2(value));
}

export function canonicalDisplayHashV2(value: unknown): string {
  const source = stableCanonicalStringifyClientV2(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function isCanonicalIntakeV2(
  value: unknown,
): value is CanonicalIntakeSnapshotV2 {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<CanonicalIntakeSnapshotV2>;
  return (
    snapshot.schemaVersion === INTAKE_V2_SCHEMA_VERSION &&
    snapshot.pipelineVersion === INTAKE_V2_PIPELINE_VERSION &&
    Boolean(snapshot.customer && typeof snapshot.customer === "object") &&
    Boolean(snapshot.roles && typeof snapshot.roles === "object") &&
    Array.isArray(snapshot.items) &&
    snapshot.seal?.algorithm === "sha256" &&
    typeof snapshot.seal?.hash === "string" &&
    snapshot.seal.hash.length === 64 &&
    typeof snapshot.seal?.displayHash === "string" &&
    snapshot.seal.displayHash ===
      canonicalDisplayHashV2((() => {
        const { seal: _seal, ...payload } = snapshot as CanonicalIntakeSnapshotV2;
        return payload;
      })())
  );
}

export function isIntakeV2Order(order: {
  intakeSchemaVersion?: unknown;
} | null | undefined): boolean {
  return order?.intakeSchemaVersion === INTAKE_V2_SCHEMA_VERSION;
}

export function getCanonicalIntakeV2(order: {
  intakeSchemaVersion?: unknown;
  intakeSnapshot?: unknown;
} | null | undefined): CanonicalIntakeSnapshotV2 | null {
  if (!order || order.intakeSchemaVersion !== INTAKE_V2_SCHEMA_VERSION) {
    return null;
  }
  return isCanonicalIntakeV2(order.intakeSnapshot)
    ? order.intakeSnapshot
    : null;
}
