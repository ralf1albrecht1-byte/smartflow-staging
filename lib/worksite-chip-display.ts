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

const splitWorksiteDisplayDetailV17_90L376 = (value: unknown): string[] =>
  compactWorksiteDisplayTextV17_90L376(value)
    .split(/\s+(?:·|\||•)\s+/g)
    .map(normalizeCredentialDisplayLineV17_90L376)
    .filter(Boolean);

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
