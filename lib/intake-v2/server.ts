import { createHash } from "node:crypto";
import {
  INTAKE_V2_PIPELINE_VERSION,
  INTAKE_V2_SCHEMA_VERSION,
  type CanonicalIntakePayloadV2,
  type CanonicalIntakeSnapshotV2,
  canonicalDisplayHashV2,
  isCanonicalIntakeV2,
} from "@/lib/intake-v2/schema";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function stableCanonicalStringifyV2(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function canonicalPayloadHashV2(value: CanonicalIntakePayloadV2): string {
  return createHash("sha256")
    .update(stableCanonicalStringifyV2(value), "utf8")
    .digest("hex");
}

function deepFreezeCanonicalValueV2<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object") return value;

  const objectValue = value as unknown as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeCanonicalValueV2(child, seen);
  }

  return Object.freeze(value);
}

export function sealCanonicalIntakeV2(
  input: Omit<CanonicalIntakePayloadV2, "schemaVersion" | "pipelineVersion">,
): CanonicalIntakeSnapshotV2 {
  const payload: CanonicalIntakePayloadV2 = {
    schemaVersion: INTAKE_V2_SCHEMA_VERSION,
    pipelineVersion: INTAKE_V2_PIPELINE_VERSION,
    ...input,
  };
  const snapshot: CanonicalIntakeSnapshotV2 = {
    ...payload,
    seal: {
      algorithm: "sha256",
      hash: canonicalPayloadHashV2(payload),
      displayHash: canonicalDisplayHashV2(payload),
    },
  };

  // V17.90L198: After sealing, no downstream validator/repair may mutate even
  // a nested customer, role or item value in memory. Explicit user saves use
  // the normal API path; automatic post-processing remains read-only.
  return deepFreezeCanonicalValueV2(snapshot);
}

export function verifyCanonicalIntakeV2(value: unknown): {
  valid: boolean;
  reason: string | null;
} {
  if (!isCanonicalIntakeV2(value)) {
    return { valid: false, reason: "canonical_intake_v2_shape_invalid" };
  }
  const { seal, ...payload } = value;
  const actual = canonicalPayloadHashV2(payload);
  if (actual !== seal.hash) {
    return { valid: false, reason: "canonical_intake_v2_hash_mismatch" };
  }
  return { valid: true, reason: null };
}
export function hasCanonicalIntakeProtectionV2(order: {
  intakeSchemaVersion?: unknown;
} | null | undefined): boolean {
  return order?.intakeSchemaVersion === INTAKE_V2_SCHEMA_VERSION;
}

export function verifyCanonicalIntakeOrderV2(order: {
  intakeSchemaVersion?: unknown;
  intakeSnapshot?: unknown;
} | null | undefined): { valid: boolean; reason: string | null } {
  if (!hasCanonicalIntakeProtectionV2(order)) {
    return { valid: false, reason: "canonical_intake_v2_not_enabled" };
  }
  return verifyCanonicalIntakeV2(order?.intakeSnapshot);
}
