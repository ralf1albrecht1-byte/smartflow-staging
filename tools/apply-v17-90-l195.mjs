import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.join(root, "app", "(app)", "auftraege", "page.tsx");
const marker = "V17.90L195_CANONICAL_ROLE_RENDER";

if (!fs.existsSync(target)) {
  console.error(`FEHLER: Datei nicht gefunden: ${target}`);
  process.exit(1);
}

let source = fs.readFileSync(target, "utf8");
if (source.includes(marker)) {
  console.log("L195-Seitenpatch ist bereits eingebaut.");
  process.exit(0);
}

const original = source;
const backup = `${target}.v17_90l195_backup`;
fs.writeFileSync(backup, original, "utf8");

const fail = (message) => {
  fs.writeFileSync(target, original, "utf8");
  console.error(`FEHLER: ${message}`);
  console.error(`Original wurde wiederhergestellt. Backup: ${backup}`);
  process.exit(1);
};

const replaceOnce = (pattern, replacement, label) => {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(`${label}: erwartet 1 Treffer, gefunden ${matches.length}.`);
  }
  source = source.replace(pattern, replacement);
};

const helperAnchor = "const extractOrderContactPhoneForCustomerDisplayV17_90K";
const helperIndex = source.indexOf(helperAnchor);
if (helperIndex < 0) fail("Telefon-Anzeigefunktion nicht gefunden.");

const canonicalHelper = `// ${marker}\nconst getCanonicalOrderSnapshotV17_90L195 = (order?: Order | null): any => {\n  const rawSnapshot = (order as any)?.intakeSnapshot;\n  let snapshot = rawSnapshot;\n  if (typeof rawSnapshot === \"string\") {\n    try {\n      snapshot = JSON.parse(rawSnapshot);\n    } catch {\n      return null;\n    }\n  }\n  if (!snapshot || typeof snapshot !== \"object\") return null;\n  const version = String(snapshot.version || (order as any)?.intakeSchemaVersion || \"\");\n  return /^V17\\.90L(?:194|195)$/.test(version) ? snapshot : null;\n};\n\nconst canonicalDisplayLinesV17_90L195 = (value: unknown): string[] => {\n  const input = Array.isArray(value) ? value : value ? [value] : [];\n  const seen = new Set<string>();\n  return input\n    .map((line) => compactText(String(line || \"\")))\n    .filter(Boolean)\n    .filter((line) => {\n      const key = normalizeForMatch(line);\n      if (!key || seen.has(key)) return false;\n      seen.add(key);\n      return true;\n    });\n};\n\n`;
source = source.slice(0, helperIndex) + canonicalHelper + source.slice(helperIndex);

replaceOnce(
  /const extractOrderContactPhoneForCustomerDisplayV17_90K = \(order\?: Order \| null\) => \{[\s\S]*?\n\};\n\n(?=const extractOrderContactEmailForCustomerDisplayV17_90K)/g,
  `const extractOrderContactPhoneForCustomerDisplayV17_90K = (order?: Order | null) => {\n  const canonical = getCanonicalOrderSnapshotV17_90L195(order);\n  if (canonical) {\n    // L195: Billing display comes only from the canonical customer role.\n    // Never fall back to on-site contact, specialNotes or the raw message.\n    return String(canonical?.customer?.phone || \"\")\n      .replace(/\\s+/g, \" \" )\n      .trim();\n  }\n\n  // Legacy records without a canonical snapshot keep the previous behavior.\n  const source = [order?.notes, order?.specialNotes, order?.audioTranscript]\n    .filter(Boolean)\n    .join(\"\\n\");\n  const match =\n    source.match(\n      /(?:tel\\.?|telefon|phone|mobile|handy|natel|whats\\s*app(?:\\s+nummer)?|sms|kontakt(?:\\s+vor\\s+ort)?|anrufen|rückruf|rueckruf)\\s*[:.]?\\s*(\\+?\\d[\\d\\s()./-]{6,}\\d)/i,\n    ) || source.match(/(\\+\\d[\\d\\s()./-]{7,}\\d)/);\n  return match?.[1]?.replace(/\\s+/g, \" \" ).trim() || \"\";\n};\n\n`,
  "Kundentelefon-Anzeige",
);

