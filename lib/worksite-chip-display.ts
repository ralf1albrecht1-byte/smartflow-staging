// SMARTFLOW_V17_90L380_WORKSITE_ROLE_SAFE_CONTEXT_DISPLAY_ONLY
// SMARTFLOW_V17_90L376_WORKSITE_CHIP_DISPLAY_ONLY
// Pure display helpers. No order, offer, invoice, work-site or item data is mutated.

export type WorksiteAccessChipKindV17_90L376 = "key" | "door";

export type WorksiteDisplayGroupV17_90L376 = {
  siteLabel: string | null;
  lines: string[];
};

export type WorksiteAccessChipDisplayV17_90L376 = {
  kind: WorksiteAccessChipKindV17_90L376;
  worksiteCount: number;
  groups: WorksiteDisplayGroupV17_90L376[];
  tooltip: string;
};

const compactWorksiteDisplayTextV17_90L376 = (value: unknown): string =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\s*[-•*]+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeWorksiteDisplayKeyV17_90L376 = (value: unknown): string =>
  compactWorksiteDisplayTextV17_90L376(value)
    .toLocaleLowerCase("de-CH")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// V17.90L380: Satzbedeutung hat Vorrang vor einzelnen Wörtern. Ein Tor in
// einem Freihalte-/Parkhinweis ist Logistik und kein Zugang; ein mitzubringendes
// Verlängerungskabel ist Vorbereitung und keine Stromgefahr. Die Helfer sind
// reine Anzeige-Klassifizierer und verändern keine gespeicherten Daten.
export const isWorksiteParkingOrLogisticsLineV17_90L380 = (
  value: unknown,
): boolean => {
  const key = normalizeWorksiteDisplayKeyV17_90L376(value);
  if (!key) return false;

  if (
    /\b(?:[a-z0-9-]*parkplatz(?:e|en)?|[a-z0-9-]*parkplatze|besucherfeld|stellplatz(?:e|en)?|parken|parkieren|parking|parkhaus|tiefgarage|ladezone|anlieferung)\b/.test(
      key,
    )
  ) {
    return true;
  }

  const hasKeepClearRule =
    /\b(?:freihalten|frei halten|frei bleiben|nicht blockieren|nicht zustellen|nicht abstellen|parkverbot|lieferfahrzeug|lieferfahrzeuge|lieferwagen|lieferverkehr)\b/.test(
      key,
    );
  const hasTrafficArea =
    /\b(?:platz|tor|seitentor|rolltor|zufahrt|einfahrt|rampe|ladezone|anlieferung)\b/.test(
      key,
    );
  return hasKeepClearRule && hasTrafficArea;
};

export const isWorksiteAccessInstructionLineV17_90L380 = (
  value: unknown,
): boolean => {
  const key = normalizeWorksiteDisplayKeyV17_90L376(value);
  if (!key || isWorksiteParkingOrLogisticsLineV17_90L380(value)) return false;
  if (isWorksiteCredentialLineV17_90L376(value)) return true;

  return (
    /\b(?:zugang|zutritt|eingang|hintereingang|seiteneingang|nebeneingang|lieferanteneingang|tuer|tur|seitentuer|seitentur|tor|rolltor|seitentor|garagentor|pforte|klingeln|gegensprechanlage|rezeption|reception|empfang|security desk|sicherheitsdienst|zufahrt)\b/.test(
      key,
    ) ||
    /\b(?:nicht durch|nicht ueber|nicht uber)\b.*\b(?:burogebaude|buerogebaeude|buro|buero|gebaude|gebaeude|eingang)\b/.test(
      key,
    )
  );
};

