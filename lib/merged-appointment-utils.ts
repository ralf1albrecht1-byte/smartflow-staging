export type MergedAppointmentWorkSite = {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  isPrimary?: boolean | null;
  sortOrder?: number | null;
};

export type MergedAppointmentRecord = {
  id?: string | null;
  date?: string | null;
  createdAt?: string | null;
  notes?: string | null;
  specialNotes?: string | null;
  description?: string | null;
  audioTranscript?: string | null;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  workSites?: MergedAppointmentWorkSite[] | null;
};

export type MergedAppointmentEntry = {
  site: string;
  label: string;
  source: string;
};

type ParsedAppointment = {
  label: string;
  dateKey: string;
  timeKey: string;
  source: string;
};

const compact = (value: unknown): string =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeSiteDisplay = (value: unknown): string =>
  compact(value)
    .replace(/^\s*(?:sort|source|quelle|start)\s*:?\s*/i, "")
    .replace(/^\s*(?:im|in der|in dem|am|an der)\s+/i, "")
    .replace(/\s*,?\s*(?:gleiche|selbe)\s+adresse\s*$/i, "")
    .replace(/[,:;\-–—.\s]+$/g, "")
    .trim();

const splitMergedSections = (value: unknown): string[] => {
  const source = compact(value);
  if (!source) return [];
  const sections = source
    .split(
      /\n?\s*(?:[-─]{3,}\s*)?(?:Hauptauftrag|Zusammengeführt mit|Zusammengefuehrt mit)\s*:\s*\n?/gi,
    )
    .map((part) => part.trim())
    .filter(Boolean);
  return sections.length > 0 ? sections : [source];
};

const sortedWorkSites = (record: MergedAppointmentRecord) =>
  (Array.isArray(record.workSites) ? [...record.workSites] : []).sort(
    (a, b) =>
      Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
      Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
  );

const inferSectionSiteName = (section: string): string => {
  const lines = String(section || "")
    .split(/\n+/g)
    .map((line) => compact(line))
    .filter(Boolean);
  const marker =
    /^(?:ausführung|ausfuehrung|ausführungsort|ausfuehrungsort|ausführungsadresse|ausfuehrungsadresse|arbeitsort|einsatzort|objekt|baustelle)\s*:?\s*(.*)$/i;
  const addressLike =
    /\b(?:strasse|straße|weg|gasse|platz|allee|ring|rue|route|via|street|road)\b.*\d|\b\d{4,5}\b/i;
  const stop =
    /^(?:termin|termine|einsatz|einsätze|einsaetze|leistung|leistungen|rechnung|rechnungsadresse|kontakt|telefon|sms|whatsapp|e-?mail)\b/i;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(marker);
    if (!match) continue;
    const inline = normalizeSiteDisplay(match[1]);
    if (inline && !addressLike.test(inline)) return inline;
    for (let offset = 1; offset <= 3; offset += 1) {
      const candidate = normalizeSiteDisplay(lines[index + offset]);
      if (!candidate || stop.test(candidate)) break;
      if (addressLike.test(candidate)) continue;
      return candidate;
    }
  }
  return "";
};

const resolveSectionSite = (
  record: MergedAppointmentRecord,
  section: string,
  sectionIndex: number,
): string => {
  const workSites = sortedWorkSites(record);
  const sectionKey = normalize(section);
  const matchedByIdentity = workSites.find((site) => {
    const candidates = [site?.siteName, site?.siteAddress]
      .map(normalize)
      .filter(Boolean);
    return candidates.some((candidate) => sectionKey.includes(candidate));
  });
  const matchedByPlace = workSites.filter((site) => {
    const placeKey = normalize(
      [site?.sitePlz, site?.siteCity].filter(Boolean).join(" "),
    );
    return Boolean(placeKey && sectionKey.includes(placeKey));
  });
  const matched =
    matchedByIdentity ||
    (matchedByPlace.length === 1 ? matchedByPlace[0] : undefined);
  const fallback = matched || workSites[sectionIndex] || workSites[0];
  return (
    normalizeSiteDisplay(fallback?.siteName) ||
    normalizeSiteDisplay(inferSectionSiteName(section)) ||
    compact(fallback?.siteAddress) ||
    normalizeSiteDisplay(record.siteName) ||
    compact(record.siteAddress) ||
    `Arbeitsort ${sectionIndex + 1}`
  );
};

