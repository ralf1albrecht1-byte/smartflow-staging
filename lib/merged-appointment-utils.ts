// SMARTFLOW_V17_90L371AB_APPOINTMENT_CHIP_GLOBAL_SOURCE_FIX

export type MergedAppointmentRecord = {
  id?: string | null;
  date?: string | null;
  time?: string | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  appointment?: string | null;
  appointmentText?: string | null;
  scheduledAt?: string | null;
  notes?: string | null;
  specialNotes?: string | null;
  description?: string | null;
  audioTranscript?: string | null;
  customerMessage?: string | null;
  originalMessage?: string | null;
  translatedMessage?: string | null;
  message?: string | null;
  rawMessage?: string | null;
  details?: string | null;
  internalNotes?: string | null;
  summary?: string | null;
  siteName?: string | null;
  workSiteName?: string | null;
  worksiteName?: string | null;
  executionAddress?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  orders?: Array<MergedAppointmentRecord | null | undefined> | null;
  mergedOrders?: Array<MergedAppointmentRecord | null | undefined> | null;
  sourceOrders?: Array<MergedAppointmentRecord | null | undefined> | null;
  children?: Array<MergedAppointmentRecord | null | undefined> | null;
  workSites?: Array<MergedAppointmentRecord | null | undefined> | null;
  sites?: Array<MergedAppointmentRecord | null | undefined> | null;
  [key: string]: unknown;
};

export type MergedAppointmentEntry = {
  site: string;
  label: string;
  source: string;
};

type DateToken = {
  label: string;
  key: string;
  index: number;
};

type TimeToken = {
  label: string;
  key: string;
  index: number;
};

const APPOINTMENT_TEXT_FIELD_PATTERN =
  /(?:note|notes|message|transcript|appointment|termin|date|time|scheduled|special|description|details|summary|customer|raw|text|hint)/i;

const MAX_RECURSION_DEPTH = 5;

const compact = (value: unknown): string =>
  String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();

const oneLine = (value: unknown): string => compact(value).replace(/\s+/g, " ").trim();

const normalize = (value: unknown): string =>
  oneLine(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const pad2 = (value: string | number): string => String(value).padStart(2, "0");

const titleCaseRelativeDay = (value: string): string =>
  oneLine(value).replace(/\b\p{L}/gu, (char) => char.toUpperCase());

const isValidDayMonth = (day: number, month: number): boolean =>
  day >= 1 && day <= 31 && month >= 1 && month <= 12;

const isValidTime = (hour: number, minute: number): boolean =>
  hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;

const normalizeYear = (year?: string): string => {
  const raw = String(year ?? "").trim();
  if (!raw) return "";
  if (raw.length === 2) return `20${raw}`;
  return raw;
};

const buildDateLabel = (day: string | number, month: string | number, year?: string): string => {
  const normalizedYear = normalizeYear(year);
  return normalizedYear ? `${pad2(day)}.${pad2(month)}.${normalizedYear}` : `${pad2(day)}.${pad2(month)}.`;
};

const dateKey = (label: string): string => {
  const match = oneLine(label).match(/\b(\d{2})\.(\d{2})\.(\d{4})?\b|\b(\d{2})\.(\d{2})\.\b/);
  if (match) {
    const day = match[1] || match[4];
    const month = match[2] || match[5];
    const year = match[3] || "";
    return `${day}.${month}.${year}`;
  }
  const relative = oneLine(label).match(/^(heute|morgen|übermorgen|uebermorgen|(?:nächsten?|naechsten?|kommenden?|diesen?)?\s*(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))/i);
  return relative ? normalize(relative[1]) : "";
};

const timeKey = (label: string): string => {
  const match = oneLine(label).match(/\b([01]?\d|2[0-3]):([0-5]\d)(?:\s*[–-]\s*([01]?\d|2[0-3]):([0-5]\d))?/);
  if (!match) return "";
  const first = `${pad2(match[1])}:${match[2]}`;
  const second = match[3] && match[4] ? `${pad2(match[3])}:${match[4]}` : "";
  return second ? `${first}-${second}` : first;
};

const hasAppointmentWord = (line: string): boolean =>
  /\b(?:termin|einsatz|ausfuehrung|ausführung|ankunft|kommen|geplant|datum|uhrzeit|appointment|scheduled|intervention|rdv|rendez[- ]?vous|orario|appuntamento)\b/i.test(line);

const hasTimeWord = (line: string): boolean =>
  /\b(?:vormittags?|nachmittags?|abends?|morgens?|mittag|mittags|morning|afternoon|evening|matin|après[- ]?midi|apres[- ]?midi|sera|mattina|pomeriggio)\b/i.test(line);

const splitMergedSections = (value: string): string[] => {
  const raw = compact(value);
  if (!raw) return [];
  const lines = raw.split(/\n+/g).map((line) => line.trim()).filter(Boolean);
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const startsSection = /^(?:[-–—* ]*)?(?:auftrag|ausführungsort|ausfuehrungsort|arbeitsort|standort|objekt)\s*\d*\s*[:#-]/i.test(line);
    if (startsSection && current.length > 0) {
      sections.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) sections.push(current.join("\n"));
  return sections.length > 0 ? sections : [raw];
};

const appointmentLineCandidates = (value: string): string[] => {
  const raw = compact(value);
  if (!raw) return [];

  const candidates = new Set<string>();
  const pieces = raw
    .split(/\n+|;+/g)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=(?:[A-ZÄÖÜ0-9]|Erster|Zweiter|Dritter|Termin|Einsatz))/g))
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of pieces) {
    if (hasAppointmentWord(line) || hasTimeWord(line) || extractDateTokens(line).length > 0 || extractTimeTokens(line).length > 0) {
      candidates.add(line);
    }
  }

  return Array.from(candidates);
};

