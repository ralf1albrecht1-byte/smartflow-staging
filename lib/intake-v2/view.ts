import {
  canonicalLinesV2,
  getCanonicalIntakeV2,
  isIntakeV2Order,
  normalizeCanonicalChannelV2,
  type CanonicalIntakeSnapshotV2,
} from "@/lib/intake-v2/schema";

const compact = (value: unknown): string =>
  String(value ?? "").replace(/\s+/g, " ").trim();

export type CanonicalOrderInfoV2 = {
  safety: string[];
  primary: string[];
  additional: string[];
};

function canonicalRoleLinesFromFactsV2(
  snapshot: CanonicalIntakeSnapshotV2,
  role: "safety" | "access" | "parking" | "other" | "ordinary",
): string[] {
  if (Array.isArray(snapshot.facts)) {
    return canonicalLinesV2(
      snapshot.facts
        .filter((fact) => fact?.role === role && compact(fact?.text))
        .map((fact) => fact.text),
    );
  }
  return canonicalLinesV2(snapshot.roles[role]);
}

export function canonicalContactLineV2(
  snapshot: CanonicalIntakeSnapshotV2,
): string {
  const contact = snapshot.onsiteContact;
  if (!contact) return "";
  const channel = normalizeCanonicalChannelV2(contact.channel || contact.hint);
  const channelLabel =
    channel === "whatsapp"
      ? "nur WhatsApp"
      : channel === "sms"
        ? "nur SMS"
        : channel === "mail"
          ? "nur E-Mail"
          : channel === "call"
            ? "anrufen"
            : "";
  const values = [compact(contact.name), compact(contact.phone), channelLabel].filter(Boolean);
  return values.length ? `Kontakt: ${values.join(" · ")}` : "";
}

export function canonicalAppointmentLinesV2(
  snapshot: CanonicalIntakeSnapshotV2,
): string[] {
  return canonicalLinesV2(snapshot.appointments).map((line) =>
    /^termin\s*:/i.test(line) ? line : `Termin: ${line}`,
  );
}

export function canonicalOrderInfoV2(
  snapshot: CanonicalIntakeSnapshotV2,
): CanonicalOrderInfoV2 {
  // New snapshots expose one atomic fact ledger. Read that ledger directly so
  // the UI never reclassifies or reconstructs information after the seal.
  const safety = canonicalRoleLinesFromFactsV2(snapshot, "safety");
  const access = canonicalRoleLinesFromFactsV2(snapshot, "access");
  const contact = canonicalContactLineV2(snapshot);
  const appointments = canonicalAppointmentLinesV2(snapshot);
  const primary = canonicalLinesV2([
    contact,
    ...appointments,
    access.length ? `Zugang: ${access.join(" · ")}` : "",
  ]);
  const additional = canonicalLinesV2([
    ...canonicalRoleLinesFromFactsV2(snapshot, "parking").map((line) =>
      /^park/i.test(line) ? line : `Parken: ${line}`,
    ),
    ...canonicalRoleLinesFromFactsV2(snapshot, "other"),
    ...canonicalRoleLinesFromFactsV2(snapshot, "ordinary"),
  ]);
  return { safety, primary, additional };
}

export function canonicalCommunicationDataV2(
  snapshot: CanonicalIntakeSnapshotV2,
) {
  const contact = snapshot.onsiteContact;
  const appointmentInstruction = canonicalLinesV2(snapshot.appointments).join(" ");
  const channel =
    normalizeCanonicalChannelV2(contact?.channel || contact?.hint) ||
    normalizeCanonicalChannelV2(appointmentInstruction);
  const targetPhone = compact(contact?.phone || snapshot.customer.phone);
  const targetEmail = compact(snapshot.customer.email);
  const name = compact(contact?.name);
  const instruction =
    channel === "whatsapp"
      ? "nur WhatsApp"
      : channel === "sms"
        ? "nur SMS"
        : channel === "mail"
          ? "nur E-Mail"
          : channel === "call"
            ? "bitte anrufen"
            : "";

  let communicationContext = "";
  if (contact && (name || targetPhone || targetEmail || instruction)) {
    communicationContext = [
      "Kontakt vor Ort:",
      name,
      channel === "mail" ? targetEmail : targetPhone,
      instruction,
    ]
      .filter(Boolean)
      .join(" · ")
      .replace("Kontakt vor Ort: · ", "Kontakt vor Ort: ");
  } else if (channel) {
    // A channel inferred only from an appointment instruction is a contact
    // preference, not an onsite-contact identity. Keep the stored customer
    // phone/email as the action target, but never render it as "Kontakt vor Ort".
    communicationContext = ["Kontaktwunsch:", instruction]
      .filter(Boolean)
      .join(" · ")
      .replace(/^Kontaktwunsch: · /, "Kontaktwunsch: ");
  }

  return {
    channel,
    targetPhone,
    targetEmail,
    communicationContext,
  };
}

export function canonicalAppointmentBadgeV2(
  snapshot: CanonicalIntakeSnapshotV2,
): { label: string; tooltip: string } | null {
  const lines = canonicalAppointmentLinesV2(snapshot);
  if (!lines.length) return null;
  const source = lines[0].replace(/^Termin\s*:\s*/i, "");
  const date = source.match(/\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\b/);
  const sourceWithoutDate = date
    ? source.replace(date[0], " ")
    : source;
  const times = Array.from(
    sourceWithoutDate.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g),
  ).map((match) => `${match[1].padStart(2, "0")}:${match[2]}`);
  const labelParts: string[] = [];
  if (date) {
    labelParts.push(
      `${date[1].padStart(2, "0")}.${date[2].padStart(2, "0")}.`,
    );
  }
  if (times.length >= 2) labelParts.push(`${times[0]}–${times[1]}`);
  else if (times[0]) labelParts.push(times[0]);
  return {
    label: labelParts.join(" · ") || "Termin",
    tooltip: lines.join("\n"),
  };
}

export { getCanonicalIntakeV2, isIntakeV2Order };