const APPOINTMENT_CONTEXT_PATTERN =
  /\b(?:termin|termine|ausführungstermin|ausfuehrungstermin|zeitfenster|einsatz|einsätze|einsaetze|start|beginn|appointment|rendez[-\s]?vous|intervention|appuntamento)\b/i;

const SERVICE_NOISE_PATTERN =
  /\b(?:chf|fr\.?|eur|mwst|netto|total|pauschal|stück|stueck|stk\.?|m²|m2|qm|quadratmeter|meter|kg|sack|liter|boden|fenster|teppich|treppenhaus|reinig|entsorgung|anfahrt|parkgebühr|parkgebuehr|material|gerät|geraet|maschine|service|leistung|position)\b/i;

const DATE_PATTERN = /\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\.?\b(?!\s*(?:uhr|h)\b)/i;

const CLOCK_TIME_PATTERN = /\b([01]?\d|2[0-3])\s*:\s*([0-5]\d)\b/g;
const DOT_TIME_PATTERN = /\b([01]?\d|2[0-3])\s*[.]\s*([0-5]\d)\s*(?:uhr|h)\b/gi;
const UHR_TIME_PATTERN = /\b([01]?\d|2[0-3])\s*(?:uhr|h)\b/gi;

const normalizeTime = (hour: string, minute = "00"): string =>
  `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

const maskTextRange = (value: string, start: number, end: number): string =>
  `${value.slice(0, start)}${" ".repeat(Math.max(0, end - start))}${value.slice(end)}`;

const extractTimes = (line: string): string[] => {
  let candidate = line.replace(
    /\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\.?\b(?!\s*(?:uhr|h)\b)/gi,
    " ",
  );
  const found: string[] = [];
  const add = (value: string) => {
    if (!found.includes(value)) found.push(value);
  };

  const maskAndAdd = (pattern: RegExp, minuteFromMatch: boolean) => {
    const matches = Array.from(candidate.matchAll(pattern));
    for (const match of matches) {
      add(normalizeTime(match[1], minuteFromMatch ? match[2] : "00"));
    }
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index];
      const start = match.index ?? -1;
      if (start < 0) continue;
      candidate = maskTextRange(candidate, start, start + match[0].length);
    }
  };

  // Reihenfolge ist wichtig: vollständige Uhrzeiten zuerst erkennen und maskieren.
  // Sonst wird bei "09:00 Uhr" der Minuten-Teil "00 Uhr" fälschlich als
  // zusätzlicher Termin "00:00 Uhr" gelesen.
  maskAndAdd(CLOCK_TIME_PATTERN, true);
  maskAndAdd(DOT_TIME_PATTERN, true);
  maskAndAdd(UHR_TIME_PATTERN, false);

  return found;
};

const extractDateLabel = (line: string): { label: string; key: string } => {
  const dateMatch = line.match(DATE_PATTERN);
  if (!dateMatch) return { label: "", key: "" };

  const day = dateMatch[1].padStart(2, "0");
  const month = dateMatch[2].padStart(2, "0");
  const rawYear = dateMatch[3] || "";
  const year = rawYear
    ? rawYear.length === 2
      ? `20${rawYear}`
      : rawYear
    : "";
  return {
    label: year ? `${day}.${month}.${year}` : `${day}.${month}.`,
    key: `${year || "0000"}-${month}-${day}`,
  };
};

const titleCaseRelativeDay = (value: string): string => {
  const clean = compact(value);
  if (!clean) return "";
  return clean.charAt(0).toLowerCase() + clean.slice(1);
};

const extractRelativeDayLabel = (line: string): { label: string; key: string } => {
  const weekdayMatch = line.match(
    /\b((?:nächsten?|naechsten?|kommenden?|diesen?)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i,
  );
  if (weekdayMatch) {
    const label = titleCaseRelativeDay(
      `${weekdayMatch[1] || ""}${weekdayMatch[2]}`,
    );
    return { label, key: normalize(label) };
  }
  const relativeMatch = line.match(/\b(heute|morgen|übermorgen|uebermorgen)\b/i);
  if (relativeMatch) {
    const label = titleCaseRelativeDay(relativeMatch[1]);
    return { label, key: normalize(label) };
  }
  return { label: "", key: "" };
};

const isTimeRangeLine = (line: string, times: string[]) => {
  if (times.length !== 2) return false;
  const escapedA = times[0].replace(":", "\\s*[:.]\\s*");
  const escapedB = times[1].replace(":", "\\s*[:.]\\s*");
  return new RegExp(`${escapedA}\\s*(?:-|–|—|bis|to)\\s*${escapedB}`, "i").test(
    line,
  );
};

const isServiceNoiseLine = (line: string) => {
  const normalized = normalize(line);
  const hasAppointmentContext = APPOINTMENT_CONTEXT_PATTERN.test(line);
  if (hasAppointmentContext) return false;
  return SERVICE_NOISE_PATTERN.test(line) || /\b\d+(?:[.,]\d+)?\s*(?:x|×|à|a)\s*(?:chf|fr\.?|eur)?\s*\d+/i.test(line) || normalized.includes("bitte boden");
};

const splitAppointmentCandidates = (value: unknown): string[] => {
  const source = compact(value);
  if (!source) return [];
  const rawLines = source
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => compact(line).replace(/^\[(?:HINWEIS|NOTE)\]\s*/i, ""))
    .filter(Boolean);

  const result: string[] = [];
  let inAppointmentBlock = false;

  for (const line of rawLines) {
    const isHeader = /^\s*(?:termin|termine|einsatz|einsätze|einsaetze|zeitfenster)\s*:?.*$/i.test(line);
    if (isHeader && !DATE_PATTERN.test(line) && extractTimes(line).length === 0) {
      inAppointmentBlock = true;
      continue;
    }

    const hasDate = DATE_PATTERN.test(line);
    const times = extractTimes(line);
    const hasRelativeDay = Boolean(extractRelativeDayLabel(line).label);
    const hasAppointmentContext = APPOINTMENT_CONTEXT_PATTERN.test(line);
    const hasUsableTime = times.length > 0;

    if (!(hasAppointmentContext || inAppointmentBlock)) {
      continue;
    }
    if (!(hasDate || hasRelativeDay || hasUsableTime)) {
      continue;
    }
    if (isServiceNoiseLine(line)) {
      continue;
    }

    result.push(line);

    if (inAppointmentBlock && !line.endsWith(",") && !line.endsWith(";")) {
      // Keep the block open for simple lists, but it will still require date/time.
      inAppointmentBlock = true;
    }
  }

  return result;
};

const parseAppointmentLine = (value: unknown): ParsedAppointment[] => {
  const line = compact(value);
  if (!line) return [];

  const date = extractDateLabel(line);
  const relative = date.label ? { label: "", key: "" } : extractRelativeDayLabel(line);
  const dayLabel = date.label || relative.label;
  const dayKey = date.key || relative.key;
  const times = extractTimes(line);

  if (!dayLabel && times.length === 0) return [];

  if (times.length === 0) {
    return [
      {
        label: dayLabel,
        dateKey: dayKey,
        timeKey: "",
        source: line,
      },
    ];
  }

  if (isTimeRangeLine(line, times)) {
    const label = [dayLabel, `${times[0]}–${times[1]} Uhr`]
      .filter(Boolean)
      .join(" · ");
    return [
      {
        label,
        dateKey: dayKey,
        timeKey: `${times[0]}-${times[1]}`,
        source: line,
      },
    ];
  }

  return times.map((time) => ({
    label: [dayLabel, `${time} Uhr`].filter(Boolean).join(" · "),
    dateKey: dayKey,
    timeKey: time,
    source: line,
  }));
};

const parseExplicitDateField = (value: unknown): ParsedAppointment[] => {
  const raw = compact(value);
  if (!raw) return [];

  // Only accept explicit date fields with an actual time. A date-only field is
  // often the document/order creation date and must not become a false appointment.
  const hasIsoTime = /T\d{2}:\d{2}|\s\d{1,2}:\d{2}/.test(raw);
  if (!hasIsoTime) return [];

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return [];
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  const time = date.toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const cleanTime = time.replace(".", ":");
  return [
    {
      label: `${day}.${month}.${year} · ${cleanTime} Uhr`,
      dateKey: `${year}-${month}-${day}`,
      timeKey: cleanTime,
      source: raw,
    },
  ];
};

const betterEntry = (
  existing: MergedAppointmentEntry,
  incoming: MergedAppointmentEntry,
): MergedAppointmentEntry => {
  const existingSource = compact(existing.source);
  const incomingSource = compact(incoming.source);
  if (SERVICE_NOISE_PATTERN.test(existingSource) && !SERVICE_NOISE_PATTERN.test(incomingSource)) {
    return incoming;
  }
  if (incomingSource.length > existingSource.length && incomingSource.length <= 160) {
    return incoming;
  }
  return existing;
};

type AppointmentLabelParts = {
  label: string;
  dateKey: string;
  shortDateKey: string;
  timeKey: string;
  hasFullDate: boolean;
  hasShortDate: boolean;
  hasDate: boolean;
  hasTime: boolean;
  hasRelativeDay: boolean;
  isDateOnly: boolean;
  isTimeOnly: boolean;
};

const cleanAppointmentLabel = (value: unknown): string =>
  compact(value)
    .replace(/^\s*(?:termin|termine|start|sort|source|quelle)\s*:?\s*/i, "")
    .replace(/\s+[—–-]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const parseAppointmentLabelParts = (value: unknown): AppointmentLabelParts => {
  let label = cleanAppointmentLabel(value);

  if (
    /\b\d{1,2}:\d{2}\s*uhr\s+\d{1,2}\b/i.test(label) &&
    !/\b\d{1,2}\.\d{1,2}\./.test(label)
  ) {
    label = "";
  }

  if (/\b\d{1,2}\.\d{1,2}\.\d{2,4}\s*·\s*\d{1,2}:\d{2}\s*uhr\s+\d{1,2}\b/i.test(label)) {
    label = label.replace(/(\d{1,2}:\d{2}\s*uhr)\s+\d{1,2}\b/gi, "$1");
  }

  const fullDateMatch = label.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  const shortDateMatch = fullDateMatch
    ? null
    : label.match(/\b(\d{1,2})\.(\d{1,2})\.(?!\d)/);
  const dateMatch = fullDateMatch || shortDateMatch;
  const day = dateMatch ? dateMatch[1].padStart(2, "0") : "";
  const month = dateMatch ? dateMatch[2].padStart(2, "0") : "";
  const rawYear = fullDateMatch ? fullDateMatch[3] : "";
  const year = rawYear
    ? rawYear.length === 2
      ? `20${rawYear}`
      : rawYear
    : "";
  const dateKey = day && month ? `${year || "0000"}-${month}-${day}` : "";
  const shortDateKey = day && month ? `${month}-${day}` : "";
  const timeMatch = label.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const timeKey = timeMatch ? normalizeTime(timeMatch[1], timeMatch[2]) : "";
  const hasRelativeDay = /\b(?:heute|morgen|übermorgen|uebermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i.test(
    label,
  );
  const hasDate = Boolean(dateKey);
  const hasTime = Boolean(timeKey);

  return {
    label,
    dateKey,
    shortDateKey,
    timeKey,
    hasFullDate: Boolean(fullDateMatch),
    hasShortDate: Boolean(shortDateMatch),
    hasDate,
    hasTime,
    hasRelativeDay,
    isDateOnly: hasDate && !hasTime,
    isTimeOnly: hasTime && !hasDate && !hasRelativeDay,
  };
};

const isTechnicalAppointmentNoise = (entry: MergedAppointmentEntry, parts: AppointmentLabelParts): boolean => {
  const label = parts.label;
  const normalizedLabel = normalize(label);
  const normalizedSite = normalize(entry.site);
  const normalizedSource = normalize(entry.source);

  if (!label) return true;
  if (/^\d{1,2}$/.test(label)) return true;
  if (/^(?:start|sort|source|quelle|termin|termine)$/i.test(label)) return true;
  if (/^(?:start|sort|source|quelle)\b/i.test(label)) return true;
  if (parts.isTimeOnly) return true;
  if (!parts.hasDate && !parts.hasRelativeDay && !parts.hasTime) return true;
  if (!parts.hasDate && parts.hasTime && /\b\d{1,2}:\d{2}\s*uhr\s+\d{1,2}\b/i.test(label)) return true;
  if (normalizedSite === "sort" || normalizedSite === "start") return true;
  if (/^(?:sort|start)\b/i.test(compact(entry.site))) return false;
  if (normalizedLabel === "morgen" || normalizedLabel === "heute" || normalizedLabel === "uebermorgen") return true;
  if (
    SERVICE_NOISE_PATTERN.test(label) ||
    (SERVICE_NOISE_PATTERN.test(entry.source) && !APPOINTMENT_CONTEXT_PATTERN.test(entry.source))
  ) {
    return true;
  }
  if (normalizedSource === "start" || normalizedSource === "sort") return true;
  return false;
};

const sanitizeAppointmentEntries = (entries: MergedAppointmentEntry[]): MergedAppointmentEntry[] => {
  const normalizedEntries = entries.map((entry) => {
    const labelParts = parseAppointmentLabelParts(entry.label);
    return {
      entry: {
        site: normalizeSiteDisplay(entry.site),
        label: labelParts.label,
        source: compact(entry.source),
      },
      parts: labelParts,
    };
  });

  const timedFullDateKeys = new Set<string>();
  const timedShortDateKeys = new Set<string>();
  const timedKeys = new Set<string>();

  for (const item of normalizedEntries) {
    if (isTechnicalAppointmentNoise(item.entry, item.parts)) continue;
    if (item.parts.hasDate && item.parts.hasTime) {
      timedFullDateKeys.add(item.parts.dateKey);
      timedShortDateKeys.add(item.parts.shortDateKey);
      timedKeys.add(`${item.parts.shortDateKey}|${item.parts.timeKey}`);
    }
  }

  const result: MergedAppointmentEntry[] = [];
  const seenKeys = new Map<string, number>();

  for (const item of normalizedEntries) {
    if (isTechnicalAppointmentNoise(item.entry, item.parts)) continue;

    if (
      item.parts.isDateOnly &&
      (timedFullDateKeys.has(item.parts.dateKey) || timedShortDateKeys.has(item.parts.shortDateKey))
    ) {
      continue;
    }

    if (
      item.parts.hasRelativeDay &&
      item.parts.hasTime &&
      Array.from(timedKeys).some((key) => key.endsWith(`|${item.parts.timeKey}`))
    ) {
      continue;
    }

    const dedupeKey = [
      normalize(item.entry.site),
      item.parts.shortDateKey || item.parts.dateKey,
      item.parts.timeKey || normalize(item.entry.label),
    ].join("|");

    const existingIndex = seenKeys.get(dedupeKey);
    if (existingIndex !== undefined) {
      const existing = result[existingIndex];
      const existingHasSite = Boolean(normalizeSiteDisplay(existing.site));
      const incomingHasSite = Boolean(normalizeSiteDisplay(item.entry.site));
      if (!existingHasSite && incomingHasSite) {
        result[existingIndex] = item.entry;
      }
      continue;
    }

    seenKeys.set(dedupeKey, result.length);
    result.push(item.entry);
  }

  return result;
};


export function collectMergedAppointmentEntries(
  records: Array<MergedAppointmentRecord | null | undefined> | null | undefined,
): MergedAppointmentEntry[] {
  const result: MergedAppointmentEntry[] = [];

  const add = (entry: MergedAppointmentEntry, parsed: ParsedAppointment) => {
    const labelKey = normalize(entry.label);
    if (!labelKey || entry.label === "Termin klären") return;
    const siteKey = normalize(entry.site);
    const exactKey = [siteKey, parsed.dateKey, parsed.timeKey, labelKey].join("|");
    const looseKey = [parsed.dateKey, parsed.timeKey || labelKey].join("|");

    const existingIndex = result.findIndex((current) => {
      const currentSiteKey = normalize(current.site);
      const currentParsed = parseAppointmentLine(current.source)[0];
      const currentLabelKey = normalize(current.label);
      if (currentParsed) {
        const currentExactKey = [
          currentSiteKey,
          currentParsed.dateKey,
          currentParsed.timeKey,
          currentLabelKey,
        ].join("|");
        const currentLooseKey = [
          currentParsed.dateKey,
          currentParsed.timeKey || currentLabelKey,
        ].join("|");
        return currentExactKey === exactKey || currentLooseKey === looseKey;
      }
      return currentLabelKey === labelKey && currentSiteKey === siteKey;
    });

    if (existingIndex >= 0) {
      result[existingIndex] = betterEntry(result[existingIndex], entry);
      return;
    }
    result.push(entry);
  };

  for (const record of Array.isArray(records) ? records : []) {
    if (!record) continue;
    const rawNotes = compact(record.notes);
    const rawSections = splitMergedSections(rawNotes);
    const isMergedSource = rawSections.length > 1;
    const sourceSections = isMergedSource
      ? rawSections
      : [
          [
            record.specialNotes,
            record.notes,
            record.description,
            record.audioTranscript,
          ]
            .filter(Boolean)
            .join("\n"),
        ].filter(Boolean);

    let recordEntryCount = 0;
    sourceSections.forEach((section, sectionIndex) => {
      const site = resolveSectionSite(record, section, sectionIndex);
      for (const line of splitAppointmentCandidates(section)) {
        const parsedItems = parseAppointmentLine(line);
        for (const parsed of parsedItems) {
          if (!parsed.label) continue;
          add({ site, label: parsed.label, source: parsed.source }, parsed);
          recordEntryCount += 1;
        }
      }
    });

    if (recordEntryCount === 0) {
      for (const parsed of parseExplicitDateField(record.date)) {
        add(
          {
            site: resolveSectionSite(record, "", 0),
            label: parsed.label,
            source: parsed.source,
          },
          parsed,
        );
      }
    }
  }

  return sanitizeAppointmentEntries(result);
}

export function formatMergedAppointmentTooltip(
  entries: MergedAppointmentEntry[],
): string {
  const cleanEntries = sanitizeAppointmentEntries(entries);
  if (cleanEntries.length === 0) return "";
  if (cleanEntries.length === 1) return `Termin\n${cleanEntries[0].label}`;
  return [
    `Termine · ${cleanEntries.length}`,
    ...cleanEntries.map((entry, index) => {
      const site = normalizeSiteDisplay(entry.site);
      return `${index + 1}. ${site ? `${site} — ` : ""}${entry.label}`;
    }),
  ].join("\n");
}

export function formatMergedAppointmentChipLabel(
  entries: MergedAppointmentEntry[],
): string {
  const cleanEntries = sanitizeAppointmentEntries(entries);
  if (cleanEntries.length === 0) return "";
  if (cleanEntries.length > 1) return `${cleanEntries.length} Termine`;
  return cleanEntries[0].label;
}
