export type HourLineRepairCandidate = {
  raw: string;
  quantity: number;
  price: number;
  topic: string | null;
  key: string;
};

type FlatFeeRepairCandidate = {
  raw: string;
  price: number;
  topic: "anfahrt";
  key: string;
};

type MissingPriceRepairCandidate = {
  raw: string;
  serviceName: string;
  quantity: number;
  unit: string;
  topic: string | null;
  key: string;
};

export type HourLineRepairItem = {
  id?: string | null;
  serviceName?: string | null;
  description?: string | null;
  quantity?: any;
  unit?: string | null;
  unitPrice?: any;
  totalPrice?: any;
  [key: string]: any;
};

export type HourLineRepairResult<T extends HourLineRepairItem> = {
  items: T[];
  repairedCount: number;
  remainingZeroHourRows: number;
  candidates: HourLineRepairCandidate[];
};

function normalizeHourRepairText(value: any): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9€£$.,:;/'’`+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHourRepairDecimal(value?: string | null): number | null {
  const parsed = Number(String(value || "").replace("'", "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const HOUR_REPAIR_WORD_VALUES: Record<string, number> = {
  // German
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  eins: 1,
  viertel: 0.25,
  halb: 0.5,
  halbe: 0.5,
  dreiviertel: 0.75,
  anderthalb: 1.5,
  eineinhalb: 1.5,
  zwei: 2,
  zweieinhalb: 2.5,
  drei: 3,
  dreieinhalb: 3.5,
  vier: 4,
  viereinhalb: 4.5,
  fuenf: 5,
  funf: 5,
  fuenfeinhalb: 5.5,
  funfeinhalb: 5.5,
  sechs: 6,
  sechseinhalb: 6.5,
  sieben: 7,
  siebeneinhalb: 7.5,
  acht: 8,
  achteinhalb: 8.5,
  neun: 9,
  neuneinhalb: 9.5,
  zehn: 10,
  // English / French / Italian / Spanish / Portuguese basics
  one: 1,
  un: 1,
  une: 1,
  una: 1,
  uno: 1,
  deux: 2,
  due: 2,
  dos: 2,
  duas: 2,
  dois: 2,
  three: 3,
  trois: 3,
  tre: 3,
  tres: 3,
  four: 4,
  quatre: 4,
  quattro: 4,
  cuatro: 4,
  five: 5,
  cinq: 5,
  cinque: 5,
  cinco: 5,
  six: 6,
  sei: 6,
  seis: 6,
  seven: 7,
  sept: 7,
  sette: 7,
  siete: 7,
  sete: 7,
  eight: 8,
  huit: 8,
  otto: 8,
  ocho: 8,
  oito: 8,
  nine: 9,
  neuf: 9,
  nove: 9,
  nueve: 9,
  ten: 10,
  dix: 10,
  dieci: 10,
  diez: 10,
  dez: 10,
  half: 0.5,
  demi: 0.5,
  demie: 0.5,
  mezzo: 0.5,
  mezza: 0.5,
  media: 0.5,
  medio: 0.5,
  quarter: 0.25,
  quart: 0.25,
  quarto: 0.25,
  cuarto: 0.25,
  troisquarts: 0.75,
  threequarters: 0.75,
  trescuartos: 0.75,
  trequarti: 0.75,
};

function parseHourRepairQuantityToken(value?: string | null): number | null {
  const numeric = parseHourRepairDecimal(value);
  if (numeric) return numeric;

  const normalized = normalizeHourRepairText(value || "");
  if (/^(?:drei\s+viertel|three\s+quarters?|trois\s+quarts?|tres\s+cuartos?|tre\s+quarti)$/.test(normalized)) {
    return 0.75;
  }

  const key = normalized.replace(/\s+/g, "");
  return HOUR_REPAIR_WORD_VALUES[key] || null;
}

function roundHourRepairMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function normalizeHourRepairQuantity(value: number | null | undefined): number | null {
  const quantity = Number(value || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return roundHourRepairMoney(Math.round(quantity * 4) / 4);
}

function isHourRepairHourUnit(value?: string | null): boolean {
  const unit = normalizeHourRepairText(value || "").replace(/[^a-z0-9]/g, "");
  return ["stunde", "stunden", "std", "h", "hour", "hours", "heure", "heures", "hora", "horas", "ora", "ore", "stundensatz"].includes(unit);
}

function hasBrokenHourRepairMath(item: HourLineRepairItem): boolean {
  const unitPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return false;

  const quantity = Number(item.quantity ?? 0);
  const totalPrice = Number(item.totalPrice ?? 0);

  // Observed in Railway V17.04/V17.05:
  // candidates were detected correctly (5.5h@74:boden_reinigen), but
  // zeroHourRows stayed 0 while the UI showed Total CHF 0 / Menge prüfen.
  // Therefore the repairable condition must be based on broken math, not only
  // on a strict stored hour unit/quantity shape.
  return (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(totalPrice) ||
    totalPrice <= 0
  );
}

function isBrokenHourRepairRow(item: HourLineRepairItem): boolean {
  return isHourRepairHourUnit(item.unit) && hasBrokenHourRepairMath(item);
}

function hourRepairItemDebugSummary(item: HourLineRepairItem): string {
  return [
    String(item.serviceName || "?"),
    `unit=${String(item.unit || "?")}`,
    `q=${String(item.quantity ?? "?")}`,
    `p=${String(item.unitPrice ?? "?")}`,
    `t=${String(item.totalPrice ?? "?")}`,
    `topic=${hourRepairServiceTopic([item.serviceName, item.description].filter(Boolean).join(" ")) || "none"}`,
    `broken=${hasBrokenHourRepairMath(item) ? "yes" : "no"}`,
  ].join("/");
}

function isRepairableHourRepairRow(
  item: HourLineRepairItem,
  candidates: HourLineRepairCandidate[],
): boolean {
  const unitPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return false;

  const chosen = chooseHourLineRepairCandidate(item, candidates);
  if (!chosen) return false;

  const itemText = [item.serviceName, item.description].filter(Boolean).join(" ");
  const itemTopic = hourRepairServiceTopic(itemText);
  const hasHourSignal =
    isHourRepairHourUnit(item.unit) ||
    /\b(?:stunde|stunden|std\.?|h|hour|hours|heure|heures|hora|horas|ora|ore)\b/i.test(String(item.description || ""));

  // Safe broadened condition:
  // - same price is already enforced by chooseHourLineRepairCandidate
  // - same semantic topic prevents leaking the hour line into Stück/m² rows
  // - an explicit hour signal is allowed as additional safety.
  const sameSafeContext = Boolean((itemTopic && chosen.topic === itemTopic) || hasHourSignal);
  if (!sameSafeContext) return false;

  const quantity = Number(item.quantity ?? 0);
  const totalPrice = Number(item.totalPrice ?? 0);
  const expectedTotal = roundHourRepairMoney(Number(chosen.quantity || 0) * unitPrice);

  return (
    hasBrokenHourRepairMath(item) ||
    !Number.isFinite(quantity) ||
    Math.abs(quantity - Number(chosen.quantity || 0)) >= 0.001 ||
    !Number.isFinite(totalPrice) ||
    Math.abs(roundHourRepairMoney(totalPrice) - expectedTotal) >= 0.01
  );
}

function detectHourRepairQuantityInLine(line?: string | null): number | null {
  const source = normalizeHourRepairText(line || "");
  if (!source) return null;

  const numberOrWord =
    "(?:\\d+(?:[.,]\\d+)?|ein|eine|einen|einem|einer|eins|viertel|halbe|halb|dreiviertel|anderthalb|eineinhalb|zweieinhalb|dreieinhalb|viereinhalb|fuenfeinhalb|funfeinhalb|sechseinhalb|siebeneinhalb|achteinhalb|neuneinhalb|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun|zehn|one|two|three|four|five|six|seven|eight|nine|ten|un|une|deux|trois|quatre|cinq|sept|huit|neuf|dix|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|dois|duas|sete|oito|dez)";
  const hourUnit = "(?:stunden?|std\\.?|h|hours?|heures?|d['’]?heures?|d['’]?heure|heure|ore|ora|horas?|horas?)";
  const minuteUnit = "(?:min\\.?|minuten?|minutes?|minuti?|minutos?)";

  // Explicit fraction phrases across DE/EN/FR/IT/ES/PT:
  // drei Viertelstunde, three quarters of an hour, trois quarts d'heure,
  // tres cuartos de hora, tre quarti d'ora.
  const threeQuarterPhrase = source.match(
    /\b(?:dreiviertel|drei\s+viertel|three\s+quarters?|trois\s+quarts?|tres\s+cuartos?|tre\s+quarti)\s*(?:d['’]?|de\s+|of\s+(?:an?\s+)?)?(?:stunde|stunden|std\.?|h|hour|hours|heure|heures|hora|horas|ora|ore)?\b/i,
  );
  if (threeQuarterPhrase) {
    const normalized = normalizeHourRepairQuantity(0.75);
    if (normalized) return normalized;
  }

  const halfPhrase = source.match(
    /\b(?:eine?n?\s+halbe|halbe|half(?:\s+an?)?|demi(?:e)?|media|medio|mezza|mezzo)\s*(?:stunde|stunden|std\.?|h|hour|hours|heure|heures|hora|horas|ora|ore)\b/i,
  );
  if (halfPhrase) {
    const normalized = normalizeHourRepairQuantity(0.5);
    if (normalized) return normalized;
  }

  const quarterPhrase = source.match(
    /\b(?:eine?n?\s+viertel|viertel|quarter|quart|cuarto|quarto)\s*(?:stunde|stunden|std\.?|h|hour|hours|heure|heures|hora|horas|ora|ore)?\b/i,
  );
  if (quarterPhrase) {
    const normalized = normalizeHourRepairQuantity(0.25);
    if (normalized) return normalized;
  }

  const hourMatch = source.match(new RegExp(`\\b(${numberOrWord})\\s*${hourUnit}\\b`, "i"));
  if (hourMatch?.[1]) {
    const base = parseHourRepairQuantityToken(hourMatch[1]);
    if (base) {
      let total = base;
      const after = source.slice((hourMatch.index || 0) + hourMatch[0].length);
      // Important: allow the dot from "Std." before "15 Minuten".
      const minuteAfter = after.match(new RegExp(`^[\\s.,;:–—-]*(?:und|\\+)?\\s*(15|30|45)\\s*${minuteUnit}\\b`, "i"));
      if (minuteAfter?.[1]) total += Number(minuteAfter[1]) / 60;
      const normalized = normalizeHourRepairQuantity(total);
      if (normalized) return normalized;
    }
  }

  const hourPlusWordFraction = source.match(
    new RegExp(
      `\\b(${numberOrWord})\\s*${hourUnit}\\s*(?:und|\\+)?\\s*(?:eine?n?\\s+)?(viertel|halb|halbe|dreiviertel|quarter|half|three\\s+quarters?|quart|demi(?:e)?|trois\\s+quarts?|cuarto|media|medio|tres\\s+cuartos?|quarto|mezza|mezzo|tre\\s+quarti)\\s*(?:stunde|stunden|std\\.?|h|hour|hours|heure|heures|hora|horas|ora|ore)?\\b`,
      "i",
    ),
  );
  if (hourPlusWordFraction?.[1] && hourPlusWordFraction?.[2]) {
    const base = parseHourRepairQuantityToken(hourPlusWordFraction[1]);
    const fraction = parseHourRepairQuantityToken(hourPlusWordFraction[2]);
    const normalized = normalizeHourRepairQuantity((base || 0) + (fraction || 0));
    if (normalized) return normalized;
  }

  const compactHourMinute = source.match(
    new RegExp(`\\b(\\d{1,2})\\s*(?:h|std\\.?|stunden?|hours?|heures?|heure|horas?|ora|ore)\\s*[.,;:–—-]*\\s*(15|30|45)\\s*(?:${minuteUnit})?\\b`, "i"),
  );
  if (compactHourMinute?.[1] && compactHourMinute?.[2]) {
    const normalized = normalizeHourRepairQuantity(
      Number(compactHourMinute[1]) + Number(compactHourMinute[2]) / 60,
    );
    if (normalized) return normalized;
  }

  const minuteOnly = source.match(new RegExp(`\\b(15|30|45)\\s*${minuteUnit}\\b`, "i"));
  if (
    minuteOnly?.[1] &&
    /(?:pro|je|per|par|a|\/|à)\s*(?:stunde|stunden|std\.?|h|hour|hours|heure|heures|hora|horas|ora|ore)\b/i.test(source)
  ) {
    const normalized = normalizeHourRepairQuantity(Number(minuteOnly[1]) / 60);
    if (normalized) return normalized;
  }

  const wordOnlyFraction = source.match(
    /\b(?:eine?n?\s+)?(viertel|halb|halbe|dreiviertel|drei\s+viertel|quarter|half|three\s+quarters?|quart|demi(?:e)?|trois\s+quarts?|cuarto|media|medio|tres\s+cuartos?|quarto|mezza|mezzo|tre\s+quarti)\s*(?:stunde|stunden|std\.?|h|hour|hours|heure|heures|hora|horas|ora|ore)\b/i,
  );
  if (wordOnlyFraction?.[1]) {
    const normalized = normalizeHourRepairQuantity(parseHourRepairQuantityToken(wordOnlyFraction[1]));
    if (normalized) return normalized;
  }

  return null;
}

function detectHourRepairUnitPriceInLine(line?: string | null): number | null {
  const source = normalizeHourRepairText(line || "");
  if (!source) return null;

  const currencyWords = "(?:chf|franken|fr\\.?|sfr\\.?|stutz|eur|euro|€)";
  const number = "(\\d+(?:[.,]\\d{1,2})?)";
  const anchor = "(?:à|a|pro|je|per|zu|fuer|für|/)";

  const anchoredPatterns = [
    new RegExp(`${anchor}\\s*${currencyWords}\\s*${number}\\b`, "i"),
    new RegExp(`${anchor}\\s*${number}\\s*${currencyWords}\\b`, "i"),
    new RegExp(`${currencyWords}\\s*${number}\\s*(?:${anchor})\\s*(?:stunde|stunden|std\\.?|h|hour|hours)\\b`, "i"),
    new RegExp(`${number}\\s*${currencyWords}\\s*(?:${anchor})\\s*(?:stunde|stunden|std\\.?|h|hour|hours)\\b`, "i"),
  ];

  for (const pattern of anchoredPatterns) {
    const match = source.match(pattern);
    const value = match?.[1] || match?.[2];
    const parsed = parseHourRepairDecimal(value);
    if (parsed) return parsed;
  }

  const currencyMatches = Array.from(
    source.matchAll(new RegExp(`(?:${currencyWords}\\s*${number}|${number}\\s*${currencyWords})`, "gi")),
  );

  for (const match of currencyMatches) {
    const parsed = parseHourRepairDecimal(match[1] || match[2]);
    if (parsed) return parsed;
  }

  return null;
}

function hourRepairServiceTopic(value?: string | null): string | null {
  const text = normalizeHourRepairText(value || "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const hasCleaningIntent = /reinig|putz|putze|saeuber|clean|nettoyage|nettoyer|pulizia|limpieza|limpeza|wisch|aufnehmen/.test(text);
  if (/\bboden\b|\bbode\b|\bfloor\b|\bsol\b|\bpaviment|\bsuelo\b|hallenboden|lagerboden|kellerboden/.test(text) && hasCleaningIntent) return "boden_reinigen";
  if (/fenster|fensterli|fensterfront|vitrin|vitre|window|fenetre|finestr|ventan/.test(text)) return "fenster_reinigen";
  if (/\bteppich\b|carpet|moquette/.test(text) && hasCleaningIntent) return "teppich_reinigen";
  if (/\banfahrt\b|\bfahrtkosten\b|\bfahrkosten\b|\bfahrpauschale\b|\bwegpauschale\b|\breisepauschale\b|\bdeplacement\b|\bdeplacement\b|\bfrais\s+de\s+deplacement\b|\btravel\b|\btravel\s+flat\s+fee\b|\btrip\b/.test(text)) return "anfahrt";
  return null;
}

function stripAutomaticTranslationBlock(value?: string | null): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n\s*---\s*(?:uebersetzung|übersetzung)\s*\(\s*automatisch\s*\)\s*---\s*/i)[0]
    .trim();
}

export function buildHourLineRepairCandidates(originalText: string): HourLineRepairCandidate[] {
  return stripAutomaticTranslationBlock(originalText)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line))
    .map((line) => ({
      raw: line,
      quantity: detectHourRepairQuantityInLine(line),
      price: detectHourRepairUnitPriceInLine(line),
      topic: hourRepairServiceTopic(line),
      key: normalizeHourRepairText(line),
    }))
    .filter((candidate) =>
      Boolean(candidate.quantity && candidate.quantity > 0 && candidate.price && candidate.price > 0),
    ) as HourLineRepairCandidate[];
}

function chooseHourLineRepairCandidate(
  item: HourLineRepairItem,
  candidates: HourLineRepairCandidate[],
): HourLineRepairCandidate | null {
  const currentPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const samePrice = candidates.filter((candidate) => Math.abs(candidate.price - currentPrice) < 0.01);
  if (samePrice.length === 0) return null;

  const itemText = [item.serviceName, item.description].filter(Boolean).join(" ");
  const itemTopic = hourRepairServiceTopic(itemText);
  const itemKey = normalizeHourRepairText(itemText);

  const sameTopic = itemTopic ? samePrice.filter((candidate) => candidate.topic === itemTopic) : [];
  if (sameTopic.length === 1) return sameTopic[0];
  if (sameTopic.length > 1) return sameTopic.sort((a, b) => b.raw.length - a.raw.length)[0];

  const sameDomain = samePrice.filter((candidate) => {
    if (itemKey.includes("boden") && candidate.key.includes("boden")) return true;
    if (itemKey.includes("fenster") && candidate.key.includes("fenster")) return true;
    if (itemKey.includes("teppich") && candidate.key.includes("teppich")) return true;
    return false;
  });
  if (sameDomain.length === 1) return sameDomain[0];
  if (sameDomain.length > 1) return sameDomain.sort((a, b) => b.raw.length - a.raw.length)[0];

  // Strict fallback: only when this exact price appears in one hourly line.
  // The item is already an hour row with quantity 0, so this cannot leak into
  // Stück/m² rows.
  if (samePrice.length === 1) return samePrice[0];

  return null;
}

function normalizeHourRepairNumber(value: any): number {
  const number = Number(String(value ?? "").replace("'", "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function hasExistingHourLineRepresentation(
  candidate: HourLineRepairCandidate,
  items: HourLineRepairItem[],
): boolean {
  const candidateTotal = roundHourRepairMoney(candidate.quantity * candidate.price);
  return items.some((item) => {
    const itemPrice = normalizeHourRepairNumber(item.unitPrice);
    const itemQuantity = normalizeHourRepairNumber(item.quantity);
    const itemTotal = roundHourRepairMoney(normalizeHourRepairNumber(item.totalPrice));
    const itemText = normalizeHourRepairText(
      [item.serviceName, item.description, item.sourceText, item.evidence]
        .filter(Boolean)
        .join(" "),
    );
    const samePrice = Math.abs(itemPrice - candidate.price) < 0.01;
    const sameQuantity = Math.abs(itemQuantity - candidate.quantity) < 0.001;
    const sameTotal = Math.abs(itemTotal - candidateTotal) < 0.01;
    const sameTopic = candidate.topic
      ? hourRepairServiceTopic([item.serviceName, item.description].filter(Boolean).join(" ")) === candidate.topic
      : false;
    const sameRaw = Boolean(candidate.key && itemText.includes(candidate.key.slice(0, 60)));

    return samePrice && (sameQuantity || sameTotal || sameTopic || sameRaw);
  });
}

function cleanServiceNameFromHourLine(candidate: HourLineRepairCandidate): string {
  let raw = String(candidate.raw || "")
    .replace(/\r\n/g, " ")
    .replace(/\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  raw = raw
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:stunden?|std\.?|h|hours?|heures?|heure|horas?|ora|ore)\b/gi, " ")
    .replace(/\b(?:ein(?:e[nmr]?)?|eine?n?\s+halbe|halbe|halb|dreiviertel|zweieinhalb|dreieinhalb|three\s+quarters?|trois\s+quarts?|tres\s+cuartos?|tre\s+quarti|demi(?:e)?|media|medio|mezza|mezzo)\s*(?:d[\'’]?\s*)?(?:stunden?|std\.?|h|hours?|heures?|heure|horas?|ora|ore)?\b/gi, " ")
    .replace(/\b\d{1,2}\s*(?:h|std\.?|stunden?|hours?|heures?|heure|horas?|ora|ore)\s*[.,;:–—-]*\s*(?:15|30|45)\s*(?:min\.?|minuten?|minutes?|minuti?|minutos?)?\b/gi, " ")
    .replace(/(?:à|a|pro|je|per|zu|fuer|für|\/)?\s*(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|€)?\s*\d+(?:[.,]\d{1,2})?\s*(?:chf|franken|fr\.?|sfr\.?|stutz|eur|euro|€)?\b/gi, " ")
    .replace(/\b(?:zu|at|for)\s*\d+(?:[.,]\d{1,2})?\s*(?:chf|eur|€)?\b/gi, " ")
    .replace(/[:;,.\-–—]+$/g, "")
    .replace(/\b(?:at|zu|a|à|per|pro|je)\s*$/i, "")
    .replace(/[:;,.\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const key = normalizeHourRepairText(raw);
  if (/archive\s+room|archivraum|archiv\b/.test(key)) return "Archivraum reinigen";
  if (/glass\s+door|glastuer|glastur|glastuere|glastüren|porte\s+vitree/.test(key)) return "Glastür reinigen";
  if (/local\s+technique|technikraum|technical\s+room|serverraum/.test(key)) return "Technikraum reinigen";
  if (/meeting\s+(?:area|room)|besprechungsbereich|besprechungsraum|sitzungszimmer|salle\s+de\s+reunion/.test(key)) return "Besprechungsbereich reinigen";
  if (/kontrollgang/.test(key)) return "Kontrollgang reinigen";
  if (/gangbereich|corridor|couloir|flur/.test(key)) return "Gangbereich reinigen";

  if (candidate.topic === "boden_reinigen") return "Boden reinigen";
  if (candidate.topic === "fenster_reinigen") return "Fenster reinigen";
  if (candidate.topic === "teppich_reinigen") return "Teppich reinigen";
  if (candidate.topic === "anfahrt") return "Anfahrt";

  return raw || "Stundenleistung";
}

function buildMissingHourLineItems<T extends HourLineRepairItem>(
  sourceItems: T[],
  candidates: HourLineRepairCandidate[],
): T[] {
  const missing = candidates.filter((candidate) =>
    !hasExistingHourLineRepresentation(candidate, sourceItems),
  );

  return missing.map((candidate) => ({
    serviceName: cleanServiceNameFromHourLine(candidate),
    description: candidate.raw,
    quantity: candidate.quantity,
    unit: "Stunde",
    unitPrice: candidate.price,
    totalPrice: roundHourRepairMoney(candidate.quantity * candidate.price),
    needsReview: true,
    reviewReason: "Nicht im Leistungskatalog. Explizite Stundenleistung aus Kundentext übernommen.",
    sourceText: candidate.raw,
    evidence: candidate.raw,
  }) as unknown as T);
}

function buildFlatFeeRepairCandidates(originalText: string): FlatFeeRepairCandidate[] {
  return stripAutomaticTranslationBlock(originalText)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 6)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line))
    .filter((line) => hourRepairServiceTopic(line) === "anfahrt")
    .map((line) => ({
      raw: line,
      price: detectHourRepairUnitPriceInLine(line),
      topic: "anfahrt" as const,
      key: normalizeHourRepairText(line),
    }))
    .filter((candidate) => Boolean(candidate.price && candidate.price > 0)) as FlatFeeRepairCandidate[];
}

function buildMissingPriceRepairCandidates(originalText: string): MissingPriceRepairCandidate[] {
  const missingPricePattern =
    /\b(?:preis\s+(?:fehlt|offen|noch\s+offen|unbekannt|nachtragen|klaeren|klären)|betrag\s+(?:fehlt|offen|unbekannt)|ohne\s+preis|noch\s+kein\s+preis|price\s+(?:missing|open|unknown|tbd)|no\s+price|prix\s+(?:manquant|ouvert|inconnu)|sans\s+prix)\b/i;

  return stripAutomaticTranslationBlock(originalText)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|;/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => !/^\s*\[?\s*(?:titel|title)\s*:/i.test(line))
    .filter((line) => missingPricePattern.test(line))
    .map((line) => {
      const topic = hourRepairServiceTopic(line);
      const quantity = detectHourRepairQuantityInLine(line) || 1;
      const unit = detectHourRepairQuantityInLine(line) ? "Stunde" : "Pauschal";
      return {
        raw: line,
        serviceName: cleanServiceNameFromMissingPriceLine(line),
        quantity,
        unit,
        topic,
        key: normalizeHourRepairText(line),
      };
    })
    // Known catalog-like lines may legitimately use the catalog price.
    // Non-catalog explicit missing-price lines must stay red.
    .filter((candidate) => !candidate.topic)
    .filter((candidate) => compactMissingPriceServiceName(candidate.serviceName).length >= 3);
}

function compactMissingPriceServiceName(value?: string | null): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanServiceNameFromMissingPriceLine(line: string): string {
  let raw = String(line || "")
    .replace(/\b(?:preis\s+(?:fehlt|offen|noch\s+offen|unbekannt|nachtragen|klaeren|klären)|betrag\s+(?:fehlt|offen|unbekannt)|ohne\s+preis|noch\s+kein\s+preis|price\s+(?:missing|open|unknown|tbd)|no\s+price|prix\s+(?:manquant|ouvert|inconnu)|sans\s+prix)\b.*$/i, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:stunden?|std\.?|h|hours?|heures?|heure|horas?|ora|ore)\b/gi, " ")
    .replace(/\b(?:eine?n?\s+halbe|halbe|dreiviertel|drei\s+viertel|three\s+quarters?|trois\s+quarts?|quarter|viertel)\s*(?:stunde|stunden|std\.?|h|hour|hours|heure|heures)?\b/gi, " ")
    .replace(/[:;,.-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const key = normalizeHourRepairText(raw);
  if (/archive\s+room|archivraum|\barchiv\b/.test(key)) return "Archivraum reinigen";
  if (/glass\s+door|glastuer|glastur|glastuere|glastüren|porte\s+vitree/.test(key)) return "Glastür reinigen";
  if (/local\s+technique|technikraum|technical\s+room|serverraum/.test(key)) return "Technikraum reinigen";
  if (/meeting\s+(?:area|room)|besprechungsbereich|besprechungsraum|sitzungszimmer|salle\s+de\s+reunion/.test(key)) return "Besprechungsbereich reinigen";
  if (/kontrollgang/.test(key)) return "Kontrollgang reinigen";
  if (/gangbereich|corridor|couloir|flur/.test(key)) return "Gangbereich reinigen";

  return raw || "Leistung prüfen";
}

function hasMissingPriceSignal(value?: string | null): boolean {
  return /\b(?:preis\s+(?:fehlt|offen|noch\s+offen|unbekannt|nachtragen|klaeren|klären)|betrag\s+(?:fehlt|offen|unbekannt)|ohne\s+preis|noch\s+kein\s+preis|price\s+(?:missing|open|unknown|tbd)|no\s+price|prix\s+(?:manquant|ouvert|inconnu)|sans\s+prix)\b/i.test(
    String(value || ""),
  );
}

function hasExistingMissingPriceRepresentation(
  candidate: MissingPriceRepairCandidate,
  items: HourLineRepairItem[],
): boolean {
  const candidateService = normalizeHourRepairText(candidate.serviceName);
  return items.some((item) => {
    const itemService = normalizeHourRepairText(item.serviceName || item.description || "");
    if (!itemService || !candidateService) return false;
    const sameService = itemService.includes(candidateService) || candidateService.includes(itemService);
    if (!sameService) return false;

    // A false priced row with the same display name must NOT block creation of
    // the real red missing-price row. It only counts as existing when it is
    // already a blocker / zero-price representation or still carries the
    // explicit missing-price source line.
    const unitPrice = normalizeHourRepairNumber(item.unitPrice);
    const totalPrice = normalizeHourRepairNumber(item.totalPrice);
    const reviewText = [item.description, item.sourceText, item.evidence, item.reviewReason]
      .filter(Boolean)
      .join(" ");

    return unitPrice <= 0 || totalPrice <= 0 || hasMissingPriceSignal(reviewText);
  });
}

function chooseMissingPriceCandidateForItem(
  item: HourLineRepairItem,
  candidates: MissingPriceRepairCandidate[],
): MissingPriceRepairCandidate | null {
  if (!candidates.length) return null;

  const itemService = normalizeHourRepairText(item.serviceName || item.description || "");
  if (!itemService) return null;

  const direct = candidates.find((candidate) => {
    const candidateService = normalizeHourRepairText(candidate.serviceName);
    return Boolean(
      candidateService &&
        (itemService.includes(candidateService) || candidateService.includes(itemService)),
    );
  });

  return direct || null;
}

function needsMissingPriceReviewRepair(
  item: HourLineRepairItem,
  candidate: MissingPriceRepairCandidate,
): boolean {
  const unitPrice = normalizeHourRepairNumber(item.unitPrice);
  const totalPrice = normalizeHourRepairNumber(item.totalPrice);
  const quantity = normalizeHourRepairNumber(item.quantity);

  return (
    unitPrice > 0 ||
    totalPrice > 0 ||
    Math.abs(quantity - candidate.quantity) >= 0.001 ||
    !isHourRepairHourUnit(item.unit)
  );
}


function hasExistingFlatFeeRepresentation(
  candidate: FlatFeeRepairCandidate,
  items: HourLineRepairItem[],
): boolean {
  return items.some((item) => {
    const itemText = [item.serviceName, item.description, item.sourceText, item.evidence]
      .filter(Boolean)
      .join(" ");
    const itemTopic = hourRepairServiceTopic(itemText);
    const itemPrice = normalizeHourRepairNumber(item.unitPrice);
    const itemTotal = roundHourRepairMoney(normalizeHourRepairNumber(item.totalPrice));
    const itemQuantity = normalizeHourRepairNumber(item.quantity);
    return (
      itemTopic === "anfahrt" &&
      Math.abs(itemPrice - candidate.price) < 0.01 &&
      (Math.abs(itemTotal - candidate.price) < 0.01 || itemQuantity === 1)
    );
  });
}

function chooseFlatFeeRepairCandidateForItem(
  item: HourLineRepairItem,
  candidates: FlatFeeRepairCandidate[],
): FlatFeeRepairCandidate | null {
  if (!candidates.length) return null;

  const itemText = [item.serviceName, item.description, item.sourceText, item.evidence]
    .filter(Boolean)
    .join(" ");
  if (hourRepairServiceTopic(itemText) !== "anfahrt") return null;

  const itemPrice = normalizeHourRepairNumber(item.unitPrice);
  const samePrice = candidates.find((candidate) => Math.abs(candidate.price - itemPrice) < 0.01);
  if (samePrice) return samePrice;

  const itemKey = normalizeHourRepairText(itemText);
  const direct = candidates.find((candidate) =>
    itemKey.includes(candidate.key) || candidate.key.includes(itemKey),
  );
  if (direct) return direct;

  return candidates[0] || null;
}

function needsFlatFeeRepair(item: HourLineRepairItem, candidate: FlatFeeRepairCandidate): boolean {
  const serviceName = normalizeHourRepairText(item.serviceName || "");
  const unit = normalizeHourRepairText(item.unit || "").replace(/[^a-z0-9]/g, "");
  const quantity = normalizeHourRepairNumber(item.quantity);
  const unitPrice = normalizeHourRepairNumber(item.unitPrice);
  const totalPrice = roundHourRepairMoney(normalizeHourRepairNumber(item.totalPrice));

  return (
    serviceName !== "anfahrt" ||
    unit !== "pauschal" ||
    Math.abs(quantity - 1) >= 0.001 ||
    Math.abs(unitPrice - candidate.price) >= 0.01 ||
    Math.abs(totalPrice - candidate.price) >= 0.01
  );
}

function buildMissingFlatFeeItems<T extends HourLineRepairItem>(
  sourceItems: T[],
  candidates: FlatFeeRepairCandidate[],
): T[] {
  return candidates
    .filter((candidate) => !hasExistingFlatFeeRepresentation(candidate, sourceItems))
    .map((candidate) => ({
      serviceName: "Anfahrt",
      description: candidate.raw,
      quantity: 1,
      unit: "Pauschal",
      unitPrice: candidate.price,
      totalPrice: roundHourRepairMoney(candidate.price),
      needsReview: true,
      reviewReason: "Textpreis übernommen: Anfahrt/Reisepauschale aus Kundentext übernommen.",
      sourceText: candidate.raw,
      evidence: candidate.raw,
    }) as unknown as T);
}

function buildMissingPriceReviewItems<T extends HourLineRepairItem>(
  sourceItems: T[],
  candidates: MissingPriceRepairCandidate[],
): T[] {
  return candidates
    .filter((candidate) => !hasExistingMissingPriceRepresentation(candidate, sourceItems))
    .map((candidate) => ({
      serviceName: candidate.serviceName,
      description: candidate.raw,
      quantity: candidate.quantity,
      unit: candidate.unit,
      unitPrice: 0,
      totalPrice: 0,
      needsReview: true,
      reviewReason: "unit_price_review",
      sourceText: candidate.raw,
      evidence: candidate.raw,
    }) as unknown as T);
}

function isAnfahrtText(value?: string | null): boolean {
  return /\b(?:anfahrt|fahrtkosten|fahrkosten|fahrt\s*pauschale|fahrpauschale|wegpauschale|reisepauschale|travel\s*(?:flat\s*)?fee|travel\s+costs?|trip\s+fee|transport\s+fee|deplacement|déplacement|frais\s+de\s+deplacement)\b/i.test(
    normalizeHourRepairText(value || ""),
  );
}

function isCatalogFloorLikeItem(item: HourLineRepairItem): boolean {
  const key = normalizeHourRepairText([item.serviceName, item.description].filter(Boolean).join(" "));
  const unit = normalizeHourRepairText(item.unit || "").replace(/[^a-z0-9]/g, "");
  return /\bboden\b|floor|sol|paviment|suelo/.test(key) || ["quadratmeter", "m2", "qm", "sqm"].includes(unit);
}

function hasExistingAnfahrtWithPrice(items: HourLineRepairItem[], price: number): boolean {
  return items.some((item) => {
    const text = [item.serviceName, item.description, item.sourceText, item.evidence]
      .filter(Boolean)
      .join(" ");
    return (
      hourRepairServiceTopic(text) === "anfahrt" &&
      Math.abs(normalizeHourRepairNumber(item.unitPrice) - price) < 0.01 &&
      Math.abs(roundHourRepairMoney(normalizeHourRepairNumber(item.totalPrice)) - price) < 0.01
    );
  });
}

function isSpuriousFlatFeeDuplicateItem(
  item: HourLineRepairItem,
  allItems: HourLineRepairItem[],
  flatFeeCandidates: FlatFeeRepairCandidate[],
): boolean {
  if (!flatFeeCandidates.length) return false;

  const itemText = [item.serviceName, item.description, item.sourceText, item.evidence]
    .filter(Boolean)
    .join(" ");
  if (hourRepairServiceTopic(itemText) === "anfahrt" || isAnfahrtText(item.serviceName)) return false;

  const itemPrice = normalizeHourRepairNumber(item.unitPrice);
  const itemTotal = roundHourRepairMoney(normalizeHourRepairNumber(item.totalPrice));
  const itemQuantity = normalizeHourRepairNumber(item.quantity);

  const candidate = flatFeeCandidates.find((entry) => Math.abs(entry.price - itemPrice) < 0.01);
  if (!candidate) return false;
  if (!hasExistingAnfahrtWithPrice(allItems, candidate.price)) return false;

  const looksLikeSyntheticOneUnit =
    Math.abs(itemQuantity - 1) < 0.001 &&
    Math.abs(itemTotal - candidate.price) < 0.01 &&
    isCatalogFloorLikeItem(item);

  const hasOwnStrongSource =
    isAnfahrtText(itemText) ||
    normalizeHourRepairText(itemText).includes(normalizeHourRepairText(candidate.raw));

  return looksLikeSyntheticOneUnit && !hasOwnStrongSource;
}

function isSpuriousPricedMissingPriceDuplicateItem(
  item: HourLineRepairItem,
  allItems: HourLineRepairItem[],
  missingPriceCandidates: MissingPriceRepairCandidate[],
): boolean {
  if (!missingPriceCandidates.length) return false;

  const unitPrice = normalizeHourRepairNumber(item.unitPrice);
  const totalPrice = normalizeHourRepairNumber(item.totalPrice);
  if (unitPrice <= 0 || totalPrice <= 0) return false;

  const itemText = [item.serviceName, item.description, item.sourceText, item.evidence]
    .filter(Boolean)
    .join(" ");
  const itemKey = normalizeHourRepairText(itemText);

  return missingPriceCandidates.some((candidate) => {
    const candidateService = normalizeHourRepairText(candidate.serviceName);
    const itemService = normalizeHourRepairText(item.serviceName || item.description || "");
    const sameService = Boolean(
      candidateService && itemService && (itemService.includes(candidateService) || candidateService.includes(itemService)),
    );
    const sameQuantity = Math.abs(normalizeHourRepairNumber(item.quantity) - candidate.quantity) < 0.001;
    const sameUnit =
      isHourRepairHourUnit(item.unit) === isHourRepairHourUnit(candidate.unit) ||
      normalizeHourRepairText(item.unit || "") === normalizeHourRepairText(candidate.unit || "");
    const hasSeparateZeroBlocker = allItems.some((other) => {
      if (other === item) return false;
      const otherService = normalizeHourRepairText(other.serviceName || other.description || "");
      return (
        otherService &&
        candidateService &&
        (otherService.includes(candidateService) || candidateService.includes(otherService)) &&
        normalizeHourRepairNumber(other.unitPrice) <= 0
      );
    });

    const sourceIsClearlyOtherPricedLine =
      /fenster|window|vitre|glastuer|glastur|glass\s+door/.test(itemKey) &&
      !/fenster|window|vitre|glastuer|glastur|glass\s+door/.test(candidateService);

    return sameService && sameQuantity && sameUnit && (hasSeparateZeroBlocker || sourceIsClearlyOtherPricedLine);
  });
}

function removeSpuriousRepairDuplicates<T extends HourLineRepairItem>(
  items: T[],
  flatFeeCandidates: FlatFeeRepairCandidate[],
  missingPriceCandidates: MissingPriceRepairCandidate[],
): T[] {
  return items.filter((item) => {
    if (isSpuriousFlatFeeDuplicateItem(item, items, flatFeeCandidates)) return false;
    if (isSpuriousPricedMissingPriceDuplicateItem(item, items, missingPriceCandidates)) return false;
    return true;
  });
}

export function repairZeroQuantityHourItemsFromText<T extends HourLineRepairItem>(
  items: T[] | undefined | null,
  originalText: string,
  options?: { logPrefix?: string },
): HourLineRepairResult<T> {
  const sourceItems = Array.isArray(items) ? items : [];
  const candidates = buildHourLineRepairCandidates(originalText);
  const flatFeeCandidates = buildFlatFeeRepairCandidates(originalText);
  const missingPriceCandidates = buildMissingPriceRepairCandidates(originalText);
  const repairableRowsBefore = sourceItems.filter((item) =>
    isRepairableHourRepairRow(item, candidates),
  );
  const missingItems = [
    ...buildMissingHourLineItems(sourceItems, candidates),
    ...buildMissingFlatFeeItems(sourceItems, flatFeeCandidates),
    ...buildMissingPriceReviewItems(sourceItems, missingPriceCandidates),
  ];

  if (options?.logPrefix) {
    const candidateSummary = candidates
      .slice(0, 8)
      .map((candidate) => `${candidate.quantity}h@${candidate.price}:${candidate.topic || "no-topic"}`)
      .join(" | ");
    const zeroSummary = repairableRowsBefore
      .slice(0, 5)
      .map((item) => hourRepairItemDebugSummary(item))
      .join(" | ");
    const itemSummary = sourceItems
      .slice(0, 8)
      .map((item) => hourRepairItemDebugSummary(item))
      .join(" | ");
    console.info(
      `${options.logPrefix} start items=${sourceItems.length} zeroHourRows=${repairableRowsBefore.length} missingRows=${missingItems.length} hourCandidates=${candidates.length} flatFeeCandidates=${flatFeeCandidates.length} missingPriceCandidates=${missingPriceCandidates.length} candidateSummary=${candidateSummary || "none"} zeroSummary=${zeroSummary || "none"} itemSummary=${itemSummary || "none"}`,
    );
  }

  if (sourceItems.length === 0 && missingItems.length === 0) {
    if (options?.logPrefix) {
      console.info(`${options.logPrefix} done repaired=0 created=0 remainingZeroHourRows=0`);
    }
    return {
      items: sourceItems,
      repairedCount: 0,
      remainingZeroHourRows: 0,
      candidates,
    };
  }

  if (candidates.length === 0 && flatFeeCandidates.length === 0 && missingPriceCandidates.length === 0 && missingItems.length === 0) {
    if (options?.logPrefix) {
      console.info(
        `${options.logPrefix} done repaired=0 created=0 remainingZeroHourRows=${repairableRowsBefore.length}`,
      );
    }
    return {
      items: sourceItems,
      repairedCount: 0,
      remainingZeroHourRows: repairableRowsBefore.length,
      candidates,
    };
  }

  let repairedCount = 0;
  const repairedItems = sourceItems.map((item) => {
    const missingPriceCandidate = chooseMissingPriceCandidateForItem(item, missingPriceCandidates);
    if (missingPriceCandidate && needsMissingPriceReviewRepair(item, missingPriceCandidate)) {
      repairedCount += 1;
      if (options?.logPrefix) {
        console.info(`${options.logPrefix} repaired missing price service=${item.serviceName || "?"} line=${missingPriceCandidate.raw}`);
      }
      return {
        ...item,
        serviceName: missingPriceCandidate.serviceName,
        quantity: missingPriceCandidate.quantity,
        unit: missingPriceCandidate.unit,
        unitPrice: 0,
        totalPrice: 0,
        needsReview: true,
        reviewReason: "unit_price_review",
        description: missingPriceCandidate.raw,
        sourceText: missingPriceCandidate.raw,
        evidence: missingPriceCandidate.raw,
      } as T;
    }

    const flatFeeCandidate = chooseFlatFeeRepairCandidateForItem(item, flatFeeCandidates);
    if (flatFeeCandidate && needsFlatFeeRepair(item, flatFeeCandidate)) {
      repairedCount += 1;
      if (options?.logPrefix) {
        console.info(`${options.logPrefix} repaired flat fee service=${item.serviceName || "?"} price=${flatFeeCandidate.price} line=${flatFeeCandidate.raw}`);
      }
      return {
        ...item,
        serviceName: "Anfahrt",
        quantity: 1,
        unit: "Pauschal",
        unitPrice: flatFeeCandidate.price,
        totalPrice: roundHourRepairMoney(flatFeeCandidate.price),
        description: flatFeeCandidate.raw,
        sourceText: flatFeeCandidate.raw,
        evidence: flatFeeCandidate.raw,
      } as T;
    }

    if (!isRepairableHourRepairRow(item, candidates)) return item;
    const currentPrice = Number(item.unitPrice || 0);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return item;

    const chosen = chooseHourLineRepairCandidate(item, candidates);
    if (!chosen) {
      if (options?.logPrefix) {
        console.warn(`${options.logPrefix} no-match service=${item.serviceName || "?"} price=${currentPrice}`);
      }
      return item;
    }

    const quantity = normalizeHourRepairQuantity(chosen.quantity);
    if (!quantity || quantity <= 0) return item;

    repairedCount += 1;
    if (options?.logPrefix) {
      console.info(`${options.logPrefix} repaired service=${item.serviceName || "?"} quantity=${quantity} price=${currentPrice} line=${chosen.raw}`);
    }

    return {
      ...item,
      quantity,
      unit: "Stunde",
      unitPrice: currentPrice,
      totalPrice: roundHourRepairMoney(quantity * currentPrice),
      description: chosen.raw,
      sourceText: chosen.raw,
      evidence: chosen.raw,
    } as T;
  });

  const createdItems = [
    ...buildMissingHourLineItems(repairedItems, candidates),
    ...buildMissingFlatFeeItems(repairedItems, flatFeeCandidates),
    ...buildMissingPriceReviewItems(repairedItems, missingPriceCandidates),
  ];
  const finalItems = removeSpuriousRepairDuplicates(
    [...repairedItems, ...createdItems],
    flatFeeCandidates,
    missingPriceCandidates,
  );

  const remainingZeroHourRows = finalItems.filter((item) =>
    isRepairableHourRepairRow(item, candidates),
  ).length;

  if (options?.logPrefix) {
    console.info(
      `${options.logPrefix} done repaired=${repairedCount} created=${createdItems.length} remainingZeroHourRows=${remainingZeroHourRows}`,
    );
  }

  return {
    items: finalItems,
    repairedCount: repairedCount + createdItems.length,
    remainingZeroHourRows,
    candidates,
  };
}

export async function repairPersistedOrderZeroHourItemsFromText(params: {
  prisma: any;
  order?: any;
  orderId?: string | null;
  originalText: string;
  logPrefix?: string;
}): Promise<{ order: any; repairedCount: number; remainingZeroHourRows: number }> {
  const orderId = String(params.orderId || params.order?.id || "").trim();
  if (!orderId) return { order: params.order, repairedCount: 0, remainingZeroHourRows: 0 };

  try {
    const order =
      params.order && Array.isArray(params.order.items)
        ? params.order
        : await params.prisma.order.findUnique({
            where: { id: orderId },
            include: { customer: true, items: { include: { workSite: true } }, workSites: true },
          });

    if (!order || !Array.isArray(order.items) || order.items.length === 0) {
      if (params.logPrefix) {
        console.info(`${params.logPrefix} skipped orderId=${orderId} reason=no_order_or_items`);
      }
      return { order: order || params.order, repairedCount: 0, remainingZeroHourRows: 0 };
    }

    const combinedSourceText = [
      params.originalText,
      order.notes,
      order.description,
      order.audioTranscript,
      ...(Array.isArray(order.items)
        ? order.items.flatMap((item: any) => [item?.serviceName, item?.description, item?.sourceText, item?.evidence])
        : []),
    ]
      .filter(Boolean)
      .join("\n");

    const result = repairZeroQuantityHourItemsFromText(order.items, combinedSourceText, {
      logPrefix: params.logPrefix,
    });

    const beforeById = new Map(
      order.items
        .filter((item: any) => item?.id)
        .map((item: any) => [String(item.id), item]),
    );
    const keptIds = new Set(
      result.items
        .filter((item: any) => item?.id)
        .map((item: any) => String(item.id)),
    );

    const updates = result.items
      .filter((item: any) => item?.id && beforeById.has(String(item.id)))
      .map((item: any) => ({ before: beforeById.get(String(item.id)), after: item }))
      .filter(({ before, after }: any) => {
        if (!before?.id) return false;
        return (
          Number(before.quantity || 0) !== Number(after.quantity || 0) ||
          Number(before.unitPrice || 0) !== Number(after.unitPrice || 0) ||
          Number(before.totalPrice || 0) !== Number(after.totalPrice || 0) ||
          String(before.unit || "") !== String(after.unit || "") ||
          String(before.serviceName || "") !== String(after.serviceName || "") ||
          String(before.description || "") !== String(after.description || "")
        );
      });

    const creates = result.items
      .filter((item: any) => !item?.id && String(item?.serviceName || "").trim());

    const deleteIds = order.items
      .filter((item: any) => item?.id && !keptIds.has(String(item.id)))
      .map((item: any) => String(item.id));

    if (result.repairedCount === 0 && updates.length === 0 && creates.length === 0 && deleteIds.length === 0) {
      return { order, repairedCount: 0, remainingZeroHourRows: result.remainingZeroHourRows };
    }

    const newNetTotal = roundHourRepairMoney(
      result.items.reduce((sum: number, item: any) => sum + Number(item.totalPrice || 0), 0),
    );
    const vatRate = Number(order.vatRate ?? 0);
    const safeVatRate = Number.isFinite(vatRate) && vatRate > 0 ? vatRate : 0;
    const vatAmount = roundHourRepairMoney((newNetTotal * safeVatRate) / 100);
    const total = roundHourRepairMoney(newNetTotal + vatAmount);

    const updatedOrder = await params.prisma.order.update({
      where: { id: orderId },
      data: {
        totalPrice: newNetTotal,
        vatAmount,
        total,
        items: {
          deleteMany: deleteIds.length > 0 ? { id: { in: deleteIds } } : undefined,
          update: updates.map(({ before, after }: any) => ({
            where: { id: before.id },
            data: {
              serviceName: String(after.serviceName || before.serviceName || "Leistung"),
              quantity: Number(after.quantity || 0),
              unit: String(after.unit || before.unit || "Stunde"),
              unitPrice: Number(after.unitPrice ?? before.unitPrice ?? 0),
              totalPrice: Number(after.totalPrice || 0),
              description: String(after.description || before.description || ""),
            },
          })),
          create: creates.map((item: any) => ({
            serviceName: String(item.serviceName || "Stundenleistung"),
            description: String(item.description || item.serviceName || "Stundenleistung"),
            quantity: Number(item.quantity || 0),
            unit: String(item.unit || "Stunde"),
            unitPrice: Number(item.unitPrice || 0),
            totalPrice: Number(item.totalPrice || 0),
          })),
        },
      },
      include: { customer: true, items: { include: { workSite: true } }, workSites: true },
    });

    return {
      order: updatedOrder,
      repairedCount: updates.length + creates.length + deleteIds.length,
      remainingZeroHourRows: result.remainingZeroHourRows,
    };
  } catch (err) {
    console.error(`${params.logPrefix || "[OrderHourLineRepair]"} failed orderId=${orderId}:`, err);
    return { order: params.order, repairedCount: 0, remainingZeroHourRows: 0 };
  }
}
