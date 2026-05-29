export type HourLineRepairCandidate = {
  raw: string;
  quantity: number;
  price: number;
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
};

function parseHourRepairQuantityToken(value?: string | null): number | null {
  const numeric = parseHourRepairDecimal(value);
  if (numeric) return numeric;

  const key = normalizeHourRepairText(value || "").replace(/\s+/g, "");
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
  return ["stunde", "stunden", "std", "h", "hour", "hours", "stundensatz"].includes(unit);
}

function detectHourRepairQuantityInLine(line?: string | null): number | null {
  const source = normalizeHourRepairText(line || "");
  if (!source) return null;

  const numberOrWord =
    "(?:\\d+(?:[.,]\\d+)?|ein|eine|einen|einem|einer|eins|viertel|halbe|halb|dreiviertel|anderthalb|eineinhalb|zweieinhalb|dreieinhalb|viereinhalb|fuenfeinhalb|funfeinhalb|sechseinhalb|siebeneinhalb|achteinhalb|neuneinhalb|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun|zehn)";
  const hourUnit = "(?:stunden?|std\\.?|h|hours?)";
  const minuteUnit = "(?:min\\.?|minuten?|minutes?)";

  const hourMatch = source.match(new RegExp(`\\b(${numberOrWord})\\s*${hourUnit}\\b`, "i"));
  if (hourMatch?.[1]) {
    const base = parseHourRepairQuantityToken(hourMatch[1]);
    if (base) {
      let total = base;
      const after = source.slice((hourMatch.index || 0) + hourMatch[0].length);
      const minuteAfter = after.match(new RegExp(`^\\s*(?:und|\\+)?\\s*(15|30|45)\\s*${minuteUnit}\\b`, "i"));
      if (minuteAfter?.[1]) total += Number(minuteAfter[1]) / 60;
      const normalized = normalizeHourRepairQuantity(total);
      if (normalized) return normalized;
    }
  }

  const hourPlusWordFraction = source.match(
    new RegExp(
      `\\b(${numberOrWord})\\s*${hourUnit}\\s*(?:und|\\+)?\\s*(?:eine?n?\\s+)?(viertel|halb|halbe|dreiviertel)\\s*(?:stunde|stunden|std\\.?|h)?\\b`,
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
    new RegExp(`\\b(\\d{1,2})\\s*(?:h|std\\.?|stunden?)\\s*(15|30|45)\\s*(?:${minuteUnit})?\\b`, "i"),
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
    /(?:pro|je|per|par|a|\/|à)\s*(?:stunde|stunden|std\.?|h|hour|hours)\b/i.test(source)
  ) {
    const normalized = normalizeHourRepairQuantity(Number(minuteOnly[1]) / 60);
    if (normalized) return normalized;
  }

  const wordOnlyFraction = source.match(
    /\b(?:eine?n?\s+)?(viertel|halb|halbe|dreiviertel)\s*(?:stunde|stunden|std\.?|h)\b/i,
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
  if (/\banfahrt\b|\bfahrtkosten\b|\bfahrkosten\b|\bfahrpauschale\b|\bwegpauschale\b|\bdeplacement\b|\btravel\b|\btrip\b/.test(text)) return "anfahrt";
  return null;
}

export function buildHourLineRepairCandidates(originalText: string): HourLineRepairCandidate[] {
  return String(originalText || "")
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

export function repairZeroQuantityHourItemsFromText<T extends HourLineRepairItem>(
  items: T[] | undefined | null,
  originalText: string,
  options?: { logPrefix?: string },
): HourLineRepairResult<T> {
  const sourceItems = Array.isArray(items) ? items : [];
  const candidates = buildHourLineRepairCandidates(originalText);
  const zeroHourRowsBefore = sourceItems.filter(
    (item) =>
      isHourRepairHourUnit(item.unit) &&
      Number(item.unitPrice || 0) > 0 &&
      Number(item.quantity || 0) <= 0,
  );

  if (options?.logPrefix) {
    const candidateSummary = candidates
      .slice(0, 5)
      .map((candidate) => `${candidate.quantity}h@${candidate.price}:${candidate.topic || "no-topic"}`)
      .join(" | ");
    const zeroSummary = zeroHourRowsBefore
      .slice(0, 5)
      .map((item) => `${item.serviceName || "?"}@${Number(item.unitPrice || 0)}`)
      .join(" | ");
    console.info(
      `${options.logPrefix} start items=${sourceItems.length} zeroHourRows=${zeroHourRowsBefore.length} candidates=${candidates.length} candidateSummary=${candidateSummary || "none"} zeroSummary=${zeroSummary || "none"}`,
    );
  }

  if (sourceItems.length === 0 || candidates.length === 0 || zeroHourRowsBefore.length === 0) {
    if (options?.logPrefix) {
      console.info(
        `${options.logPrefix} done repaired=0 remainingZeroHourRows=${zeroHourRowsBefore.length}`,
      );
    }
    return {
      items: sourceItems,
      repairedCount: 0,
      remainingZeroHourRows: zeroHourRowsBefore.length,
      candidates,
    };
  }

  let repairedCount = 0;
  const repairedItems = sourceItems.map((item) => {
    if (!isHourRepairHourUnit(item.unit)) return item;
    const currentPrice = Number(item.unitPrice || 0);
    const currentQuantity = Number(item.quantity || 0);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0 || currentQuantity > 0) return item;

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

  const remainingZeroHourRows = repairedItems.filter(
    (item) =>
      isHourRepairHourUnit(item.unit) &&
      Number(item.unitPrice || 0) > 0 &&
      Number(item.quantity || 0) <= 0,
  ).length;

  if (options?.logPrefix && zeroHourRowsBefore.length > 0) {
    console.info(`${options.logPrefix} done repaired=${repairedCount} remainingZeroHourRows=${remainingZeroHourRows}`);
  }

  return { items: repairedItems, repairedCount, remainingZeroHourRows, candidates };
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

    if (result.repairedCount === 0) {
      return { order, repairedCount: 0, remainingZeroHourRows: result.remainingZeroHourRows };
    }

    const updates = result.items
      .map((item: any, index: number) => ({ before: order.items[index], after: item }))
      .filter(({ before, after }: any) => {
        if (!before?.id) return false;
        return (
          Number(before.quantity || 0) !== Number(after.quantity || 0) ||
          Number(before.totalPrice || 0) !== Number(after.totalPrice || 0) ||
          String(before.description || "") !== String(after.description || "")
        );
      });

    if (updates.length === 0) {
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
          update: updates.map(({ before, after }: any) => ({
            where: { id: before.id },
            data: {
              quantity: Number(after.quantity || 0),
              totalPrice: Number(after.totalPrice || 0),
              description: String(after.description || before.description || ""),
            },
          })),
        },
      },
      include: { customer: true, items: { include: { workSite: true } }, workSites: true },
    });

    return {
      order: updatedOrder,
      repairedCount: updates.length,
      remainingZeroHourRows: result.remainingZeroHourRows,
    };
  } catch (err) {
    console.error(`${params.logPrefix || "[OrderHourLineRepair]"} failed orderId=${orderId}:`, err);
    return { order: params.order, repairedCount: 0, remainingZeroHourRows: 0 };
  }
}