export const isWorksitePreparationInstructionLineV17_90L380 = (
  value: unknown,
): boolean => {
  const key = normalizeWorksiteDisplayKeyV17_90L376(value);
  if (!key) return false;
  if (
    /\b(?:mitbringen|mitnehmen|bereitstellen|bereithalten|organisieren|abholen|zurueckgeben|zuruckgeben)\b/.test(
      key,
    )
  ) {
    return true;
  }
  return (
    /\b(?:leiter|stehleiter|teleskopleiter|geruest|gerust|hubsteiger|hebebuehne|hebebuhne|bodenreinigungsmaschine|reinigungsmaschine|verlaengerungskabel|verlangerungskabel|werkzeug|material|reinigungstuecher|reinigungstucher|ausweis)\b/.test(
      key,
    ) &&
    /\b(?:brauchen|benoetigt|benotigt|erforderlich|noetig|notig|mitbringen|mitnehmen|bereitstellen|bereithalten)\b/.test(
      key,
    )
  );
};

export const isWorksiteOperationalInstructionLineV17_90L380 = (
  value: unknown,
): boolean => {
  const key = normalizeWorksiteDisplayKeyV17_90L376(value);
  if (!key) return false;
  if (
    isWorksiteParkingOrLogisticsLineV17_90L380(value) ||
    isWorksitePreparationInstructionLineV17_90L380(value)
  ) {
    return true;
  }
  return (
    /\b(?:nicht verschieben|nicht bewegen|nicht anfassen|nicht ausstecken|nicht nass reinigen|nicht feucht reinigen|nicht betreten|warnschilder aufstellen|absperren|abdecken|offen halten|wieder schliessen|wieder schließen)\b/.test(
      key,
    ) ||
    (/\b(?:empfindliche maschinen|empfindliche geraete|empfindliche gerate|maschinen|geraete|gerate)\b/.test(
      key,
    ) &&
      /\b(?:nicht|duerfen nicht|durfen nicht|vorsichtig|empfindlich)\b/.test(
        key,
      ))
  );
};

export const isWorksiteSiteLocalCommunicationLineV17_90L380 = (
  value: unknown,
): boolean => {
  const key = normalizeWorksiteDisplayKeyV17_90L376(value);
  if (!key) return false;
  if (/\b(?:nach abschluss|nach erledigung|nach ausfuehrung|nach ausfuhrung)\b/.test(key)) {
    return false;
  }
  return (
    /\b(?:bei ankunft|vor ankunft|vor arbeitsbeginn|vor beginn|vor dem arbeitsbeginn)\b/.test(
      key,
    ) &&
    /\b(?:anrufen|telefonisch|telefon|whatsapp|sms|melden|kontaktieren|informieren|nachricht)\b/.test(
      key,
    )
  );
};

export const isWorksiteExplicitElectricalRiskLineV17_90L380 = (
  value: unknown,
): boolean => {
  const key = normalizeWorksiteDisplayKeyV17_90L376(value);
  if (!key) return false;
  return (
    /\b(?:stromschlag|unter spannung|stromfuehrend|stromfuhrend|elektrische gefahr|elektrischer schlag|offene kabel|offenes kabel|lose kabel|loses kabel|beschaedigte kabel|beschadigte kabel|defekte kabel|defektes kabel)\b/.test(
      key,
    ) ||
    (/\bkabel\b/.test(key) &&
      /\b(?:offen|lose|beschaedigt|beschadigt|defekt|stromfuehrend|stromfuhrend|unter spannung|gefahr|vorsicht|achtung)\b/.test(
        key,
      ))
  );
};

const RESERVED_DISPLAY_PREFIX_V17_90L376 =
  /^(?:allgemein|hinweis|hinweise|info|information|informationen|wichtige informationen|weitere besonderheiten|besonderheiten|gefahr|achtung|warnung|termin|datum|zeit|uhrzeit|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|heute|morgen|ubermorgen|uebermorgen|zugang|zutritt|schluessel|schlussel|schlüssel|key|code|pin|tuercode|türcode|turcode|badge|keycard|kontakt|telefon|telefonnummer|tel|sms|whatsapp|e mail|email|mail|parkplatz|parken|parking|objekt|strasse|strasse|straße|plz|ort)$/;