const extractDateTokens = (value: string): DateToken[] => {
  const line = oneLine(value);
  const tokens: DateToken[] = [];

  for (const match of line.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})(?:[T ]([01]?\d|2[0-3]):([0-5]\d))?\b/g)) {
    const year = match[1];
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidDayMonth(day, month)) continue;
    const label = buildDateLabel(day, month, year);
    tokens.push({ label, key: dateKey(label), index: match.index ?? 0 });
  }

  for (const match of line.matchAll(/(?<!\d)(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?!\d)/g)) {
    const full = match[0];
    const after = line.slice((match.index ?? 0) + full.length);
    if (/^\s*(?:uhr|h)\b/i.test(after)) continue;

    const day = Number(match[1]);
    const month = Number(match[2]);
    if (!isValidDayMonth(day, month)) continue;
    const label = buildDateLabel(day, month, match[3]);
    tokens.push({ label, key: dateKey(label), index: match.index ?? 0 });
  }

  const weekday = line.match(/\b((?:nächsten?|naechsten?|kommenden?|diesen?)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i);
  if (weekday) {
    const label = titleCaseRelativeDay(`${weekday[1] || ""}${weekday[2]}`);
    tokens.push({ label, key: normalize(label), index: weekday.index ?? 0 });
  }

  const relative = line.match(/\b(heute|morgen|übermorgen|uebermorgen)\b/i);
  if (relative) {
    const label = titleCaseRelativeDay(relative[1]);
    tokens.push({ label, key: normalize(label), index: relative.index ?? 0 });
  }

  const seen = new Set<string>();
  return tokens.filter((token) => {
    const key = `${token.key}|${token.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(token.key);
  });
};

const pushTimeToken = (tokens: TimeToken[], hourRaw: string, minuteRaw: string | undefined, index: number) => {
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw || "0");
  if (!isValidTime(hour, minute)) return;
  const key = `${pad2(hour)}:${pad2(minute)}`;
  tokens.push({ label: `${key} Uhr`, key, index });
};

const extractTimeTokens = (value: string): TimeToken[] => {
  const line = oneLine(value);
  const tokens: TimeToken[] = [];

  // 09:00, 9:00, 09h00. This intentionally does not accept dotted values without Uhr.
  for (const match of line.matchAll(/\b([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)\b/gi)) {
    pushTimeToken(tokens, match[1], match[2], match.index ?? 0);
  }

  // 09.00 Uhr. Dotted time is only accepted with explicit Uhr/h, so 29.06.2026 can never become 29:06.
  for (const match of line.matchAll(/\b([01]?\d|2[0-3])\.([0-5]\d)\s*(?:uhr|h)\b/gi)) {
    pushTimeToken(tokens, match[1], match[2], match.index ?? 0);
  }

  // 9 Uhr, 09 Uhr 30.
  for (const match of line.matchAll(/(?<![:.\d])\b([01]?\d|2[0-3])\s*(?:uhr|h)\b(?:\s*([0-5]\d))?/gi)) {
    pushTimeToken(tokens, match[1], match[2], match.index ?? 0);
  }

  // um 9 / um 11: only with explicit appointment wording and never directly before a date separator.
  if (hasAppointmentWord(line)) {
    for (const match of line.matchAll(/\bum\s+([01]?\d|2[0-3])\b(?!\s*[.:]\s*\d)/gi)) {
      pushTimeToken(tokens, match[1], "0", match.index ?? 0);
    }
  }

  const seen = new Set<string>();
  return tokens.filter((token) => {
    const key = `${token.key}|${token.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const nearestDateForTime = (time: TimeToken, dates: DateToken[], fallbackDate: DateToken | null): DateToken | null => {
  if (dates.length === 0) return fallbackDate;
  const before = [...dates].reverse().find((date) => date.index <= time.index);
  return before || dates[0] || fallbackDate;
};

const isRangeLine = (line: string, times: TimeToken[]): boolean => {
  if (times.length !== 2) return false;
  if (/\b(?:von|zwischen|ab)\b.*\b(?:bis|und)\b/i.test(line)) return true;
  if (/\b(?:bis|to)\b/i.test(line)) return true;
  const between = line.slice(times[0].index + times[0].key.length, times[1].index);
  return /[-–—]/.test(between);
};

const parseAppointmentLabels = (value: unknown, fallbackDate: DateToken | null = null): string[] => {
  const line = oneLine(value);
  if (!line) return [];

  const dates = extractDateTokens(line);
  const times = extractTimeTokens(line);
  const hasContext = hasAppointmentWord(line) || hasTimeWord(line) || dates.length > 0 || Boolean(fallbackDate);
  if (!hasContext) return [];

  if (dates.length === 0 && times.length > 0 && !fallbackDate && !hasAppointmentWord(line)) return [];

  const labels: string[] = [];

  if (times.length > 0) {
    if (isRangeLine(line, times)) {
      const date = nearestDateForTime(times[0], dates, fallbackDate);
      labels.push([date?.label || "", `${times[0].key}–${times[1].key} Uhr`].filter(Boolean).join(" · "));
    } else {
      for (const time of times) {
        const date = nearestDateForTime(time, dates, fallbackDate);
        labels.push([date?.label || "", time.label].filter(Boolean).join(" · "));
      }
    }
  } else if (dates.length > 0 && hasAppointmentWord(line)) {
    labels.push(...dates.map((date) => date.label));
  } else if (hasTimeWord(line) && (dates[0] || fallbackDate)) {
    const date = dates[0] || fallbackDate;
    let timeWord = "";
    if (/\bvormittags?\b/i.test(line)) timeWord = "vormittags";
    else if (/\bnachmittags?\b/i.test(line)) timeWord = "nachmittags";
    else if (/\babends?\b/i.test(line)) timeWord = "abends";
    else if (/\bmorgens?\b/i.test(line)) timeWord = "morgens";
    if (timeWord) labels.push([date?.label || "", timeWord].filter(Boolean).join(" · "));
  }

  if (labels.length === 0 && /\b(?:klären|klaeren|offen|absprechen|vereinbaren)\b/i.test(line) && hasAppointmentWord(line)) {
    labels.push("Termin klären");
  }

  return labels
    .map(oneLine)
    .filter(Boolean)
    .filter((label, index, list) => list.indexOf(label) === index);
};

const parseDirectDateToken = (value: unknown): DateToken | null => {
  const raw = oneLine(value);
  if (!raw) return null;
  const labels = parseAppointmentLabels(`Termin ${raw}`);
  const dateOnly = labels.find((label) => dateKey(label));
  if (!dateOnly) return null;
  return { label: dateOnly, key: dateKey(dateOnly), index: 0 };
};

const structuredDateTimeLabels = (record: MergedAppointmentRecord): string[] => {
  const dateCandidates = [record.date, record.appointmentDate, record.scheduledAt].map(parseDirectDateToken).filter(Boolean) as DateToken[];
  const fallbackDate = dateCandidates[0] || null;
  const timeTexts = [record.time, record.appointmentTime, record.appointment, record.appointmentText]
    .map(oneLine)
    .filter(Boolean);
  const labels: string[] = [];

  for (const text of timeTexts) {
    labels.push(...parseAppointmentLabels(text, fallbackDate));
  }

  for (const date of dateCandidates) labels.push(date.label);

  return labels.filter((label, index, list) => list.indexOf(label) === index);
};

const collectTextFields = (value: unknown, depth = 0, keyHint = ""): string[] => {
  if (depth > MAX_RECURSION_DEPTH || value == null) return [];
  if (typeof value === "string" || typeof value === "number") {
    const text = oneLine(value);
    return text && (APPOINTMENT_TEXT_FIELD_PATTERN.test(keyHint) || hasAppointmentWord(text) || extractDateTokens(text).length > 0 || extractTimeTokens(text).length > 0)
      ? [text]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFields(item, depth + 1, keyHint));
  }
  if (typeof value !== "object") return [];

  const out: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(items|services|serviceItems|positions|lineItems)$/i.test(key)) continue;
    if (typeof child === "string" || typeof child === "number") {
      out.push(...collectTextFields(child, depth + 1, key));
    } else if (APPOINTMENT_TEXT_FIELD_PATTERN.test(key) || /^(parsedNotes|intake|canonical|appointment|appointments|schedule|scheduling)$/i.test(key)) {
      out.push(...collectTextFields(child, depth + 1, key));
    }
  }
  return out;
};

const siteLabel = (record: MergedAppointmentRecord, section: string, sectionIndex: number): string => {
  const fromRecord =
    oneLine(record.siteName) ||
    oneLine(record.workSiteName) ||
    oneLine(record.worksiteName) ||
    oneLine(record.siteAddress) ||
    oneLine(record.executionAddress);
  const fromSection = oneLine(
    section.match(/(?:auftrag|ausführungsort|ausfuehrungsort|arbeitsort|standort|objekt)\s*\d*\s*[:#-]\s*([^\n]+)/i)?.[1] || "",
  );
  return fromSection || fromRecord || (sectionIndex > 0 ? `Auftrag ${sectionIndex + 1}` : "");
};

const hasSpecificTime = (label: string): boolean =>
  /\b([01]?\d|2[0-3]):([0-5]\d)(?:\s*[–-]\s*([01]?\d|2[0-3]):([0-5]\d))?\s*Uhr\b/i.test(label) ||
  /\b(?:vormittags?|nachmittags?|abends?|morgens?)\b/i.test(label);

const isDateOnlyEntry = (entry: MergedAppointmentEntry): boolean => {
  const key = dateKey(entry.label);
  return Boolean(key) && !hasSpecificTime(entry.label);
};

const sortAppointments = (entries: MergedAppointmentEntry[]): MergedAppointmentEntry[] => {
  return [...entries].sort((left, right) => {
    const dateDiff = dateKey(left.label).localeCompare(dateKey(right.label), "de-CH");
    if (dateDiff !== 0) return dateDiff;
    const timeDiff = timeKey(left.label).localeCompare(timeKey(right.label), "de-CH");
    if (timeDiff !== 0) return timeDiff;
    return normalize(left.site).localeCompare(normalize(right.site), "de-CH");
  });
};

const dedupeAndPreferPreciseAppointments = (entries: MergedAppointmentEntry[]): MergedAppointmentEntry[] => {
  const map = new Map<string, MergedAppointmentEntry>();
  for (const raw of entries) {
    const entry = {
      site: oneLine(raw.site),
      label: oneLine(raw.label),
      source: oneLine(raw.source),
    };
    if (!entry.label || entry.label === "Termin klären") continue;
    if (/\b(?:2[4-9]|[3-9]\d):[0-5]\d\b/.test(entry.label)) continue;
    const key = `${normalize(entry.site)}|${dateKey(entry.label)}|${timeKey(entry.label)}|${normalize(entry.label)}`;
    const previous = map.get(key);
    if (!previous || entry.source.length > previous.source.length) map.set(key, entry);
  }

  const values = Array.from(map.values());
  const preciseDateKeys = new Set(values.filter((entry) => hasSpecificTime(entry.label)).map((entry) => dateKey(entry.label)).filter(Boolean));
  const filtered = values.filter((entry) => {
    if (!isDateOnlyEntry(entry)) return true;
    const key = dateKey(entry.label);
    return !key || !preciseDateKeys.has(key);
  });

  return sortAppointments(filtered);
};

export function collectMergedAppointmentEntries(
  records: Array<MergedAppointmentRecord | null | undefined> | null | undefined,
): MergedAppointmentEntry[] {
  const collected: MergedAppointmentEntry[] = [];

  const add = (entry: MergedAppointmentEntry) => {
    if (!entry.label || entry.label === "Termin klären") return;
    collected.push(entry);
  };

  for (const record of Array.isArray(records) ? records : []) {
    if (!record) continue;

    const nested = [record.orders, record.mergedOrders, record.sourceOrders, record.children, record.workSites, record.sites]
      .filter(Array.isArray)
      .flat() as Array<MergedAppointmentRecord | null | undefined>;
    if (nested.length > 0) {
      collectMergedAppointmentEntries(nested).forEach(add);
    }

    const fallbackDate = parseDirectDateToken(record.date || record.appointmentDate || record.scheduledAt);
    const knownText = [
      record.specialNotes,
      record.notes,
      record.description,
      record.audioTranscript,
      record.customerMessage,
      record.originalMessage,
      record.translatedMessage,
      record.message,
      record.rawMessage,
      record.details,
      record.internalNotes,
      record.summary,
      record.appointment,
      record.appointmentText,
    ]
      .filter(Boolean)
      .map(compact)
      .filter(Boolean)
      .join("\n");
    const discoveredText = collectTextFields(record).join("\n");
    const sourceText = [knownText, discoveredText].filter(Boolean).join("\n");
    const sections = splitMergedSections(sourceText);

    sections.forEach((section, sectionIndex) => {
      const site = siteLabel(record, section, sectionIndex);
      for (const line of appointmentLineCandidates(section)) {
        for (const label of parseAppointmentLabels(line, fallbackDate)) {
          add({ site, label, source: line });
        }
      }
    });

    for (const label of structuredDateTimeLabels(record)) {
      add({
        site: siteLabel(record, "", 0),
        label,
        source: [record.date, record.time, record.appointmentDate, record.appointmentTime, record.appointment, record.appointmentText, record.scheduledAt]
          .map(oneLine)
          .filter(Boolean)
          .join(" "),
      });
    }
  }

  return dedupeAndPreferPreciseAppointments(collected);
}

const formatShortSingleLabel = (label: string): string => {
  const text = oneLine(label);
  const datedTime = text.match(/\b(\d{2}\.\d{2})\.(?:\d{4})?\s*·\s*([01]?\d|2[0-3]):([0-5]\d)\s*Uhr\b/i);
  if (datedTime) return `${datedTime[1]}. · ${pad2(datedTime[2])}:${datedTime[3]}`;
  const dateOnly = text.match(/\b(\d{2}\.\d{2})\.(?:\d{4})?\b/);
  if (dateOnly && !hasSpecificTime(text)) return `${dateOnly[1]}.`;
  return text.replace(/\s*Uhr\b/i, "");
};

export function formatMergedAppointmentChipLabel(entries: MergedAppointmentEntry[]): string {
  const clean = dedupeAndPreferPreciseAppointments(entries);
  if (clean.length === 0) return "";
  if (clean.length === 1) return formatShortSingleLabel(clean[0].label);
  return `${clean.length} Termine`;
}

export function formatMergedAppointmentTooltip(entries: MergedAppointmentEntry[]): string {
  const clean = dedupeAndPreferPreciseAppointments(entries);
  if (clean.length === 0) return "";
  if (clean.length === 1) return `Termin: ${clean[0].label}`;
  return [
    `Termine · ${clean.length}`,
    ...clean.map((entry, index) => {
      const prefix = entry.site ? `${index + 1}. ${entry.site} — ` : `${index + 1}. `;
      return `${prefix}${entry.label}`;
    }),
  ].join("\n");
}
