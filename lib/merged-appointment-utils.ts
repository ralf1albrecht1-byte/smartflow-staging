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
    .replace(/^\s*(?:sort|ort)\s*:\s*/i, "")
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
    /^(?:ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsort|einsatzort|objekt|baustelle|ausführung|ausfuehrung)\s*:?\s*(.*)$/i;
  const addressLike =
    /\b(?:strasse|straße|weg|gasse|platz|allee|ring|rue|route|via|street|road)\b.*\d|\b\d{4,5}\b/i;
  const stop =
    /^(?:termin|leistung|leistungen|rechnung|rechnungsadresse|kontakt|telefon|sms|whatsapp|e-?mail)\b/i;

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

const appointmentLineCandidates = (value: unknown): string[] => {
  const source = compact(value);
  if (!source) return [];
  return source
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => compact(line).replace(/^\[(?:HINWEIS|NOTE)\]\s*/i, ""))
    .filter(Boolean)
    .filter((line) =>
      /\b(?:termin|ausführungstermin|ausfuehrungstermin|zeitfenster|appointment)\b/i.test(
        line,
      ),
    );
};

const titleCaseRelativeDay = (value: string): string => {
  const clean = compact(value);
  if (!clean) return "";
  return clean.charAt(0).toLowerCase() + clean.slice(1);
};

const parseAppointmentLine = (value: unknown): string => {
  const line = compact(value);
  if (!line) return "";

  const dateMatch = line.match(
    /\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\.?\b/,
  );
  const withoutDate = dateMatch ? line.replace(dateMatch[0], " ") : line;
  const colonTimeMatches = Array.from(
    withoutDate.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g),
  ).map((match) => `${match[1].padStart(2, "0")}:${match[2]}`);
  const hourOnlyMatches = colonTimeMatches.length > 0
    ? []
    : Array.from(withoutDate.matchAll(/\b([01]?\d|2[0-3])\s*uhr\b/gi)).map(
        (match) => `${match[1].padStart(2, "0")}:00`,
      );
  const times = [...colonTimeMatches, ...hourOnlyMatches].filter(
    (time, index, all) => all.indexOf(time) === index,
  );

  const weekdayMatch = line.match(
    /\b((?:nächsten?|naechsten?|kommenden?|diesen?)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i,
  );
  const relativeMatch = line.match(/\b(heute|morgen|übermorgen|uebermorgen)\b/i);

  let dayLabel = "";
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, "0");
    const month = dateMatch[2].padStart(2, "0");
    const rawYear = dateMatch[3] || "";
    const year = rawYear
      ? rawYear.length === 2
        ? `20${rawYear}`
        : rawYear
      : "";
    dayLabel = year ? `${day}.${month}.${year}` : `${day}.${month}.`;
  } else if (weekdayMatch) {
    dayLabel = titleCaseRelativeDay(
      `${weekdayMatch[1] || ""}${weekdayMatch[2]}`,
    );
  } else if (relativeMatch) {
    dayLabel = titleCaseRelativeDay(relativeMatch[1]);
  }

  const timeLabel =
    times.length >= 2
      ? `${times[0]}–${times[1]} Uhr`
      : times[0]
        ? `${times[0]} Uhr`
        : "";

  if (!dayLabel && !timeLabel) {
    return /\b(?:klären|klaeren|offen|absprechen|vereinbaren)\b/i.test(line)
      ? "Termin klären"
      : "";
  }
  return [dayLabel, timeLabel].filter(Boolean).join(" · ");
};