replaceOnce(
  /const buildCommunicationChipDataV17_52 = \(order: Order\): any => \{\n/g,
  `const buildCommunicationChipDataV17_52 = (order: Order): any => {\n  const canonicalIntakeV17_90L195 = getCanonicalOrderSnapshotV17_90L195(order);\n  const canonicalCommunicationLinesV17_90L195 = canonicalIntakeV17_90L195\n    ? canonicalDisplayLinesV17_90L195([\n        canonicalIntakeV17_90L195?.onsiteContact?.hint,\n        ...(Array.isArray(canonicalIntakeV17_90L195?.appointments)\n          ? canonicalIntakeV17_90L195.appointments.filter((line: unknown) =>\n              /\\b(?:whats\\s*app|sms|anrufen|anruf|telefon|e[-\\s]?mail|melden|mitteilen|ankündigen|ankuendigen)\\b/i.test(String(line || \"\")),\n            )\n          : []),\n      ])\n    : [];\n`,
  "Kommunikationschip-Einstieg",
);

replaceOnce(
  /  const compactCommunicationContext =\n    buildCompactCommunicationContextV17_90L123\(order\);/g,
  `  const compactCommunicationContext = canonicalIntakeV17_90L195\n    ? canonicalCommunicationLinesV17_90L195.join(\"\\n\")\n    : buildCompactCommunicationContextV17_90L123(order);`,
  "Kommunikationskontext",
);

replaceOnce(
  /  const rawCommunicationSource = \[\n    order\.specialNotes,\n    order\.notes,\n    order\.audioTranscript,\n  \]\n    \.filter\(Boolean\)\n    \.join\("\\n"\);/g,
  `  const rawCommunicationSource = canonicalIntakeV17_90L195\n    ? compactCommunicationContext\n    : [order.specialNotes, order.notes, order.audioTranscript]\n        .filter(Boolean)\n        .join(\"\\n\");`,
  "Kommunikations-Rohquelle",
);

replaceOnce(
  /  const resolvedEmail =\n    extractOrderContactEmailForCustomerDisplayV17_90K\(order\) \|\|\n    \(order as any\)\.email \|\|\n    order\.customer\?\.email \|\|\n    "";/g,
  `  const resolvedEmail = canonicalIntakeV17_90L195\n    ? String(canonicalIntakeV17_90L195?.customer?.email || \"\").trim()\n    : extractOrderContactEmailForCustomerDisplayV17_90K(order) ||\n      (order as any).email ||\n      order.customer?.email ||\n      \"\";`,
  "Kunden-E-Mail-Rolle",
);

replaceOnce(
  /    phone: \(order as any\)\.phone \|\| order\.customer\?\.phone \|\| "",\n    customerPhone: order\.customer\?\.phone \|\| "",\n    contactPhone:\n      extractOperationalPhoneForHrefV17_90L85\(\n        order\.specialNotes,\n        order\.notes,\n        order\.audioTranscript,\n      \) \|\| order\.customer\?\.phone \|\| "",/g,
  `    phone: canonicalIntakeV17_90L195\n      ? String(\n          canonicalIntakeV17_90L195?.onsiteContact?.phone ||\n            canonicalIntakeV17_90L195?.customer?.phone ||\n            \"\",\n        ).trim()\n      : (order as any).phone || order.customer?.phone || \"\",\n    customerPhone: canonicalIntakeV17_90L195\n      ? String(canonicalIntakeV17_90L195?.customer?.phone || \"\").trim()\n      : order.customer?.phone || \"\",\n    contactPhone: canonicalIntakeV17_90L195\n      ? String(canonicalIntakeV17_90L195?.onsiteContact?.phone || \"\").trim()\n      : extractOperationalPhoneForHrefV17_90L85(\n          order.specialNotes,\n          order.notes,\n          order.audioTranscript,\n        ) || order.customer?.phone || \"\",`,
  "Kommunikations-Telefonrollen",
);


// Canonical orders must never invoke the legacy customer auto-fill endpoint.
// That endpoint re-parses order notes and can write an on-site phone into the
// billing customer after the intake snapshot was already correct.
replaceOnce(
  /if \(o\.customerId\) autoFillCustomer\(o\.customerId\);/g,
  `    if (o.customerId && !getCanonicalOrderSnapshotV17_90L195(o)) {\n      autoFillCustomer(o.customerId);\n    }`,
  "Legacy-Kunden-Autofill sperren",
);

// The customer editor also used order notes as a field fallback. For canonical
// orders the saved customer object/snapshot is authoritative; notes may contain
// operational contact data and are therefore not a customer-master source.
const mergeNotePattern = /(freshCust as any,\n\s*)noteSource(,\n\s*\))/g;
const mergeNoteMatches = [...source.matchAll(mergeNotePattern)];
if (mergeNoteMatches.length < 1) {
  fail("Kundenformular-Notizfallback nicht gefunden.");
}
source = source.replace(
  mergeNotePattern,
  `$1getCanonicalOrderSnapshotV17_90L195(\n          editId ? orders.find((candidate: Order) => candidate.id === editId) || null : null,\n        )\n          ? null\n          : noteSource$2`,
);

