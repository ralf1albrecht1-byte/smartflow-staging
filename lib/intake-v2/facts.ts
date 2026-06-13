import type {
  CanonicalFactKindV2,
  CanonicalFactRoleV2,
  CanonicalFactV2,
} from "@/lib/intake-v2/schema";

export type CanonicalFactCandidateV2 = {
  role: CanonicalFactRoleV2;
  text: string;
  evidenceSource?: CanonicalFactV2["evidenceSource"];
};

export type CanonicalFactAssemblerContextV2 = {
  originalText?: string | null;
  translationText?: string | null;
  onsiteContact?: {
    name?: string | null;
    phone?: string | null;
    channel?: string | null;
    noPhoneCall?: boolean | null;
  } | null;
  appointments?: string[];
};

const compact = (value: unknown): string =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

const normalize = (value: unknown): string =>
  compact(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    // Generic Swiss-German function forms. These do not identify a service;
    // they only make already-classified role statements comparable.
    .replace(/\bbim\b/g, "beim")
    .replace(/\buf\b/g, "auf")
    .replace(/\bhuuswart\b/g, "hauswart")
    .replace(/\bbriefchaste?n?\b/g, "briefkasten")
    .replace(/\bbriefchaschte?n?\b/g, "briefkasten")
    .replace(/\bhet\b/g, "hat")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hash32 = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const numbers = (value: unknown): string[] =>
  Array.from(new Set(normalize(value).match(/\b\d+(?:[.,]\d+)?\b/g) || []));

const hasNegation = (value: unknown): boolean =>
  /\b(?:nicht|kein|keine|keinen|keinem|keiner|ohne|not|no|never|pas|sans|non|sin|senza)\b/i.test(
    normalize(value),
  );

const roleRank: Record<CanonicalFactRoleV2, number> = {
  safety: 50,
  access: 40,
  parking: 30,
  other: 20,
  ordinary: 10,
};

const conceptPatterns: Array<[string, RegExp]> = [
  ["key", /\b(?:schluessel|schlussel|key|cle|chiave|llave)\b/i],
  ["code", /\b(?:code|codice|codigo)\b/i],
  ["caretaker", /\b(?:hauswart|caretaker|janitor|concierge)\b/i],
  ["office", /\b(?:buero|buro|bureau|office)\b/i],
  ["reception", /\b(?:rezeption|empfang|reception)\b/i],
  ["keybox", /\b(?:schluesselbox|schlusselbox|keybox|schluesselkasten|schlusselkasten)\b/i],
  ["mailbox", /\b(?:briefkasten|mailbox|boite\s+aux\s+lettres|cassetta\s+delle\s+lettere)\b/i],
  ["entrance", /\b(?:eingang|seiteneingang|entrance|entree|ingresso)\b/i],
  ["parking", /\b(?:parkieren|parken|parkplatz|besucherplatz|parking)\b/i],
  ["visitor", /\b(?:besucher|visitor|visiteur|ospiti)\b/i],
  ["ladder", /\b(?:leiter|ladder|echelle|scala)\b/i],
  ["dog", /\b(?:hund|dog|chien|cane|perro)\b/i],
  ["slippery", /\b(?:rutschig|glissant|slippery|scivolos)\w*\b/i],
  ["broken", /\b(?:defekt|kaputt|broken|defective|difettos)\w*\b/i],
  ["contact", /\b(?:kontakt|contact|contatto|ansprechpartner|vor ort)\b/i],
  ["whatsapp", /\bwhats\s*app\b/i],
  ["sms", /\bsms\b/i],
  ["call", /\b(?:anrufen|anruf|telefon|call)\b/i],
  ["appointment", /\b(?:termin|appointment)\b/i],
];

const concepts = (value: unknown): string[] => {
  const key = normalize(value);
  return conceptPatterns
    .filter(([, pattern]) => pattern.test(key))
    .map(([concept]) => concept);
};

const negativeLocationConcepts = (value: unknown): string[] => {
  const key = normalize(value);
  const negativeClause = key.split(
    /\b(?:sondern|but|instead|mais|pero|bensi|invece)\b/i,
  )[0] || key;
  if (!/\b(?:nicht|kein|keine|not|no|pas|sans|non|sin|senza)\b/i.test(negativeClause)) {
    return [];
  }
  const result: string[] = [];
  for (const concept of ["reception", "keybox", "mailbox", "caretaker", "office", "entrance"]) {
    const pattern = conceptPatterns.find(([name]) => name === concept)?.[1];
    if (pattern?.test(negativeClause)) result.push(concept);
  }
  return result;
};

function inferKind(
  role: CanonicalFactRoleV2,
  value: unknown,
): CanonicalFactKindV2 {
  const found = new Set(concepts(value));
  if (role === "safety") return "hazard";
  if (found.has("code") && !found.has("key")) return "access_code";
  if (found.has("key")) return "key_location";
  if (role === "parking" && numbers(value).length > 0) return "parking_space";
  if (found.has("parking")) return "parking_space";
  if (found.has("entrance")) return "entrance";
  if (found.has("ladder")) return "equipment";
  if (found.has("contact") || found.has("whatsapp") || found.has("sms") || found.has("call")) {
    return "communication";
  }
  if (found.has("appointment")) return "appointment";
  if (found.has("dog") || found.has("slippery") || found.has("broken")) {
    return "hazard";
  }
  if (role === "parking") return "parking_instruction";
  if (role === "access") return "access_instruction";
  if (role === "other") return "work_instruction";
  return "generic";
}

const STOP_TOKENS = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "einem",
  "einen", "ist", "sind", "wird", "werden", "befindet", "sich", "hat", "im", "in",
  "am", "an", "auf", "bei", "beim", "zur", "zum", "von", "vor", "und", "oder",
  "bitte", "hinweis", "achtung", "zugang", "parken", "parkierung", "de", "d", "nur",
  "vorhanden", "bekannt", "liegt", "steht", "reserviert", "muss", "werden",
]);