const parseDirectDate = (value: unknown): string => {
  const raw = compact(value);
  if (!raw) return "";
  const parsedLine = parseAppointmentLine(`Termin ${raw}`);
  if (parsedLine) return parsedLine;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hasTime = /T\d{2}:\d{2}|\s\d{1,2}:\d{2}/.test(raw);
  const time = hasTime
    ? date.toLocaleTimeString("de-CH", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  return `${day}.${month}.${year}${time ? ` · ${time} Uhr` : ""}`;
};

const appointmentDayKey = (label: unknown): string => {
  const text = compact(label);
  const match = text.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\.?\b/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}.${match[2].padStart(2, "0")}`;
};

const appointmentTimeKey = (label: unknown): string => {
  const text = compact(label);
  const range = text.match(
    /\b([01]?\d|2[0-3]):([0-5]\d)\s*[–-]\s*([01]?\d|2[0-3]):([0-5]\d)\b/,
  );
  if (range) {
    return `${range[1].padStart(2, "0")}:${range[2]}-${range[3].padStart(2, "0")}:${range[4]}`;
  }
  const time = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (time) return `${time[1].padStart(2, "0")}:${time[2]}`;
  const hourOnly = text.match(/\b([01]?\d|2[0-3])\s*uhr\b/i);
  if (hourOnly) return `${hourOnly[1].padStart(2, "0")}:00`;
  return "";
};

const appointmentLabelScore = (entry: MergedAppointmentEntry): number => {
  const label = compact(entry.label);
  let score = 0;
  if (appointmentTimeKey(label)) score += 100;
  if (/\b\d{1,2}\.\d{1,2}\.\d{2,4}\.?\b/.test(label)) score += 20;
  if (!/^arbeitsort\s+\d+$/i.test(compact(entry.site))) score += 5;
  score += Math.min(compact(entry.source).length, 80) / 100;
  return score;
};

const shouldPreferAppointmentEntry = (incoming: MergedAppointmentEntry, existing: MergedAppointmentEntry): boolean =>
  appointmentLabelScore(incoming) > appointmentLabelScore(existing);


export function collectMergedAppointmentEntries(
  records: Array<MergedAppointmentRecord | null | undefined> | null | undefined,
): MergedAppointmentEntry[] {
  const result: MergedAppointmentEntry[] = [];

  const add = (entry: MergedAppointmentEntry) => {
    const labelKey = normalize(entry.label);
    if (!labelKey || entry.label === "Termin klären") return;
    const siteKey = normalize(entry.site);
    const dayKey = appointmentDayKey(entry.label);
    const timeKey = appointmentTimeKey(entry.label);

    const sameSiteSameDayIndex = result.findIndex((current) => {
      const currentDayKey = appointmentDayKey(current.label);
      return (
        Boolean(dayKey && currentDayKey) &&
        currentDayKey === dayKey &&
        normalize(current.site) === siteKey
      );
    });

    if (sameSiteSameDayIndex >= 0) {
      const existing = result[sameSiteSameDayIndex];
      const existingTimeKey = appointmentTimeKey(existing.label);

      if (existingTimeKey && !timeKey) return;
      if (!existingTimeKey && timeKey) {
        result[sameSiteSameDayIndex] = entry;
        return;
      }
      if (existingTimeKey === timeKey) {
        if (shouldPreferAppointmentEntry(entry, existing)) {
          result[sameSiteSameDayIndex] = entry;
        }
        return;
      }
    }

    const existingIndex = result.findIndex(
      (current) =>
        normalize(current.label) === labelKey &&
        normalize(current.site) === siteKey,
    );
    if (existingIndex >= 0) {
      if (shouldPreferAppointmentEntry(entry, result[existingIndex])) {
        result[existingIndex] = entry;
      }
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
      for (const line of appointmentLineCandidates(section)) {
        const label = parseAppointmentLine(line);
        if (!label) continue;
        add({ site, label, source: line });
        recordEntryCount += 1;
      }
    });

    if (recordEntryCount === 0) {
      const label = parseDirectDate(record.date);
      if (label) {
        add({
          site: resolveSectionSite(record, "", 0),
          label,
          source: compact(record.date),
        });
      }
    }
  }

  return result;
}

export function formatMergedAppointmentTooltip(
  entries: MergedAppointmentEntry[],
): string {
  if (entries.length === 0) return "";
  if (entries.length === 1) return `Termin ${entries[0].label}`;
  return [
    `Termine · ${entries.length}`,
    ...entries.map(
      (entry, index) => `${index + 1}. ${entry.site} — ${entry.label}`,
    ),
  ].join("\n");
}

export function formatMergedAppointmentChipLabel(
  entries: MergedAppointmentEntry[],
): string {
  if (entries.length === 0) return "";
  if (entries.length > 1) return `Termine · ${entries.length}`;
  return `Termin ${entries[0].label}`;
}
