const fs = require('fs');

const path = 'app/(app)/rechnungen/page.tsx';

if (!fs.existsSync(path)) {
  console.error('FEHLER: Datei nicht gefunden: ' + path);
  process.exit(1);
}

let raw = fs.readFileSync(path, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let s = raw.replace(/\r\n/g, '\n');

function replaceExact(label, oldText, newText) {
  if (!s.includes(oldText)) {
    if (s.includes(newText)) {
      console.log(label + ': bereits angewendet');
      return;
    }
    console.error('FEHLER: Patchstelle nicht gefunden: ' + label);
    process.exit(1);
  }
  s = s.replace(oldText, newText);
  console.log(label + ': OK');
}

replaceExact(
  'Header L327',
  `"use client";
// SMARTFLOW_V17_90L326_INVOICE_APPOINTMENT_CHIP_FROM_INTAKE_NOTES`,
  `"use client";
// SMARTFLOW_V17_90L327_INVOICE_SPECIAL_NOTES_APPOINTMENT_MERGE_FIX
// SMARTFLOW_V17_90L326_INVOICE_APPOINTMENT_CHIP_FROM_INTAKE_NOTES`,
);

replaceExact(
  'Primäre Terminzeilen erkennen',
  `function isInvoiceCanonicalPrimaryLineV17_90L273(value: string): boolean {
  const key = normalizeInvoiceServiceName(value);
  if (!key) return false;
  return /\\b(?:termin|datum|uhr|zeitfenster|ankunft|vorher|kontakt|kontaktperson|ansprechperson|sms|whatsapp|telefon|telefonisch|anrufen|melden|zugang|zutritt|eingang|seitentuer|hintereingang|tiefgarage|badge|schluessel|schlussel|schluesselbox|schlusselbox|code|tor|tuerkode|turkode|tuercode|turcode)\\b/.test(
    key,
  );
}`,
  `function isInvoiceCanonicalPrimaryLineV17_90L273(value: string): boolean {
  const key = normalizeInvoiceServiceName(value);
  if (!key) return false;
  return (
    /\\b(?:termin|datum|uhr|zeitfenster|ankunft|vorher|kontakt|kontaktperson|ansprechperson|sms|whatsapp|telefon|telefonisch|anrufen|melden|zugang|zutritt|eingang|seitentuer|hintereingang|tiefgarage|badge|schluessel|schlussel|schluesselbox|schlusselbox|code|tor|tuerkode|turkode|tuercode|turcode)\\b/.test(
      key,
    ) ||
    /\\b\\d{1,2}[./-]\\d{1,2}(?:[./-]\\d{2,4})?\\b/.test(key) ||
    /\\b(?:[01]?\\d|2[0-3])[:.]([0-5]\\d)\\b/.test(key) ||
    /\\b(?:heute|morgen|uebermorgen|übermorgen|naechsten?|nächsten?|kommenden?|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\\b/.test(
      key,
    )
  );
}`,
);

replaceExact(
  'Multi-Site kein früher Return',
  `  if (siteContexts.length > 1) {
    return {
      hazards: [],
      primaryHints: siteContexts.map(
        (context) => \`${'${context.label}'}\\n${'${context.text}'}\`,
      ),
      otherHints: [],
    };
  }`,
  `  const siteContextHintsV17_90L327 =
    siteContexts.length > 1
      ? siteContexts.map((context) => \`${'${context.label}'}\\n${'${context.text}'}\`)
      : [];`,
);

replaceExact(
  'Site-Kontexte ergänzen',
  `  canonicalAppointmentLinesV17_90L276.forEach((line) =>
    add(primaryHints, line),
  );`,
  `  siteContextHintsV17_90L327.forEach((line) => add(primaryHints, line));
  canonicalAppointmentLinesV17_90L276.forEach((line) =>
    add(primaryHints, line),
  );`,
);

replaceExact(
  'Nur echte doppelte Termine filtern',
  `  for (const record of records) {
    const isAppointmentRecord = /\\b(?:termin|appointment|ausfuehrungstermin|ausführungstermin|zeitfenster)\\b/i.test(
      record.text,
    );
    if (isAppointmentRecord && canonicalAppointmentLinesV17_90L276.length > 0) {
      continue;
    }`,
  `  for (const record of records) {
    const isAppointmentRecord =
      /\\b(?:termin|appointment|ausfuehrungstermin|ausführungstermin|zeitfenster)\\b/i.test(
        record.text,
      ) || isInvoiceAppointmentHintForChipV17_90L326(record.text);
    const recordAppointmentSignatureV17_90L327 = isAppointmentRecord
      ? invoiceAppointmentSignatureV17_90L265(record.text)
      : "";
    const duplicateCanonicalAppointmentV17_90L327 =
      isAppointmentRecord &&
      canonicalAppointmentLinesV17_90L276.some((line) => {
        const canonicalSignature = invoiceAppointmentSignatureV17_90L265(line);
        if (
          recordAppointmentSignatureV17_90L327 &&
          canonicalSignature &&
          recordAppointmentSignatureV17_90L327 === canonicalSignature
        ) {
          return true;
        }
        const recordKey = normalizeInvoiceAppointmentKeyV17_90L177R(
          record.text.replace(/^Termin\\s*:?\\s*/i, ""),
        );
        const canonicalKey = normalizeInvoiceAppointmentKeyV17_90L177R(
          line.replace(/^Termin\\s*:?\\s*/i, ""),
        );
        return Boolean(recordKey && canonicalKey && recordKey === canonicalKey);
      });
    if (duplicateCanonicalAppointmentV17_90L327) {
      continue;
    }`,
);

fs.writeFileSync(path, s.replace(/\n/g, eol), 'utf8');

console.log('FERTIG: L327 Rechnungs-Termin/Info-Fix angewendet.');