const meaningfulTokens = (value: unknown): string[] =>
  normalize(value)
    .split(/\s+/g)
    .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token));

const incompleteFact = (value: unknown): boolean => {
  const text = compact(value);
  const key = normalize(text);
  if (!key || key.length < 4) return true;
  if (/\b(?:auf|an|bei|beim|im|in|mit|ohne|vor|zu|zur|zum|per|via)$/i.test(key)) {
    return true;
  }
  return meaningfulTokens(key).length < 2 && numbers(key).length === 0;
};

const translationScore = (value: string, translationText?: string | null): number => {
  const line = normalize(value);
  const translation = normalize(translationText);
  if (!line || !translation) return 0;
  if (translation.includes(line)) return 300;
  const tokens = meaningfulTokens(line);
  if (!tokens.length) return 0;
  const match = tokens.filter((token) => translation.includes(token)).length;
  return match / tokens.length >= 0.75 ? 100 : 0;
};

const textScore = (fact: ParsedFact, translationText?: string | null): number =>
  translationScore(fact.text, translationText) +
  (fact.negated ? 40 : 0) +
  fact.codes.length * 30 +
  fact.concepts.length * 8 +
  meaningfulTokens(fact.text).length * 3 +
  Math.min(fact.text.length, 300) / 20;

type ParsedFact = {
  role: CanonicalFactRoleV2;
  kind: CanonicalFactKindV2;
  text: string;
  normalized: string;
  semanticKey: string;
  codes: string[];
  numericValues: string[];
  concepts: string[];
  negativeConcepts: string[];
  negated: boolean;
  evidenceSource: CanonicalFactV2["evidenceSource"];
  evidence: string[];
};

function buildSemanticKey(fact: Omit<ParsedFact, "semanticKey">): string {
  const anchors = fact.concepts
    .filter((concept) => !["contact", "whatsapp", "sms", "call", "appointment"].includes(concept))
    .sort();
  const codePart = fact.codes.length ? fact.codes.join("_") : "";
  const numberPart =
    fact.kind === "parking_space" || fact.kind === "access_code"
      ? fact.numericValues.join("_")
      : "";
  const polarity = fact.negated ? `neg_${fact.negativeConcepts.sort().join("_") || "yes"}` : "pos";
  return [fact.kind, anchors.join("_"), codePart || numberPart, polarity]
    .filter(Boolean)
    .join(":");
}

