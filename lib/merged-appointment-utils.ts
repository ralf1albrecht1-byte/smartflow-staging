// SMARTFLOW_V17_90L371Y_APPOINTMENT_CHIP_SINGLE_SOURCE

export type MergedAppointmentRecord = {
  id?: string | null;
  date?: string | null;
  notes?: string | null;
  specialNotes?: string | null;
  description?: string | null;
  audioTranscript?: string | null;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  orders?: Array<MergedAppointmentRecord | null | undefined> | null;
  mergedOrders?: Array<MergedAppointmentRecord | null | undefined> | null;
  sourceOrders?: Array<MergedAppointmentRecord | null | undefined> | null;
  children?: Array<MergedAppointmentRecord | null | undefined> | null;
  [key: string]: unknown;
};

export type MergedAppointmentEntry = {
  site: string;
  label: string;
  source: string;
};

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

const timeLabel = (hour: string, minute: string): string => `${pad2(hour)}:${pad2(minute)}`;

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
    .split(/\n+|(?<=\.)\s+(?=[A-ZÄÖÜ0-9])|;+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of pieces) {
    if (hasAppointmentWord(line) || hasTimeWord(line) || /\b\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\b/.test(line)) {
      candidates.add(line);
    }
  }

  if (hasAppointmentWord(raw) || /\b\d{1,2}[:.]\d{2}\b/.test(raw)) {
    candidates.add(raw);
  }

  return Array.from(candidates);
};

const parseAppointmentLine = (value: unknown): string => {
  const line = oneLine(value);
  if (!line) return "";

  const isoDateMatch = line.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const dottedDateMatch = line.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/);
  const weekdayMatch = line.match(/\b((?:nächsten?|naechsten?|kommenden?|diesen?)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i);
  const relativeMatch = line.match(/\b(heute|morgen|übermorgen|uebermorgen)\b/i);

  let day = "";
  if (isoDateMatch) {
    day = `${isoDateMatch[3]}.${isoDateMatch[2]}.${isoDateMatch[1]}`;
  } else if (dottedDateMatch) {
    const rawYear = dottedDateMatch[3] || "";
    const year = rawYear ? (rawYear.length === 2 ? `20${rawYear}` : rawYear) : "";
    day = `${pad2(dottedDateMatch[1])}.${pad2(dottedDateMatch[2])}.${year}`.replace(/\.$/, ".");
  } else if (weekdayMatch) {
    day = titleCaseRelativeDay(`${weekdayMatch[1] || ""}${weekdayMatch[2]}`);
  } else if (relativeMatch) {
    day = titleCaseRelativeDay(relativeMatch[1]);
  }

  const times = Array.from(line.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g))
    .map((match) => timeLabel(match[1], match[2]))
    .filter((item, index, list) => list.indexOf(item) === index);

  let time = "";
  if (times.length >= 2 && /\b(?:bis|[-–—]|to|à|a)\b/i.test(line)) {
    time = `${times[0]}–${times[1]} Uhr`;
  } else if (times[0]) {
    time = `${times[0]} Uhr`;
  } else if (/\bvormittags?\b/i.test(line)) {
    time = "vormittags";
  } else if (/\bnachmittags?\b/i.test(line)) {
    time = "nachmittags";
  } else if (/\babends?\b/i.test(line)) {
    time = "abends";
  } else if (/\bmorgens?\b/i.test(line)) {
    time = "morgens";
  }

  if (!day && !time) {
    return /\b(?:klären|klaeren|offen|absprechen|vereinbaren)\b/i.test(line) && hasAppointmentWord(line)
      ? "Termin klären"
      : "";
  }

  if (!day && time && !hasAppointmentWord(line)) return "";
  return [day, time].filter(Boolean).join(" · ");
};

const parseDirectDate = (value: unknown): string => {
  const raw = oneLine(value);
  if (!raw) return "";

  const direct = parseAppointmentLine(`Termin ${raw}`);
  if (direct) return direct;

  const match = raw.match(/^(20\d{2})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!match) return "";
  const date = `${match[3]}.${match[2]}.${match[1]}`;
  const time = match[4] && match[5] ? `${match[4]}:${match[5]} Uhr` : "";
  return [date, time].filter(Boolean).join(" · ");
};