const normalizeCredentialDisplayLineV17_90L376 = (value: unknown): string => {
  const line = compactWorksiteDisplayTextV17_90L376(value);
  if (!line) return "";

  const match = line.match(
    /^(Türcode|Tuercode|Turcode|Torcode|Eingangscode|Zugangscode|Code|PIN)\s*(?:[:#-]\s*)?([A-Za-z0-9][A-Za-z0-9 _./-]*)$/i,
  );
  if (!match) return line;

  const rawLabel = normalizeWorksiteDisplayKeyV17_90L376(match[1]);
  const label = rawLabel === "pin"
    ? "PIN"
    : rawLabel.includes("tuer") || rawLabel.includes("tur")
      ? "Türcode"
      : rawLabel.includes("tor")
        ? "Torcode"
        : rawLabel.includes("eingang")
          ? "Eingangscode"
          : rawLabel.includes("zugang")
            ? "Zugangscode"
            : "Code";
  return `${label}: ${compactWorksiteDisplayTextV17_90L376(match[2])}`;
};

const splitWorksiteDisplayDetailV17_90L376 = (value: unknown): string[] => {
  const line = compactWorksiteDisplayTextV17_90L376(value);
  if (!line) return [];

  // V17.90L378: Datum und Uhrzeit eines Termins bleiben eine einzige
  // Anzeigezeile. Der mittlere Punkt ist hier ein Trenner innerhalb des
  // Termins und darf nicht wie eine Liste aufgespalten werden.
  if (/^(?:Termin|Datum|Zeit|Uhrzeit)\s*:/i.test(line)) {
    return [line];
  }

  return line
    .split(/\s+(?:·|\||•)\s+/g)
    .map(normalizeCredentialDisplayLineV17_90L376)
    .filter(Boolean);
};

const splitWorksiteDisplayPrefixV17_90L376 = (
  value: unknown,
): { siteLabel: string; detail: string } | null => {
  const line = compactWorksiteDisplayTextV17_90L376(value);
  if (!line) return null;

  const colonIndex = line.indexOf(":");
  if (colonIndex <= 0) return null;

  const prefix = compactWorksiteDisplayTextV17_90L376(line.slice(0, colonIndex));
  const detail = compactWorksiteDisplayTextV17_90L376(line.slice(colonIndex + 1));
  if (!prefix || !detail || prefix.length > 100) return null;

  const prefixKey = normalizeWorksiteDisplayKeyV17_90L376(prefix);
  if (
    !prefixKey ||
    !/[a-z]/.test(prefixKey) ||
    RESERVED_DISPLAY_PREFIX_V17_90L376.test(prefixKey) ||
    /^(?:https?|www)\b/.test(prefixKey) ||
    /^(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|heute|morgen|ubermorgen|uebermorgen)\b/.test(
      prefixKey,
    )
  ) {
    return null;
  }

  return { siteLabel: prefix, detail };
};

const pushUniqueDisplayLineV17_90L376 = (
  target: string[],
  value: unknown,
): void => {
  const line = normalizeCredentialDisplayLineV17_90L376(value);
  const key = normalizeWorksiteDisplayKeyV17_90L376(line);
  if (!line || !key) return;
  if (target.some((existing) => normalizeWorksiteDisplayKeyV17_90L376(existing) === key)) {
    return;
  }
  target.push(line);
};

export const groupWorksiteDisplayLinesV17_90L376 = (
  values: Array<string | null | undefined>,
): WorksiteDisplayGroupV17_90L376[] => {
  const siteGroups: WorksiteDisplayGroupV17_90L376[] = [];
  const siteIndexByKey = new Map<string, number>();
  const generalLines: string[] = [];

  values
    .flatMap((value) => String(value ?? "").split(/\n+/g))
    .map(compactWorksiteDisplayTextV17_90L376)
    .filter(Boolean)
    .forEach((line) => {
      const scoped = splitWorksiteDisplayPrefixV17_90L376(line);
      if (!scoped) {
        splitWorksiteDisplayDetailV17_90L376(line).forEach((detail) =>
          pushUniqueDisplayLineV17_90L376(generalLines, detail),
        );
        return;
      }

      const siteKey = normalizeWorksiteDisplayKeyV17_90L376(scoped.siteLabel);
      let groupIndex = siteIndexByKey.get(siteKey);
      if (groupIndex === undefined) {
        groupIndex = siteGroups.length;
        siteIndexByKey.set(siteKey, groupIndex);
        siteGroups.push({ siteLabel: scoped.siteLabel, lines: [] });
      }
      splitWorksiteDisplayDetailV17_90L376(scoped.detail).forEach((detail) =>
        pushUniqueDisplayLineV17_90L376(siteGroups[groupIndex!].lines, detail),
      );
    });

  const result = siteGroups.filter((group) => group.lines.length > 0);
  if (generalLines.length > 0) {
    result.unshift({ siteLabel: null, lines: generalLines });
  }
  return result;
};

export const isWorksiteCredentialLineV17_90L376 = (value: unknown): boolean => {
  const key = normalizeWorksiteDisplayKeyV17_90L376(value);
  if (!key) return false;
  return /\b(?:schluessel|schlussel|key|keybox|keycard|badge|besucherausweis|zugangsausweis|schluesselbox|schlusselbox|schluesselkasten|schlusselkasten|schluesseltresor|schlusseltresor|code|kode|tuercode|turcode|tuerkode|turkode|torcode|torkode|eingangscode|eingangskode|zugangscode|zugangskode|pin|cle|cles|chiave|chiavi|codice|codici|llave|llaves|codigo|codigos|chave|chaves)\b/.test(
    key,
  );
};

export const buildWorksiteAccessChipDisplayV17_90L376 = (
  values: Array<string | null | undefined>,
): WorksiteAccessChipDisplayV17_90L376 | null => {
  const groups = groupWorksiteDisplayLinesV17_90L376(values);
  const allLines = groups.flatMap((group) => group.lines);
  if (allLines.length === 0) return null;

  const siteKeys = new Set(
    groups
      .map((group) => normalizeWorksiteDisplayKeyV17_90L376(group.siteLabel))
      .filter(Boolean),
  );
  const worksiteCount = siteKeys.size > 0 ? siteKeys.size : 1;
  const kind: WorksiteAccessChipKindV17_90L376 = allLines.some(
    isWorksiteCredentialLineV17_90L376,
  )
    ? "key"
    : "door";

  const tooltipLines = groups.flatMap((group) =>
    group.lines.map((line) =>
      group.siteLabel ? `${group.siteLabel}: ${line}` : line,
    ),
  );

  return {
    kind,
    worksiteCount,
    groups,
    tooltip: tooltipLines.join("\n"),
  };
};


export type UnifiedWorksiteInfoDisplayV17_90L378 = {
  primary: string[];
  additional: string[];
};

type UnifiedInfoSourceV17_90L379 = "primary" | "additional" | "access";

type UnifiedInfoEntryV17_90L379 = {
  siteLabel: string | null;
  line: string;
  source: UnifiedInfoSourceV17_90L379;
  order: number;
};

const displayLineCoveredV17_90L378 = (
  candidate: string,
  scopedLines: string[],
): boolean => {
  const key = normalizeWorksiteDisplayKeyV17_90L376(candidate);
  if (!key) return false;
  return scopedLines.some((line) => {
    const scopedKey = normalizeWorksiteDisplayKeyV17_90L376(line);
    if (!scopedKey) return false;
    if (scopedKey === key) return true;
    return (
      key.length >= 8 &&
      scopedKey.length >= 8 &&
      (scopedKey.includes(key) || key.includes(scopedKey))
    );
  });
};

const isNeutralUnifiedInfoLineV17_90L379 = (value: unknown): boolean => {
  const key = normalizeWorksiteDisplayKeyV17_90L376(value);
  if (!key) return false;

  // Neutrale Organisationsangaben bleiben blau, auch wenn sie ursprünglich
  // unter "Weitere Besonderheiten" gespeichert wurden.
  return (
    /^(?:termin|datum|zeit|uhrzeit)\b/.test(key) ||
    /\b(?:abschlussfoto|abschlussfotos|foto|fotos|fotodokumentation|bericht|rapport|protokoll|dokumentation)\b/.test(
      key,
    ) ||
    /\b(?:nach abschluss|nach erledigung|nach ausfuehrung|nach ausfuhrung)\b/.test(
      key,
    ) ||
    /\b(?:per e mail|per email|per mail|per whatsapp|per sms)\b.*\b(?:senden|schicken|bestaetigen|bestatigen|melden|uebermitteln|ubermitteln)\b/.test(
      key,
    )
  );
};

const isActionableUnifiedInfoLineV17_90L379 = (value: unknown): boolean => {
  const key = normalizeWorksiteDisplayKeyV17_90L376(value);
  if (!key) return false;

  if (isWorksiteCredentialLineV17_90L376(value)) return true;

  return (
    isWorksiteParkingOrLogisticsLineV17_90L380(value) ||
    isWorksiteAccessInstructionLineV17_90L380(value) ||
    isWorksiteOperationalInstructionLineV17_90L380(value) ||
    // Mitbringen, bereitstellen, Schutz- und Arbeitsmittel.
    /\b(?:leiter|stehleiter|teleskopleiter|geruest|gerust|hubsteiger|hebebuehne|hebebuhne|maschine|geraet|gerat|werkzeug|material|reinigungsmittel|schutzkleidung|schutzbrille|handschuhe|helm|maske|abdeckvlies|folie)\b/.test(
      key,
    ) ||
    /\b(?:mitbringen|mitnehmen|bereitstellen|bereithalten|organisieren|abholen|zurueckgeben|zuruckgeben|tragen|anziehen)\b/.test(
      key,
    ) ||
    // Parken, Zufahrt und Be-/Entladen.
    /\b(?:parkplatz|parken|parking|parkhaus|tiefgarage|zufahrt|einfahrt|ladezone|anlieferung|beladen|entladen)\b/.test(
      key,
    ) ||
    // Vorbereitende oder vor Ort zwingend auszuführende Handlungen.
    /\b(?:vorher|vor beginn|vor arbeitsbeginn)\b.*\b(?:anrufen|telefonieren|melden|kontaktieren|informieren|bestaetigen|bestatigen)\b/.test(
      key,
    ) ||
    /\b(?:aufschliessen|aufschließen|oeffnen|offnen|freigeben|absperren|abdecken|verschieben|raeumen|raumen)\b/.test(
      key,
    ) ||
    /\b(?:wasseranschluss|stromanschluss|steckdose|wasserhahn)\b/.test(key) ||
    /\b(?:nur zwischen|nur von|zugang nur|zutritt nur)\b/.test(key)
  );
};

const collectUnifiedInfoEntriesV17_90L379 = (
  values: Array<string | null | undefined>,
  source: UnifiedInfoSourceV17_90L379,
  startOrder: number,
): UnifiedInfoEntryV17_90L379[] => {
  const entries: UnifiedInfoEntryV17_90L379[] = [];
  let order = startOrder;

  values
    .flatMap((value) => String(value ?? "").split(/\n+/g))
    .map(compactWorksiteDisplayTextV17_90L376)
    .filter(Boolean)
    .forEach((rawLine) => {
      const scoped = splitWorksiteDisplayPrefixV17_90L376(rawLine);
      const siteLabel = scoped?.siteLabel || null;
      const detail = scoped?.detail || rawLine;
      splitWorksiteDisplayDetailV17_90L376(detail).forEach((line) => {
        const normalizedLine = normalizeCredentialDisplayLineV17_90L376(line);
        if (!normalizedLine) return;
        entries.push({ siteLabel, line: normalizedLine, source, order });
        order += 1;
      });
    });

  return entries;
};

const flattenUnifiedInfoEntriesV17_90L379 = (
  entries: UnifiedInfoEntryV17_90L379[],
): string[] => {
  const scopedLines = entries
    .filter((entry) => Boolean(entry.siteLabel))
    .map((entry) => entry.line);

  const filtered = entries.filter(
    (entry) =>
      Boolean(entry.siteLabel) ||
      !displayLineCoveredV17_90L378(entry.line, scopedLines),
  );

  const seen = new Set<string>();
  const unique = filtered.filter((entry) => {
    const key = `${normalizeWorksiteDisplayKeyV17_90L376(entry.siteLabel)}|${normalizeWorksiteDisplayKeyV17_90L376(entry.line)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const general = unique
    .filter((entry) => !entry.siteLabel)
    .sort((a, b) => a.order - b.order);
  const scoped = unique.filter((entry) => Boolean(entry.siteLabel));
  const siteOrder: string[] = [];
  const siteLabelByKey = new Map<string, string>();

  scoped.forEach((entry) => {
    const siteKey = normalizeWorksiteDisplayKeyV17_90L376(entry.siteLabel);
    if (!siteKey || siteLabelByKey.has(siteKey)) return;
    siteOrder.push(siteKey);
    siteLabelByKey.set(siteKey, entry.siteLabel || "");
  });

  return [
    ...general.map((entry) => entry.line),
    ...siteOrder.flatMap((siteKey) =>
      scoped
        .filter(
          (entry) =>
            normalizeWorksiteDisplayKeyV17_90L376(entry.siteLabel) === siteKey,
        )
        .sort((a, b) => a.order - b.order)
        .map((entry) => `${siteLabelByKey.get(siteKey)}: ${entry.line}`),
    ),
  ];
};

/**
 * V17.90L379: Vereinheitlicht ausschließlich die sichtbare Info-Darstellung
 * und trennt sie wieder fachlich nach Farbe:
 * - Rot bleibt in den bestehenden Gefahr-Arrays der drei Seiten.
 * - Gelb enthält Zugang, Schlüssel/Code, Mitbringen, Vorbereitung, Parken und
 *   sonstige handlungsrelevante Besonderheiten.
 * - Blau enthält Termin und neutrale organisatorische Informationen.
 * Gespeicherte Aufträge, Angebote, Rechnungen, Arbeitsorte und Positionen
 * werden nicht verändert.
 */
export const buildUnifiedWorksiteInfoDisplayV17_90L378 = (
  primaryValues: Array<string | null | undefined>,
  additionalValues: Array<string | null | undefined> = [],
  accessValues: Array<string | null | undefined> = [],
): UnifiedWorksiteInfoDisplayV17_90L378 => {
  const primaryEntries = collectUnifiedInfoEntriesV17_90L379(
    primaryValues,
    "primary",
    0,
  );
  const additionalEntries = collectUnifiedInfoEntriesV17_90L379(
    additionalValues,
    "additional",
    primaryEntries.length,
  );
  const accessEntries = collectUnifiedInfoEntriesV17_90L379(
    accessValues,
    "access",
    primaryEntries.length + additionalEntries.length,
  );

  const allEntries = [
    ...accessEntries,
    ...primaryEntries,
    ...additionalEntries,
  ];

  const yellowEntries: UnifiedInfoEntryV17_90L379[] = [];
  const blueEntries: UnifiedInfoEntryV17_90L379[] = [];

  allEntries.forEach((entry) => {
    // Zugang, Schlüssel/Code und konkrete Vorbereitungsmaßnahmen haben Vorrang
    // vor neutralen Kommunikationswörtern innerhalb derselben Zeile.
    if (
      entry.source === "access" ||
      isActionableUnifiedInfoLineV17_90L379(entry.line)
    ) {
      yellowEntries.push(entry);
      return;
    }
    if (isNeutralUnifiedInfoLineV17_90L379(entry.line)) {
      blueEntries.push(entry);
      return;
    }
    if (entry.source === "additional") {
      yellowEntries.push(entry);
      return;
    }
    blueEntries.push(entry);
  });

  return {
    primary: flattenUnifiedInfoEntriesV17_90L379(blueEntries),
    additional: flattenUnifiedInfoEntriesV17_90L379(yellowEntries),
  };
};