const summarySignature = /\): OrderInfoSummaryV17_65 => \{\n  const isDogLine =/g;
replaceOnce(
  summarySignature,
  `): OrderInfoSummaryV17_65 => {\n  const canonicalIntakeV17_90L195 = getCanonicalOrderSnapshotV17_90L195(order as any);\n  if (canonicalIntakeV17_90L195) {\n    const safety = canonicalDisplayLinesV17_90L195(\n      canonicalIntakeV17_90L195?.roles?.safety,\n    );\n    const primary = canonicalDisplayLinesV17_90L195([\n      canonicalIntakeV17_90L195?.onsiteContact?.hint,\n      ...(Array.isArray(canonicalIntakeV17_90L195?.appointments)\n        ? canonicalIntakeV17_90L195.appointments\n        : []),\n      ...(Array.isArray(canonicalIntakeV17_90L195?.roles?.access)\n        ? canonicalIntakeV17_90L195.roles.access\n        : []),\n    ]).filter(\n      (line) =>\n        !safety.some((warning) =>\n          orderInfoLinesEquivalentV17_66(warning, line),\n        ),\n    );\n    const additional = canonicalDisplayLinesV17_90L195([\n      ...(Array.isArray(canonicalIntakeV17_90L195?.roles?.parking)\n        ? canonicalIntakeV17_90L195.roles.parking\n        : []),\n      ...(Array.isArray(canonicalIntakeV17_90L195?.roles?.other)\n        ? canonicalIntakeV17_90L195.roles.other\n        : []),\n      ...(Array.isArray(canonicalIntakeV17_90L195?.roles?.ordinary)\n        ? canonicalIntakeV17_90L195.roles.ordinary\n        : []),\n    ]).filter(\n      (line) =>\n        !safety.some((warning) =>\n          orderInfoLinesEquivalentV17_66(warning, line),\n        ) &&\n        !primary.some((hint) =>\n          orderInfoLinesEquivalentV17_90L66(hint, line),\n        ),\n    );\n    return { safety, primary, additional };\n  }\n\n  const isDogLine =`,
  "Canonical-Info-Zusammenfassung",
);

// Correct a possible helper-name typo in the injected block before writing.
source = source.replaceAll("orderInfoLinesEquivalentV17_90L66", "orderInfoLinesEquivalentV17_66");

if (!source.includes(marker)) fail("Patch-Marker fehlt nach Änderung.");
fs.writeFileSync(target, source, "utf8");
console.log("L195-Seitenpatch eingebaut:");
console.log(`- ${target}`);
console.log(`- Backup: ${backup}`);
