/**
 * Customer-name normalization that is Unicode-safe for German/Swiss names.
 *
 * The old generic title-case path treated ä/ö/ü as word boundaries and could
 * turn valid names such as "Müller", "Bühler" and "Kümin" into
 * "MüLler", "BüHler" and "KüMin". This helper deliberately avoids ASCII
 * word-boundary logic and preserves intentional brand casing.
 */

const LEGAL_FORM_CASING: Readonly<Record<string, string>> = Object.freeze({
  ag: "AG",
  gmbh: "GmbH",
  mbh: "mbH",
  kg: "KG",
  kgaa: "KGaA",
  ohg: "OHG",
  gbr: "GbR",
  eg: "eG",
  sa: "SA",
  sarl: "Sàrl",
  sagl: "Sagl",
  ltd: "Ltd",
  llc: "LLC",
  inc: "Inc",
});

const lowerDe = (value: string) => value.toLocaleLowerCase("de-CH");
const upperDe = (value: string) => value.toLocaleUpperCase("de-CH");

function uppercaseFirstLetter(value: string): string {
  return value.replace(/^\p{L}/u, (letter) => upperDe(letter));
}

function repairWordPart(part: string): string {
  if (!part || !/\p{L}/u.test(part)) return part;

  const lower = lowerDe(part);
  const legalForm = LEGAL_FORM_CASING[lower];
  if (legalForm) return legalForm;

  // Preserve explicit acronyms and intentionally all-uppercase names.
  if (part === upperDe(part)) return part;

  // Repair the exact corruption produced by ASCII word-boundary title casing:
  // a capital letter directly after a lowercase German umlaut inside a word.
  let repaired = part.replace(/([äöü])([A-ZÄÖÜ])/gu, (_match, umlaut: string, next: string) =>
    `${umlaut}${lowerDe(next)}`,
  );

  // Lowercase input receives normal Unicode-aware title casing. Existing
  // mixed-case brand spellings (for example smartflowAI) remain untouched.
  if (repaired === lowerDe(repaired)) {
    repaired = uppercaseFirstLetter(repaired);
  }

  return repaired;
}

function normalizeToken(token: string): string {
  // Treat hyphenated/apostrophe names as separate word parts while preserving
  // the exact separator, e.g. müller-meier -> Müller-Meier.
  return token
    .split(/([\-‐‑‒–—'’])/u)
    .map((part) => (/^[\-‐‑‒–—'’]$/u.test(part) ? part : repairWordPart(part)))
    .join("");
}

export function normalizeCustomerDisplayName(value: unknown): string {
  const source = String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();

  if (!source) return "";

  return source
    .split(" ")
    .map(normalizeToken)
    .join(" ");
}