function parseCandidate(
  candidate: CanonicalFactCandidateV2,
  sourceLocked = false,
): ParsedFact | null {
  const rawText = compact(candidate.text);
  const text = sourceLocked
    ? rawText
    : rawText
        .replace(/^\s*\[(?:GEFAHR|WARNUNG|WARNHINWEIS|HINWEIS|INFO|NOTIZ)\]\s*/i, "")
        .replace(/^\s*(?:Zugang|Parken|Parkierung|Hinweis)\s*:\s*/i, "")
        .replace(/^\s*[-•*]\s*/, "")
        .trim();
  if (
    !text ||
    /\[object Object\]/i.test(text) ||
    (!sourceLocked && incompleteFact(text))
  ) {
    return null;
  }

  const normalized = normalize(text);
  const foundConcepts = concepts(text);
  // Source-locked AI facts keep the role and wording selected by the AI.
  // Content-based reclassification is only allowed in the legacy/shadow path.
  const normalizedRole: CanonicalFactRoleV2 = sourceLocked
    ? candidate.role
    : candidate.role === "parking" || foundConcepts.includes("parking")
      ? "parking"
      : candidate.role;
  const numericValues = numbers(text);
  const codeMatches = Array.from(
    text.matchAll(/\b(?:code|codice|codigo)\s*[:#-]?\s*(\d{2,12})\b/gi),
  ).map((match) => match[1]);
  const base: Omit<ParsedFact, "semanticKey"> = {
    role: normalizedRole,
    kind: inferKind(normalizedRole, text),
    text,
    normalized,
    codes: Array.from(new Set(codeMatches)),
    numericValues,
    concepts: foundConcepts,
    negativeConcepts: negativeLocationConcepts(text),
    negated: hasNegation(text),
    evidenceSource: candidate.evidenceSource || "canonical_assembler",
    evidence: [text],
  };
  return { ...base, semanticKey: buildSemanticKey(base) };
}

const sameSet = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

const intersects = (left: string[], right: string[]): boolean =>
  left.some((value) => right.includes(value));

function factsEquivalent(left: ParsedFact, right: ParsedFact): boolean {
  if (left.normalized === right.normalized) return true;

  // Same concrete code/parking number + same semantic kind is decisive.
  if (
    left.kind === right.kind &&
    ["access_code", "parking_space"].includes(left.kind) &&
    left.numericValues.length > 0 &&
    sameSet(left.numericValues, right.numericValues)
  ) {
    if (left.kind === "access_code") return true;
    const parkingNoise = new Set([
      "parkieren", "parken", "parkplatz", "parking", "platz", "nummer",
      "number", "reserved", "reserviert", ...left.numericValues,
    ]);
    const leftDistinctive = meaningfulTokens(left.text).filter(
      (token) => !parkingNoise.has(token),
    );
    const rightDistinctive = meaningfulTokens(right.text).filter(
      (token) => !parkingNoise.has(token),
    );
    return (
      leftDistinctive.length === 0 ||
      rightDistinctive.length === 0 ||
      leftDistinctive.some((token) => rightDistinctive.includes(token))
    );
  }

  if (left.kind !== right.kind) {
    // The same hazard sentence may have been proposed once as safety and once
    // as access because it mentions an entrance. Compare the business content
    // before honoring the lower-priority role; safety wins during merge.
    if (left.role === "safety" || right.role === "safety") {
      const leftTokens = meaningfulTokens(left.text);
      const rightTokens = meaningfulTokens(right.text);
      const shared = leftTokens.filter((token) => rightTokens.includes(token)).length;
      const containment = shared / Math.max(1, Math.min(leftTokens.length, rightTokens.length));
      const hazardConcept = ["dog", "slippery", "broken"].some(
        (concept) => left.concepts.includes(concept) || right.concepts.includes(concept),
      );
      if (hazardConcept && shared >= 2 && containment >= 0.75) return true;
    }
    return false;
  }

  const leftAnchors = left.concepts.filter((value) =>
    ["keybox", "mailbox", "reception", "caretaker", "office", "entrance", "ladder", "dog", "slippery", "broken"].includes(value),
  );
  const rightAnchors = right.concepts.filter((value) =>
    ["keybox", "mailbox", "reception", "caretaker", "office", "entrance", "ladder", "dog", "slippery", "broken"].includes(value),
  );

  if (left.codes.length && right.codes.length && !sameSet(left.codes, right.codes)) {
    return false;
  }
  if (
    ["access_code", "parking_space"].includes(left.kind) &&
    left.numericValues.length > 0 &&
    right.numericValues.length > 0 &&
    !sameSet(left.numericValues, right.numericValues)
  ) {
    return false;
  }

  if (left.kind === "key_location") {
    const sharedPositiveAnchor = intersects(leftAnchors, rightAnchors);
    if (!sharedPositiveAnchor) return false;
    // A short positive destination fragment ("Schlüssel in Schlüsselbox")
    // is safely absorbed by a fuller negated source/destination statement.
    if (left.negated !== right.negated) {
      const negated = left.negated ? left : right;
      const positive = left.negated ? right : left;
      return positive.concepts
        .filter((value) => ["keybox", "mailbox", "caretaker", "office", "entrance"].includes(value))
        .some((value) => negated.concepts.includes(value) && !negated.negativeConcepts.includes(value));
    }
    return true;
  }

  if (left.negated !== right.negated) return false;

  if (leftAnchors.length && rightAnchors.length && intersects(leftAnchors, rightAnchors)) {
    return true;
  }

  const leftTokens = meaningfulTokens(left.text);
  const rightTokens = meaningfulTokens(right.text);
  const intersection = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const containment = intersection / Math.max(1, Math.min(leftTokens.length, rightTokens.length));
  return intersection >= 2 && containment >= 0.72;
}

function chooseSourceLockedFact(
  left: ParsedFact,
  right: ParsedFact,
): ParsedFact {
  // Both alternatives originate in the same structured AI response. Keep an
  // original AI wording and only resolve duplicate role placement. Never use
  // raw text or a translated variant to replace the selected fact.
  const winner =
    roleRank[right.role] > roleRank[left.role] ? right : left;
  return {
    ...winner,
    evidence: Array.from(new Set([...left.evidence, ...right.evidence])),
  };
}

function choosePreferred(
  left: ParsedFact,
  right: ParsedFact,
  translationText?: string | null,
): ParsedFact {
  const preferredRole: CanonicalFactRoleV2 =
    left.kind === "hazard" || right.kind === "hazard"
      ? "safety"
      : ["parking_space", "parking_instruction"].includes(left.kind) ||
          ["parking_space", "parking_instruction"].includes(right.kind)
        ? "parking"
        : roleRank[right.role] > roleRank[left.role]
          ? right.role
          : left.role;
  const leftScore = textScore(left, translationText);
  const rightScore = textScore(right, translationText);
  const textWinner = rightScore > leftScore ? right : left;
  const merged: ParsedFact = {
    ...textWinner,
    role: preferredRole,
    codes: Array.from(new Set([...left.codes, ...right.codes])),
    numericValues: Array.from(new Set([...left.numericValues, ...right.numericValues])),
    concepts: Array.from(new Set([...left.concepts, ...right.concepts])),
    negativeConcepts: Array.from(new Set([...left.negativeConcepts, ...right.negativeConcepts])),
    negated: left.negated || right.negated,
    evidence: Array.from(new Set([...left.evidence, ...right.evidence])),
  };
  merged.semanticKey = buildSemanticKey(merged);
  return merged;
}

const PARKING_CONCEPT_PATTERN =
  /\b(?:parkplatz|parkplaetze|parkplätze|parken|parkieren|parking|aparcamiento|parcheggio|stationnement)\b/i;
const PARKING_NEGATION_PATTERN =
  /\b(?:kein(?:e|en|em|er)?|ohne|nicht|no|not|sans|sin|senza|pas\s+de)\b/i;

function extractExplicitNegativeParkingCandidates(
  context: CanonicalFactAssemblerContextV2,
): CanonicalFactCandidateV2[] {
  const sources = [
    { text: context.translationText, evidenceSource: "normalized_translation" as const },
    { text: context.originalText, evidenceSource: "canonical_assembler" as const },
  ];
  const output: CanonicalFactCandidateV2[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const text = String(source.text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    if (!text) continue;
    const clauses = text
      .split(/\n+|(?<=[.!?;])\s+|\s+[–—]\s+/g)
      .map((line) => compact(line))
      .filter(Boolean);
    for (const clause of clauses) {
      const parkingMatch = clause.match(PARKING_CONCEPT_PATTERN);
      if (!parkingMatch || parkingMatch.index == null) continue;

      // Chaotic one-line messages can contain the whole order in one clause.
      // Keep only the local parking statement so no unrelated customer/service
      // text can leak into a canonical parking fact.
      const matchIndex = parkingMatch.index;
      const before = clause.slice(0, matchIndex);
      const after = clause.slice(matchIndex);
      const localStartBoundary = Math.max(
        before.lastIndexOf(","),
        before.lastIndexOf(";"),
        before.lastIndexOf("."),
      );
      const roleBoundaryMatch = after.slice(parkingMatch[0].length).match(
        /\b(?:schlüssel|schluessel|schlussel|code|hund|dog|termin|appointment|kontakt|contact|leiter|ladder|zugang|access|achtung|warnung|gefahr)\b/i,
      );
      const roleBoundaryIndex = roleBoundaryMatch?.index != null
        ? parkingMatch[0].length + roleBoundaryMatch.index
        : -1;
      const localEndCandidates = [
        after.indexOf(".") >= 0 ? after.indexOf(".") + 1 : -1,
        after.indexOf(";") >= 0 ? after.indexOf(";") + 1 : -1,
        after.indexOf("!") >= 0 ? after.indexOf("!") + 1 : -1,
        roleBoundaryIndex,
      ].filter((index) => index >= 0);
      const localEndBoundary = localEndCandidates.length
        ? matchIndex + Math.min(...localEndCandidates)
        : Math.min(clause.length, matchIndex + 160);
      const focusedClause = compact(
        clause.slice(
          Math.max(0, localStartBoundary >= 0 ? localStartBoundary + 1 : matchIndex - 80),
          localEndBoundary,
        ),
      );
      const normalizedClause = normalize(focusedClause);
      if (
        !PARKING_CONCEPT_PATTERN.test(normalizedClause) ||
        !PARKING_NEGATION_PATTERN.test(normalizedClause)
      ) {
        continue;
      }
      const key = normalize(focusedClause);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push({
        role: "parking",
        text: focusedClause,
        evidenceSource: source.evidenceSource,
      });
    }
  }
  return output;
}

const isParkingFact = (fact: ParsedFact): boolean =>
  fact.role === "parking" ||
  fact.concepts.includes("parking") ||
  fact.kind === "parking_space" ||
  fact.kind === "parking_instruction";

function isPositiveParkingContradictedBySource(
  fact: ParsedFact,
  explicitNegativeParkingFacts: ParsedFact[],
): boolean {
  if (
    explicitNegativeParkingFacts.length === 0 ||
    !isParkingFact(fact) ||
    fact.negated ||
    fact.numericValues.length > 0
  ) {
    return false;
  }

  const factTokens = meaningfulTokens(fact.text);
  return explicitNegativeParkingFacts.some((negativeFact) => {
    const negativeTokens = meaningfulTokens(negativeFact.text);
    const shared = factTokens.filter((token) => negativeTokens.includes(token));
    const containment =
      shared.length / Math.max(1, Math.min(factTokens.length, negativeTokens.length));
    return (
      negativeFact.normalized.includes(fact.normalized) ||
      fact.normalized.includes(negativeFact.normalized) ||
      shared.length >= 2 ||
      containment >= 0.6
    );
  });
}

function isCoveredByStructuredContext(
  fact: ParsedFact,
  context: CanonicalFactAssemblerContextV2,
): boolean {
  if (fact.kind === "appointment") return true;
  if (fact.kind !== "communication") return false;

  const combined = normalize([
    context.onsiteContact?.name,
    context.onsiteContact?.phone,
    context.onsiteContact?.channel,
    ...(context.appointments || []),
  ].filter(Boolean).join(" "));
  if (!combined) return false;

  const factNumbers = fact.numericValues;
  const sameNumber = factNumbers.length === 0 || factNumbers.some((number) => combined.includes(number));
  const sameChannel = fact.concepts
    .filter((value) => ["whatsapp", "sms", "call"].includes(value))
    .every((value) => {
      if (
        value === "call" &&
        fact.negated &&
        context.onsiteContact?.noPhoneCall === true
      ) {
        return true;
      }
      return combined.includes(value);
    });
  return sameNumber && sameChannel;
}

export function assembleCanonicalFactsV2(args: {
  candidates: CanonicalFactCandidateV2[];
  context?: CanonicalFactAssemblerContextV2;
  /**
   * Hard source boundary for canonical persistence. In this mode only the
   * supplied structured AI candidates may become facts. Raw message text and
   * translations remain diagnostic-only and cannot add, rename or re-role a
   * persisted fact.
   */
  sourceLock?: "ai_structured";
}): {
  facts: CanonicalFactV2[];
  roles: Record<CanonicalFactRoleV2, string[]>;
} {
  const context = args.context || {};
  const sourceLocked = args.sourceLock === "ai_structured";

  // Raw/translated rescue candidates are useful for diagnostics, but they are
  // forbidden once the structured AI result is selected as source of truth.
  const negativeParkingCandidates = sourceLocked
    ? []
    : extractExplicitNegativeParkingCandidates(context);
  const explicitNegativeParkingFacts = negativeParkingCandidates
    .map((candidate) => parseCandidate(candidate, false))
    .filter((fact): fact is ParsedFact => Boolean(fact));
  const parsed = [...args.candidates, ...negativeParkingCandidates]
    .map((candidate) => parseCandidate(candidate, sourceLocked))
    .filter((fact): fact is ParsedFact => Boolean(fact))
    // Contact/appointment duplicates may be suppressed only against the
    // already-structured context. This does not import anything from raw text.
    .filter((fact) => !isCoveredByStructuredContext(fact, context))
    // V17.90L207 applies only to the legacy/shadow path because it derives
    // additional facts from source text. Source-locked persistence never does.
    .filter(
      (fact) =>
        sourceLocked ||
        !isPositiveParkingContradictedBySource(
          fact,
          explicitNegativeParkingFacts,
        ),
    );

  const assembled: ParsedFact[] = [];
  for (const candidate of parsed) {
    const duplicateIndex = assembled.findIndex((existing) =>
      factsEquivalent(existing, candidate),
    );
    if (duplicateIndex < 0) assembled.push(candidate);
    else {
      assembled[duplicateIndex] = sourceLocked
        ? chooseSourceLockedFact(assembled[duplicateIndex], candidate)
        : choosePreferred(
            assembled[duplicateIndex],
            candidate,
            context.translationText,
          );
    }
  }

  // Legacy/shadow mode may compact a separate code fragment into a complete
  // key-location statement. Source-locked mode keeps the AI-selected facts and
  // performs no post-AI deletion beyond equivalent-fact deduplication above.
  const completeKeyCodes = new Set(
    assembled
      .filter((fact) => fact.kind === "key_location")
      .flatMap((fact) => fact.codes),
  );
  const compacted = sourceLocked
    ? assembled
    : assembled.filter(
        (fact) =>
          !(
            fact.kind === "access_code" &&
            fact.codes.length > 0 &&
            fact.codes.every((code) => completeKeyCodes.has(code))
          ),
      );

  const facts: CanonicalFactV2[] = compacted.map((fact) => ({
    factId: `fact_${hash32(fact.semanticKey)}`,
    semanticKey: fact.semanticKey,
    role: fact.role,
    kind: fact.kind,
    text: fact.text,
    code: fact.codes[0] || null,
    number: fact.kind === "parking_space" ? fact.numericValues[0] || null : null,
    negated: fact.negated,
    evidence: fact.evidence,
    evidenceSource: fact.evidenceSource,
  }));

  const roles: Record<CanonicalFactRoleV2, string[]> = {
    safety: [],
    access: [],
    parking: [],
    other: [],
    ordinary: [],
  };
  for (const fact of facts) roles[fact.role].push(fact.text);
  return { facts, roles };
}