const dateKeyFromLabel = (label: string): string => {
  const line = oneLine(label);
  const date = line.match(/\b(\d{2}\.\d{2}\.(?:\d{4})?|\d{2}\.\d{2}\.)\b/);
  if (date) return normalize(date[1].replace(/\.$/, ""));
  const relative = line.match(/^(heute|morgen|übermorgen|uebermorgen|(?:nächsten?|naechsten?|kommenden?|diesen?)?\s*(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))/i);
  return relative ? normalize(relative[1]) : "";
};

const hasSpecificTime = (label: string): boolean =>
  /\b\d{1,2}:\d{2}(?:[–-]\d{1,2}:\d{2})?\s*Uhr\b/i.test(label) ||
  /\b(?:vormittags?|nachmittags?|abends?|morgens?)\b/i.test(label);

const isDateOnlyEntry = (entry: MergedAppointmentEntry): boolean => {
  const key = dateKeyFromLabel(entry.label);
  return Boolean(key) && !hasSpecificTime(entry.label);
};

const siteLabel = (record: MergedAppointmentRecord, section: string, sectionIndex: number): string => {
  const fromRecord = oneLine(record.siteName) || oneLine(record.siteAddress);
  const fromSection = oneLine(
    section.match(/(?:auftrag|ausführungsort|ausfuehrungsort|arbeitsort|standort|objekt)\s*\d*\s*[:#-]\s*([^\n]+)/i)?.[1] || "",
  );
  return fromSection || fromRecord || (sectionIndex > 0 ? `Auftrag ${sectionIndex + 1}` : "");
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
    const key = `${normalize(entry.site)}|${normalize(entry.label)}`;
    const previous = map.get(key);
    if (!previous || entry.source.length > previous.source.length) map.set(key, entry);
  }

  const values = Array.from(map.values());
  return values.filter((entry) => {
    if (!isDateOnlyEntry(entry)) return true;
    const entryDateKey = dateKeyFromLabel(entry.label);
    const entrySiteKey = normalize(entry.site);
    return !values.some((other) => {
      if (other === entry) return false;
      return (
        normalize(other.site) === entrySiteKey &&
        dateKeyFromLabel(other.label) === entryDateKey &&
        hasSpecificTime(other.label)
      );
    });
  });
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

    const nested = [record.orders, record.mergedOrders, record.sourceOrders, record.children]
      .filter(Array.isArray)
      .flat() as Array<MergedAppointmentRecord | null | undefined>;
    if (nested.length > 0) {
      collectMergedAppointmentEntries(nested).forEach(add);
    }

    const rawNotes = compact(record.notes);
    const sourceText = [record.specialNotes, record.notes, record.description, record.audioTranscript]
      .filter(Boolean)
      .map(compact)
      .filter(Boolean)
      .join("\n");
    const sections = splitMergedSections(rawNotes || sourceText);

    let textAppointmentCount = 0;
    sections.forEach((section, sectionIndex) => {
      const site = siteLabel(record, section, sectionIndex);
      for (const line of appointmentLineCandidates(section)) {
        const label = parseAppointmentLine(line);
        if (!label) continue;
        add({ site, label, source: line });
        textAppointmentCount += 1;
      }
    });

    if (textAppointmentCount === 0) {
      const label = parseDirectDate(record.date);
      if (label) {
        add({
          site: siteLabel(record, "", 0),
          label,
          source: oneLine(record.date),
        });
      }
    }
  }

  return dedupeAndPreferPreciseAppointments(collected);
}

export function formatMergedAppointmentChipLabel(entries: MergedAppointmentEntry[]): string {
  const clean = dedupeAndPreferPreciseAppointments(entries);
  if (clean.length === 0) return "";
  if (clean.length === 1) return `Termin ${clean[0].label}`;
  return `${clean.length} Termine`;
}

export function formatMergedAppointmentTooltip(entries: MergedAppointmentEntry[]): string {
  const clean = dedupeAndPreferPreciseAppointments(entries);
  if (clean.length === 0) return "";
  if (clean.length === 1) return `Termin: ${clean[0].label}`;
  return [
    `Termine · ${clean.length}`,
    ...clean.map((entry, index) => {
      const prefix = entry.site ? entry.site : `Termin ${index + 1}`;
      return `${prefix}: ${entry.label}`;
    }),
  ].join("\n");
}
