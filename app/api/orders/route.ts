export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireUserId,
  unauthorizedResponse,
  getSessionUser,
} from "@/lib/get-session";
import { logAuditAsync } from "@/lib/audit";
import {
  assertCustomerNotArchived,
  CustomerArchivedError,
} from "@/lib/customer-links";
import {
  buildSpecialNotes,
  splitSpecialNotes,
} from "@/lib/special-notes-utils";
import {
  repairPersistedOrderZeroHourItemsFromText,
  repairZeroQuantityHourItemsFromText,
} from "@/lib/order-hour-line-repair";
import {
  rememberCustomerExecutionAddress,
  rememberExecutionAddressesFromOrder,
} from "@/lib/customer-execution-addresses";

type SemanticNoteMatch = {
  label: string;
  type: "safety" | "hint";
  patterns: RegExp[];
};

const normalizeSearchText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s/-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

function stripInternalTitleLinesFromText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      // Interne Smartflow-Titel sind Metadaten und dürfen nicht als Kundentext
      // oder spätere Leistungs-Evidence gespeichert werden.
      return !/^\[\s*(?:titel|title)\s*[:：][^\]]*\]\s*$/i.test(trimmed);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// V16.37: Route-level safety net for browser-created orders.
// If the UI posts an order with a blank/new customerId and the original text
// contains a clear nameless "Rechnung an:" block, persist that billing address
// on the linked blank customer. This catches paths that do not go through
// lib/order-intake.ts.
function extractNamelessBillingAddressFromOrderPayloadV1637(
  ...values: unknown[]
): {
  street: string | null;
  plz: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
} | null {
  const source = values
    .map((value) => String(value ?? ""))
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!source) return null;

  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const markerRegex =
    /^\s*(?:rechnung\s+(?:geht\s+)?an|rechnung\s+(?:für|fuer)|rechnung\s+bekommt|rechnungsadresse|rechnungsempfänger|rechnungsempfaenger|rechnungskunde|billing\s+address|bill\s+to|invoice\s+customer|billing\s+customer|client\s*\/\s*facturation|facturation)\s*:?\s*(.*)$/i;
  const stopRegex =
    /^\s*(?:arbeitsort|objekt|einsatzort|einsatzadresse|ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsadresse|baustelle|montageort|serviceadresse|adresse\s+de\s+travail|lieu\s+d['’]?intervention|work\s+address|work\s+site|job\s+site|kontakt\s+vor\s+ort|kontaktperson|ansprechperson|person\s+vor\s+ort|besonderheiten|bemerkungen|hinweise|leistungen|leistungsübersicht|leistungsuebersicht|termin|datum)\s*:?/i;

  const parseStreet = (line: string): string | null => {
    const raw = String(line || "")
      .replace(
        /^\s*(?:adresse|anschrift|strasse|straße|street\s+address|address)\s*:?\s*/i,
        "",
      )
      .replace(/[,;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) return null;

    const houseNumber = "\\d+[a-zA-Z]?(?:\\s*[/-]\\s*\\d+[a-zA-Z]?)?";
    const word = "[A-ZÄÖÜa-zäöüß][A-Za-zÄÖÜäöüß'.-]*";
    const suffix =
      "(?:strasse|straße|str\\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|street|road|lane)";
    const patterns = [
      new RegExp(
        `\\b((?:${word}\\s+){0,3}${word}${suffix}\\s+${houseNumber})\\b`,
        "i",
      ),
      new RegExp(
        `\\b((?:${word}\\s+){1,4}${suffix}\\s+${houseNumber})\\b`,
        "i",
      ),
      new RegExp(
        `\\b((?:rue|avenue|av\\.?|chemin|via|viale)\\s+${word}(?:\\s+(?:de|des|du|del|della|la|le|les|l['’]?|d['’]?|${word})){0,6}\\s+${houseNumber})\\b`,
        "i",
      ),
    ];

    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match?.[1]) {
        return match[1]
          .replace(
            /^\s*(?:beim|bei|an|am|in|zur|zum)\s+(?:der|dem|den|das)?\s*/i,
            "",
          )
          .replace(/\s+/g, " ")
          .trim();
      }
    }

    return null;
  };

  const parsePlzCity = (
    line: string,
  ): { plz: string | null; city: string | null } => {
    const cleaned = String(line || "")
      .replace(
        /^\s*(?:plz\s*\/\s*ort|plz|ort|postleitzahl|zip|postal\s+code|ville|city)\s*:?\s*/i,
        "",
      )
      .replace(/[,;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const match = cleaned.match(
      /\b(\d{4,5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{1,60}?)(?=\s*(?:$|\b(?:tel\.?|telefon|phone|mobile|handy|natel|e-?mail|email|arbeitsort|objekt|kontakt|besonderheiten|leistungen|leistungsübersicht|leistungsuebersicht)\b|[,;.]))/i,
    );
    if (!match) return { plz: null, city: null };

    const city = String(match[2] || "")
      .replace(
        /\b(?:kommen|arbeiten|reinigen|melden|montieren|prüfen|pruefen|machen|erledigen)\b.*$/i,
        "",
      )
      .replace(/[,;:.]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return { plz: match[1] || null, city: city || null };
  };

  const extractPhone = (block: string): string | null => {
    const explicit = block.match(
      /\b(?:tel\.?|telefon|phone|mobile|handy|natel)\s*[:.]?\s*(\+?\d[\d\s()./-]{6,}\d)\b/i,
    );
    const loose =
      explicit?.[1] || block.match(/(\+?\d[\d\s()./-]{7,}\d)/)?.[1] || null;
    return loose ? loose.replace(/\s+/g, " ").trim() : null;
  };

  const extractEmail = (block: string): string | null =>
    block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.trim() || null;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(markerRegex);
    if (!match) continue;

    const blockLines: string[] = [];
    if (match[1]?.trim()) blockLines.push(match[1].trim());

    for (let offset = 1; offset <= 10; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (stopRegex.test(line)) break;
      if (/^\[Titel\s*:/i.test(line)) break;
      blockLines.push(line);
    }

    const block = blockLines.join("\n").trim();
    if (!block) continue;

    let street: string | null = null;
    let plz: string | null = null;
    let city: string | null = null;

    for (const line of blockLines) {
      if (
        /^\s*(?:e-?mail|email|tel\.?|telefon|phone|mobile|handy|natel)\b/i.test(
          line,
        )
      )
        continue;

      if (!street) street = parseStreet(line);

      const parsedPlzCity = parsePlzCity(line);
      if (!plz && parsedPlzCity.plz) plz = parsedPlzCity.plz;
      if (!city && parsedPlzCity.city) city = parsedPlzCity.city;
    }

    if (!street) street = parseStreet(block);
    if (!plz || !city) {
      const wholePlzCity = parsePlzCity(block);
      if (!plz && wholePlzCity.plz) plz = wholePlzCity.plz;
      if (!city && wholePlzCity.city) city = wholePlzCity.city;
    }

    const phone = extractPhone(block);
    const email = extractEmail(block);

    const hasSafeAddress = Boolean(street && plz && city);
    const hasSafePartialWithContact = Boolean(
      (street || (plz && city)) && (phone || email),
    );
    if (!hasSafeAddress && !hasSafePartialWithContact) continue;

    return { street, plz, city, phone, email };
  }

  return null;
}

function compactRouteTextV17_70(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeExecutionAddressComparePartV17_70(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/strasse|straße|str\./g, "str")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractExplicitExecutionAddressFromOrderPayloadV17_70(
  ...values: unknown[]
): {
  siteName: string | null;
  siteAddress: string;
  sitePlz: string;
  siteCity: string;
  siteNote: string | null;
} | null {
  const source = compactRouteTextV17_70(
    values
      .map((value) => String(value ?? ""))
      .filter(Boolean)
      .join("\n"),
  );
  if (!source) return null;

  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const markerRegex =
    /^\s*(?:ausführung|ausfuehrung|ausführungsadresse|ausfuehrungsadresse|ausführungsort|ausfuehrungsort|arbeitsort|arbeitsadresse|baustelle|objekt|einsatzort|einsatzadresse|serviceadresse|job\s*site|work\s*address|work\s*site|lieu\s+d['’]?intervention|adresse\s+de\s+travail)\s*:?\s*(.*)$/i;
  const stopRegex =
    /^\s*(?:rechnung\s+(?:geht\s+)?an|rechnungsadresse|rechnungskunde|billing\s+address|bill\s+to|invoice\s+customer|kontakt|kontaktperson|ansprechperson|besonderheiten|bemerkungen|hinweise|leistungen|leistungsübersicht|leistungsuebersicht|termin|datum)\s*:?/i;
  const priceOrCalculationLineRegex =
    /(?:\b(?:chf|eur|franken|euro|sfr|stutz)\b|€|\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|stk|stück|stueck|pcs?|meter|m)\b|\b(?:à|a|je|mal|x)\s*\d+(?:[.,]\d+)?\b|\d+(?:[.,]\d+)?\s*(?:chf|eur|fr\.?|€)\b)/i;

  const parseStreet = (line: string): string | null => {
    const raw = compactRouteTextV17_70(line)
      .replace(
        /^\s*(?:adresse|anschrift|strasse|straße|street\s+address|address)\s*:?\s*/i,
        "",
      )
      .replace(/[,;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) return null;

    const houseNumber = "\\d+[a-zA-Z]?(?:\\s*[/-]\\s*\\d+[a-zA-Z]?)?";
    const word = "[A-ZÄÖÜa-zäöüß][A-Za-zÄÖÜäöüß'.-]*";
    const suffix =
      "(?:strasse|straße|str\\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|street|road|lane)";
    const patterns = [
      new RegExp(
        `\\b((?:${word}\\s+){0,3}${word}${suffix}\\s+${houseNumber})\\b`,
        "i",
      ),
      new RegExp(
        `\\b((?:${word}\\s+){1,4}${suffix}\\s+${houseNumber})\\b`,
        "i",
      ),
      new RegExp(
        `\\b((?:rue|avenue|av\\.?|chemin|via|viale)\\s+${word}(?:\\s+(?:de|des|du|del|della|la|le|les|l['’]?|d['’]?|${word})){0,6}\\s+${houseNumber})\\b`,
        "i",
      ),
    ];

    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match?.[1]) return match[1].replace(/\s+/g, " ").trim();
    }

    return null;
  };

  const parsePlzCity = (
    line: string,
  ): { plz: string | null; city: string | null } => {
    const cleaned = compactRouteTextV17_70(line)
      .replace(
        /^\s*(?:plz\s*\/\s*ort|plz|ort|postleitzahl|zip|postal\s+code|ville|city)\s*:?\s*/i,
        "",
      )
      .replace(/[,;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const match = cleaned.match(
      /\b(\d{4,5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß' .\-]{1,60}?)(?=\s*(?:$|[,;.]))/i,
    );
    if (!match) return { plz: null, city: null };
    const city = String(match[2] || "")
      .replace(/[,;:.]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return { plz: match[1] || null, city: city || null };
  };

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index].match(markerRegex);
    if (!marker) continue;

    const blockLines: string[] = [];
    if (marker[1]?.trim()) blockLines.push(marker[1].trim());

    for (let offset = 1; offset <= 8; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      if (stopRegex.test(line)) break;
      if (priceOrCalculationLineRegex.test(line) && blockLines.length > 0)
        break;
      blockLines.push(line);
    }

    if (blockLines.length === 0) continue;

    let siteName: string | null = null;
    let siteAddress: string | null = null;
    let sitePlz: string | null = null;
    let siteCity: string | null = null;
    const notes: string[] = [];

    for (const line of blockLines) {
      if (priceOrCalculationLineRegex.test(line)) break;

      const street = parseStreet(line);
      if (street && !siteAddress) {
        siteAddress = street;
        continue;
      }

      const place = parsePlzCity(line);
      if (place.plz && place.city && !sitePlz && !siteCity) {
        sitePlz = place.plz;
        siteCity = place.city;
        continue;
      }

      const cleaned = compactRouteTextV17_70(line);
      if (!cleaned) continue;
      if (!siteName && !siteAddress && !sitePlz && !siteCity) {
        siteName = cleaned;
      } else if (siteAddress && sitePlz && siteCity) {
        notes.push(cleaned);
      }
    }

    const fullBlock = blockLines.join("\n");
    if (!siteAddress) siteAddress = parseStreet(fullBlock);
    if (!sitePlz || !siteCity) {
      const place = parsePlzCity(fullBlock);
      sitePlz = sitePlz || place.plz;
      siteCity = siteCity || place.city;
    }

    if (siteAddress && sitePlz && siteCity) {
      return {
        siteName: siteName || null,
        siteAddress,
        sitePlz,
        siteCity,
        siteNote: notes.length > 0 ? notes.join("; ") : null,
      };
    }
  }

  return null;
}

function isSameExecutionAsBillingV17_70(
  order: any,
  input: {
    siteAddress?: string | null;
    sitePlz?: string | null;
    siteCity?: string | null;
  },
): boolean {
  const customer = order?.customer;
  if (!customer) return false;

  const executionKey = [
    normalizeExecutionAddressComparePartV17_70(input.siteAddress),
    normalizeExecutionAddressComparePartV17_70(input.sitePlz),
    normalizeExecutionAddressComparePartV17_70(input.siteCity),
  ].join("|");
  const billingKey = [
    normalizeExecutionAddressComparePartV17_70(customer?.address),
    normalizeExecutionAddressComparePartV17_70(customer?.plz),
    normalizeExecutionAddressComparePartV17_70(customer?.city),
  ].join("|");

  return Boolean(executionKey && billingKey && executionKey === billingKey);
}

function hasUnresolvedExecutionAddressRoleReviewV17_70(order: any): boolean {
  const reasons = Array.isArray(order?.reviewReasons)
    ? order.reviewReasons
    : [];
  return reasons.some((reason: any) => {
    const key = String(reason || "").toLowerCase();
    return (
      key === "address_role_uncertain" ||
      key.includes("address_role_uncertain") ||
      key.includes("customer_address_quarantined") ||
      key.includes("ambiguous_role")
    );
  });
}

function inferExplicitCurrencyFromPayload(
  data: any,
): "CHF" | "EUR" | undefined {
  const source = [
    data?.notes,
    data?.description,
    data?.serviceName,
    data?.specialNotes,
    data?.audioTranscript,
    ...(Array.isArray(data?.items)
      ? data.items.flatMap((item: any) => [
          item?.serviceName,
          item?.description,
        ])
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  const normalized = normalizeSearchText(source);
  const hasChf = /\bchf\b|\bfranken\b|\bstutz\b|\bsfr\b/.test(normalized);
  const hasEur = /\beur\b|\beuro\b/.test(normalized) || /€/.test(source);

  if (hasChf && !hasEur) return "CHF";
  if (hasEur && !hasChf) return "EUR";
  return undefined;
}

function cleanLineLocalServiceLabelGrammarV17_60(value?: string | null) {
  let text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";

  // V17.60: purely grammatical cleanup for line-local labels. This is not a
  // service mapping: it only removes punctuation before a final infinitive-like
  // action and moves a trailing spatial modifier before the location phrase.
  text = text
    .replace(
      /\s*[,;:]\s*(?=[A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß]{3,}(?:en|ern|eln)\b\s*$)/giu,
      " ",
    )
    .replace(/\bsauber\s+machen\s+reinigen\b/gi, "sauber machen")
    .replace(/\bsaubermachen\s+reinigen\b/gi, "saubermachen")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(
    /^(.*?)\s+((?:im|in\s+der|in\s+dem|am|an\s+der)\s+.+?)\s+(innen|aussen|außen|oben|unten|vorne|hinten)\s+([A-Za-zÀ-ÖØ-öø-ÿÄÖÜäöüß]{3,}(?:en|ern|eln))\s*$/iu,
    (
      _match,
      prefix: string,
      locationPhrase: string,
      modifier: string,
      action: string,
    ) => {
      const left = String(prefix || "").trim();
      const location = String(locationPhrase || "").trim();
      const mod = String(modifier || "").trim();
      const verb = String(action || "").trim();
      if (!left || !location || !mod || !verb) return text;
      return `${left} ${mod} ${location} ${verb}`.replace(/\s+/g, " ").trim();
    },
  );

  return text.replace(/\s+/g, " ").replace(/\s*[\(\[\{]+\s*$/g, "").trim();
}

function normalizeServiceNameForDisplay(value?: string | null) {
  const name = cleanLineLocalServiceLabelGrammarV17_60(value);
  const key = normalizeSearchText(name);
  if (!name) return "";

  // V17.59: API persistence must preserve concrete, line-local service names
  // coming from the semantic intake. Do not collapse "Tische im Sitzungszimmer
  // reinigen" to "Besprechungsbereich reinigen" or "Technikraum abstauben" to
  // "Technikraum reinigen". This is action-based and structural, not a fixed
  // service-word mapping.
  const hasLineLocalWorkAction =
    /(?:reinig|putz|saeuber|säuber|sauber\s+machen|saubermachen|clean|nettoyage|pulizia|limpieza|wisch|abstaub|desinfizier|entfett|saug|entfern|schneid|streichen|malen|montier|demontier|reparier|liefer|umstell)/.test(
      key,
    );
  const wordCount = key.split(/\s+/g).filter(Boolean).length;
  if (hasLineLocalWorkAction && wordCount >= 2 && name.length > 12) {
    return cleanLineLocalServiceLabelGrammarV17_60(name);
  }

  if (/archive\s+room|archivraum|\barchiv\b/.test(key)) {
    return "Archivraum reinigen";
  }
  if (
    /glass\s+door|glastuer|glastur|glastuere|glastüren|porte\s+vitree/.test(key)
  ) {
    return "Glastür reinigen";
  }
  if (/local\s+technique|technikraum|technical\s+room|serverraum/.test(key)) {
    return "Technikraum reinigen";
  }
  if (
    /meeting\s+(?:area|room)|besprechungsbereich|besprechungsraum|sitzungszimmer|salle\s+de\s+reunion/.test(
      key,
    )
  ) {
    return "Besprechungsbereich reinigen";
  }
  if (/kontrollgang/.test(key)) {
    return "Kontrollgang reinigen";
  }
  if (/gangbereich|corridor|couloir|flur/.test(key)) {
    return "Gangbereich reinigen";
  }

  if (
    /\b(anfahrt|fahrt|fahrtkosten|fahrpauschale|wegpauschale|reisepauschale|deplacement|déplacement|frais\s+de\s+deplacement|travel|travel\s+flat\s+fee|trip|transport|viaje)\b/.test(
      key,
    )
  ) {
    return "Anfahrt";
  }

  const hasFloorIntent =
    /(?:^|\b|[a-z])boden\b|\bbode\b|\bfloor\b|\bsol\b|\bpaviment|\bsuelo\b/.test(
      key,
    ) ||
    /bodenreinigung|floor cleaning|nettoyage du sol|pulizia pavimento|limpieza suelo/.test(
      key,
    );
  const hasCleaningIntent =
    /reinig|putz|putze|saeuber|clean|nettoyage|pulizia|limpieza|wisch/.test(
      key,
    );
  if (hasFloorIntent && hasCleaningIntent) return "Boden reinigen";

  const hasWindowIntent =
    /fenster|fensterli|vitrin|vitre|window|fenetre|finestr|ventan/.test(key);
  const hasNonCleaningWindowIntent =
    /streich|maler|lackier|reparier|ersetzen|montier|einbau|abdicht|dicht/.test(
      key,
    );
  if (hasWindowIntent && !hasNonCleaningWindowIntent) return "Fenster reinigen";

  return name;
}

function cleanWorkSiteDisplayName(value?: string | null) {
  let text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  text = text
    .replace(
      /^(?:arbeitsort|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|ausführungsadresse|ausfuehrungsadresse|einsatzort|objekt|baustelle|job site|work site|lieu|lieu d['’]?intervention|adresse de travail)\s*(?:ist|isch|is|=|:)?\s*/i,
      "",
    )
    .replace(
      /^(?:wo\s+gemacht\s+werden\s+muss|wo\s+arbeiten\s+sind|wo\s+es\s+gemacht\s+wird)\s*:?\s*/i,
      "",
    )
    .replace(
      /^(?:ist|isch|is)\s+(?:nicht|nöd|noed|not)\s+(?:gleich|gliich)\s*,?\s*/i,
      "",
    )
    .replace(/^(?:nicht|nöd|noed|not)\s+(?:gleich|gliich)\s*,?\s*/i, "")
    .replace(/^[:\-–,\s]+/, "")
    .trim();

  return (
    text ||
    String(value || "")
      .replace(/\s+/g, " ")
      .trim() ||
    null
  );
}

function getOrderSourceTextForItems(data: any) {
  return [
    data?.notes,
    data?.description,
    data?.serviceName,
    data?.specialNotes,
    data?.audioTranscript,
    ...(Array.isArray(data?.items)
      ? data.items.flatMap((item: any) => [
          item?.serviceName,
          item?.description,
        ])
      : []),
  ]
    .map(stripInternalTitleLinesFromText)
    .filter(Boolean)
    .join("\n");
}

function isHourUnitForPersistedRepair(value?: string | null) {
  const unit = normalizeSearchText(value || "").replace(/[^a-z0-9]/g, "");
  return [
    "stunde",
    "stunden",
    "std",
    "h",
    "hour",
    "hours",
    "heure",
    "heures",
    "hora",
    "horas",
    "ora",
    "ore",
  ].includes(unit);
}

function shouldRunPersistedHourRepairForOrder(order: any) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length === 0) return false;

  const hasBrokenHourItem = items.some((item: any) => {
    const unitPrice = Number(item?.unitPrice || 0);
    const quantity = Number(item?.quantity || 0);
    const totalPrice = Number(item?.totalPrice || 0);

    return (
      isHourUnitForPersistedRepair(item?.unit) &&
      Number.isFinite(unitPrice) &&
      unitPrice > 0 &&
      (!Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(totalPrice) ||
        totalPrice <= 0)
    );
  });

  if (!hasBrokenHourItem) return false;

  const source = getOrderSourceTextForItems(order);
  return /\b(?:stunde|stunden|std\.?|h|hour|hours|heure|heures|hora|horas|ora|ore)\b/i.test(
    source,
  );
}

function serviceIntentTokens(serviceName?: string | null) {
  const key = normalizeSearchText(normalizeServiceNameForDisplay(serviceName));
  if (/boden/.test(key))
    return ["boden", "bode", "floor", "sol", "suelo", "paviment"];
  if (/fenster/.test(key))
    return [
      "fenster",
      "fensterli",
      "fensterfront",
      "window",
      "vitrin",
      "vitre",
      "ventan",
      "fenetre",
    ];
  if (/anfahrt/.test(key))
    return [
      "anfahrt",
      "fahrt",
      "fahrtkosten",
      "deplacement",
      "travel",
      "trip",
      "transport",
    ];
  return key.split(/\s+/g).filter((token) => token.length >= 4);
}

function sourceLineContainsNumber(line: string, value: unknown) {
  const number = Number(
    String(value ?? "")
      .replace("'", "")
      .replace(",", "."),
  );
  if (!Number.isFinite(number) || number <= 0) return false;
  const label = Number.isInteger(number)
    ? String(number)
    : String(Number(number.toFixed(2))).replace(".", "[.,]");
  return new RegExp(`(^|[^0-9])${label}([^0-9]|$)`).test(line);
}

function hasSourceLineSpecificIntentConflict(
  line: string,
  serviceName?: string | null,
) {
  const lineKey = normalizeSearchText(line);
  const serviceKey = normalizeSearchText(
    normalizeServiceNameForDisplay(serviceName),
  );
  if (!lineKey || !serviceKey) return false;

  const itemIsWindow =
    /fenster|window|vitrin|vitre|fenetre|ventan|glastuer|glastur|glass door/.test(
      serviceKey,
    );
  const lineIsWindow =
    /fenster|window|vitrin|vitre|fenetre|ventan|glastuer|glastur|glass door/.test(
      lineKey,
    );
  if (lineIsWindow && !itemIsWindow) return true;

  const itemIsTravel =
    /anfahrt|fahrt|travel|trip|transport|deplacement|reisepauschale/.test(
      serviceKey,
    );
  const lineIsTravel =
    /anfahrt|fahrt|travel|trip|transport|deplacement|reisepauschale/.test(
      lineKey,
    );
  if (lineIsTravel && !itemIsTravel) return true;

  return false;
}

function hasExplicitMissingPriceHint(value?: string | null) {
  return /preis\s*(?:fehlt|offen|unklar|nachtragen)|betrag\s*(?:fehlt|offen|unklar|nachtragen)|ohne\s+preis|kein\s+preis|noch\s+kein\s+preis|price\s*(?:missing|open|unknown|tbd)/i.test(
    String(value || ""),
  );
}

function findSourceLineForItem(source: string, item: any) {
  const tokens = serviceIntentTokens(item?.serviceName);
  if (!source || tokens.length === 0) return "";

  let bestLine = "";
  let bestScore = 0;
  const lines = source
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^\s*\[?\s*(?:titel|title)\s*:/i.test(line)) continue;
    const normalized = normalizeSearchText(line);
    if (!normalized) continue;
    if (hasSourceLineSpecificIntentConflict(line, item?.serviceName)) continue;
    const hits = tokens.filter((token) => normalized.includes(token)).length;
    if (hits === 0) continue;

    let score = hits * 6;
    if (sourceLineContainsNumber(normalized, item?.quantity)) score += 4;
    if (sourceLineContainsNumber(normalized, item?.unitPrice)) score += 2;
    if (
      /\b(chf|eur|franken|stutz|sfr)\b|€|\.\-/.test(normalized) ||
      /€/.test(line)
    )
      score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  return bestScore >= 6 ? bestLine : "";
}

function parseNumberToken(value?: string | null) {
  const number = Number(
    String(value || "")
      .replace("'", "")
      .replace(",", "."),
  );
  return Number.isFinite(number) && number > 0 ? number : null;
}

function extractUnitPriceFromSourceLine(line: string, item?: any) {
  if (!line) return null;

  const patterns: Array<{ re: RegExp; priceGroup: number }> = [
    {
      re: /(?:je|each|à|a|zu|pro|per)\s*(?:chf|eur|fr\.?|sfr|franken|stutz|€)?\s*(\d+(?:[.,]\d+)?)/gi,
      priceGroup: 1,
    },
    {
      re: /(?:chf|eur|fr\.?|sfr|€)\s*(\d+(?:[.,]\d+)?)\s*(?:je|each)\b/gi,
      priceGroup: 1,
    },
    { re: /(?:chf|eur|fr\.?|sfr|€)\s*(\d+(?:[.,]\d+)?)/gi, priceGroup: 1 },
    {
      re: /(\d+(?:[.,]\d+)?)\s*(?:chf|eur|franken|stutz|sfr|€)\b/gi,
      priceGroup: 1,
    },
    { re: /(\d+(?:[.,]\d+)?)\s*\.-/gi, priceGroup: 1 },
  ];

  const matches: Array<{ amount: number; index: number }> = [];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern.re)) {
      const amount = parseNumberToken(match?.[pattern.priceGroup]);
      if (!amount) continue;
      const index = match.index ?? 0;
      if (
        !matches.some(
          (entry) =>
            entry.amount === amount && Math.abs(entry.index - index) < 3,
        )
      ) {
        matches.push({ amount, index });
      }
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1 || !item) return matches[0].amount;

  const normalized = normalizeSearchText(line);
  const tokens = serviceIntentTokens(item?.serviceName);
  const serviceIndexes = tokens
    .map((token) => normalized.indexOf(token))
    .filter((index) => index >= 0);
  const quantity = Number(
    String(item?.quantity ?? "")
      .replace("'", "")
      .replace(",", "."),
  );
  const quantityIndex =
    Number.isFinite(quantity) && quantity > 0
      ? normalized.search(
          new RegExp(
            `(^|[^0-9])${String(quantity).replace(".", "[.,]")}([^0-9]|$)`,
          ),
        )
      : -1;

  const anchor =
    serviceIndexes.length > 0
      ? Math.min(...serviceIndexes)
      : quantityIndex >= 0
        ? quantityIndex
        : -1;

  if (anchor < 0) return null;

  return (
    matches
      .map((match) => ({ ...match, distance: Math.abs(match.index - anchor) }))
      .sort((a, b) => a.distance - b.distance)[0]?.amount || null
  );
}

function shouldTrustSourcePriceForItem(item: any, data: any) {
  const reviewText = [
    item?.description,
    ...(Array.isArray(data?.reviewReasons) ? data.reviewReasons : []),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    Number(item?.unitPrice ?? 0) <= 0 ||
    /preis\s+im\s+text\s+unklar|textpreis\s+übernommen|textpreis\s+uebernommen|price_unclear|unit_price_review/i.test(
      reviewText,
    )
  );
}

const MANUAL_CURRENCY_CONFIRMED_PREFIX = "[MANUAL_CURRENCY_CONFIRMED]";
const PRICE_REVIEW_CONFIRMED_PREFIX = "[PRICE_REVIEW_CONFIRMED]";

function isItemManuallyConfirmedForPersist(item: any): boolean {
  const description = String(item?.description || "").trim();
  const unit = normalizeSearchText(item?.unit);
  const unitPrice = Number(item?.unitPrice ?? 0);
  const quantity = Number(item?.quantity ?? 0);
  return (
    String(item?.serviceName || "").trim().length > 0 &&
    unit.length > 0 &&
    !unit.includes("pruefen") &&
    !unit.includes("prufen") &&
    unitPrice > 0 &&
    quantity > 0 &&
    (description.startsWith(MANUAL_CURRENCY_CONFIRMED_PREFIX) ||
      description.startsWith(PRICE_REVIEW_CONFIRMED_PREFIX))
  );
}

function hasClientItemsPayload(data: any): boolean {
  return Array.isArray(data?.items);
}

function hasCurrencyConflictReviewOnOrderLike(value: any): boolean {
  const reasons = Array.isArray(value?.reviewReasons)
    ? value.reviewReasons
    : [];
  return reasons.some(
    (reason: any) =>
      String(reason || "").startsWith("currency_") ||
      String(reason || "").startsWith("item_currency_mismatch:") ||
      String(reason || "").startsWith("currency_conflict_item:"),
  );
}

function parseCurrencyReviewService(reason: any): string {
  const key = String(reason || "").trim();
  const parts = key.split(":").map((part) => String(part || "").trim());
  const kind = parts[0] || "";
  if (
    kind === "item_currency_mismatch" ||
    kind === "currency_conflict_item" ||
    kind === "price_unclear" ||
    kind === "price_override" ||
    kind === "unit_mismatch" ||
    kind === "unit_missing_in_text"
  ) {
    return normalizeSearchText(normalizeServiceNameForDisplay(parts[1] || ""));
  }
  return "";
}

function hasItemLevelCurrencyReviewReasons(value: any): boolean {
  const reasons = Array.isArray(value?.reviewReasons)
    ? value.reviewReasons
    : [];
  return reasons.some((reason: any) => {
    const key = String(reason || "");
    return (
      key.startsWith("item_currency_mismatch:") ||
      key.startsWith("currency_conflict_item:")
    );
  });
}

function hasGlobalCurrencyReviewWithoutItemDetails(value: any): boolean {
  return (
    hasCurrencyConflictReviewOnOrderLike(value) &&
    !hasItemLevelCurrencyReviewReasons(value)
  );
}

function hasCurrencyMismatchReviewForService(
  data: any,
  serviceName?: string | null,
): boolean {
  const serviceKey = normalizeSearchText(
    normalizeServiceNameForDisplay(serviceName),
  );
  if (!serviceKey) return false;

  const reasons = Array.isArray(data?.reviewReasons) ? data.reviewReasons : [];
  return reasons.some((reason: any) => {
    const key = String(reason || "");
    if (
      !key.startsWith("item_currency_mismatch:") &&
      !key.startsWith("currency_conflict_item:")
    ) {
      return false;
    }
    return parseCurrencyReviewService(key) === serviceKey;
  });
}

function reviewReasonAppliesToItem(
  reason: any,
  item: any,
  data?: any,
): boolean {
  const key = String(reason || "");
  const serviceName = normalizeSearchText(
    normalizeServiceNameForDisplay(item?.serviceName),
  );
  const reasonService = parseCurrencyReviewService(key);

  if (reasonService)
    return Boolean(serviceName && reasonService === serviceName);

  // Global currency_review darf nur alle Positionen blockieren, wenn keine
  // item_currency_mismatch-Zeilen vorhanden sind. Sonst blockiert nur die
  // betroffene Position.
  if (key.startsWith("currency_")) {
    return hasGlobalCurrencyReviewWithoutItemDetails(data || {});
  }

  return true;
}

function isBlockedAmountReviewItemForPersist(item: any, data?: any): boolean {
  const itemIsManuallyConfirmed = isItemManuallyConfirmedForPersist(item);
  const globalReviewReasons = Array.isArray(data?.reviewReasons)
    ? data.reviewReasons.filter((reason: any) =>
        itemIsManuallyConfirmed
          ? false
          : reviewReasonAppliesToItem(reason, item, data),
      )
    : [];
  const itemHasCurrencyMismatch =
    !itemIsManuallyConfirmed &&
    hasCurrencyMismatchReviewForService(data || {}, item?.serviceName);
  const globalCurrencyReviewApplies =
    hasGlobalCurrencyReviewWithoutItemDetails(data || {}) &&
    !itemIsManuallyConfirmed;
  const reviewText = [
    item?.unit,
    item?.description,
    item?.sourceText,
    item?.evidence,
    item?.reviewReason,
    ...globalReviewReasons,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const quantity = Number(item?.quantity ?? 0);
  const unitPrice = Number(item?.unitPrice ?? 0);
  const storedTotal = Number(item?.totalPrice ?? 0);
  const hasTrustedNumericAmount =
    quantity > 0 &&
    unitPrice > 0 &&
    (storedTotal > 0 || quantity * unitPrice > 0) &&
    !/währung\/preis\s+noch\s+nicht\s+bestätigt|waehrung\/preis\s+noch\s+nicht\s+bestaetigt|currency\s+not\s+confirmed/i.test(reviewText);

  return (
    itemHasCurrencyMismatch ||
    globalCurrencyReviewApplies ||
    /einheit\s+(?:fehlt|offen|unklar|pr[üu]fen|muss)/i.test(reviewText) ||
    /unit\s+(?:missing|open|unknown|unclear|review)/i.test(reviewText) ||
    /unit_missing_in_text|unit_mismatch:/i.test(reviewText) ||
    /preis\s+(?:fehlt|offen|pr[üu]fen)/i.test(reviewText) ||
    (!hasTrustedNumericAmount && /preis\s+unklar/i.test(reviewText)) ||
    /price\s+(?:missing|open|review)/i.test(reviewText) ||
    (!hasTrustedNumericAmount && /price\s+unclear/i.test(reviewText)) ||
    (!hasTrustedNumericAmount && /price_unclear:|unit_price_review/i.test(reviewText)) ||
    /menge\s+(?:fehlt|offen|unklar|pr[üu]fen)/i.test(reviewText) ||
    /quantity\s+(?:missing|open|unknown|unclear|review)/i.test(reviewText) ||
    /quantity_review/i.test(reviewText) ||
    (!itemIsManuallyConfirmed &&
      /currency_review|currency_conflict|currency_unsupported|item_currency_mismatch|currency_conflict_item/i.test(
        reviewText,
      ))
  );
}

function hasUnitMissingReviewForItem(data: any, item: any): boolean {
  const reasons = Array.isArray(data?.reviewReasons) ? data.reviewReasons : [];
  return reasons.some((reason: any) => {
    const key = String(reason || "");
    return key.startsWith("unit_missing_in_text:") && reviewReasonAppliesToItem(reason, item, data);
  });
}

function getDisplaySafeItemForOrder(item: any, orderLike: any) {
  const unitMissing = hasUnitMissingReviewForItem(orderLike || {}, item);
  return {
    ...item,
    unit: unitMissing ? "Einheit prüfen" : item?.unit,
    unitPrice: Number(item?.unitPrice ?? 0),
    quantity: Number(item?.quantity ?? 0),
    totalPrice: getItemNetTotalForOrder(item, orderLike || {}),
  };
}

function hasCompleteManualItemsForPersist(data: any): boolean {
  if (hasCurrencyConflictReviewOnOrderLike(data || {})) return false;

  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) return false;

  return items.every((item: any) => {
    const unit = normalizeSearchText(item?.unit);
    const unitPrice = Number(item?.unitPrice ?? 0);
    const quantity = Number(item?.quantity ?? 0);
    return (
      String(item?.serviceName || "").trim().length > 0 &&
      unit.length > 0 &&
      !unit.includes("pruefen") &&
      !unit.includes("prufen") &&
      unitPrice > 0 &&
      quantity > 0
    );
  });
}

function getManuallyConfirmedServiceNamesForPersist(data: any): Set<string> {
  const items = Array.isArray(data?.items) ? data.items : [];
  return new Set(
    items
      .filter((item: any) => isItemManuallyConfirmedForPersist(item))
      .map((item: any) =>
        normalizeSearchText(normalizeServiceNameForDisplay(item?.serviceName)),
      )
      .filter(Boolean),
  );
}

function isReviewReasonResolvedByConfirmedItemForPersist(
  reason: string,
  data: any,
): boolean {
  const key = String(reason || "");
  const parts = key.split(":");
  const serviceName = normalizeSearchText(
    normalizeServiceNameForDisplay(parts[1] || ""),
  );
  if (!serviceName) return false;
  if (!getManuallyConfirmedServiceNamesForPersist(data).has(serviceName))
    return false;
  return (
    key.startsWith("price_unclear:") ||
    key.startsWith("price_override:") ||
    key.startsWith("item_currency_mismatch:") ||
    key.startsWith("currency_conflict_item:")
  );
}

function hasCompleteManualItemsIgnoringCurrencyForPersist(data: any): boolean {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (items.length === 0) return false;

  return items.every((item: any) => {
    const unit = normalizeSearchText(item?.unit);
    const unitPrice = Number(item?.unitPrice ?? 0);
    const quantity = Number(item?.quantity ?? 0);
    return (
      String(item?.serviceName || "").trim().length > 0 &&
      unit.length > 0 &&
      !unit.includes("pruefen") &&
      !unit.includes("prufen") &&
      unitPrice > 0 &&
      quantity > 0
    );
  });
}

function shouldTrustClientItemValuesForPersist(data: any): boolean {
  return (
    data?.manualReviewResolved === true ||
    data?.manualItemValuesConfirmed === true ||
    hasCompleteManualItemsForPersist(data)
  );
}

function normalizeItemsForPersist(items: any[] | undefined, data: any) {
  if (!Array.isArray(items)) return undefined;
  const source = getOrderSourceTextForItems(data);
  const trustClientItemValues = shouldTrustClientItemValuesForPersist(data);

  const normalized = items.map((item: any) => {
    const serviceName = normalizeServiceNameForDisplay(item?.serviceName);
    const sourceLine = trustClientItemValues
      ? ""
      : findSourceLineForItem(source, { ...item, serviceName });
    const sourcePrice = trustClientItemValues
      ? null
      : extractUnitPriceFromSourceLine(sourceLine, { ...item, serviceName });
    const reviewText = [
      item?.description,
      ...(Array.isArray(data?.reviewReasons) ? data.reviewReasons : []),
    ]
      .filter(Boolean)
      .join(" ");
    const itemManuallyConfirmed = isItemManuallyConfirmedForPersist(item);
    const forceMissingPriceReview =
      !trustClientItemValues &&
      !itemManuallyConfirmed &&
      !sourcePrice &&
      /preis\s+im\s+text\s+unklar|price_unclear|unit_price_review/i.test(
        reviewText,
      );
    let unitPrice = trustClientItemValues
      ? Number(item?.unitPrice ?? 0)
      : forceMissingPriceReview
        ? 0
        : sourcePrice && Number(item?.unitPrice ?? 0) <= 0
          ? sourcePrice
          : Number(item?.unitPrice ?? 0);
    let quantity = Number(item?.quantity ?? 1);
    let unit = item?.unit;

    if (serviceName === "Anfahrt") {
      unit = "Pauschal";
      quantity = 1;
      // V17.14: Bei manueller Bereinigung bleibt der Editorwert maßgeblich.
      // Alte Textzeilen wie "Anfahrt CHF 50" dürfen einen bewusst gesetzten
      // Zielpreis in EUR/CHF nicht mehr überschreiben.
      if (
        !trustClientItemValues &&
        sourcePrice &&
        sourcePrice > 0 &&
        Number(item?.unitPrice ?? 0) <= 0
      ) {
        unitPrice = sourcePrice;
      }
    }

    const amountBlocked = trustClientItemValues
      ? false
      : isBlockedAmountReviewItemForPersist(
          { ...item, serviceName, unit, unitPrice, quantity },
          data,
        );

    return {
      ...item,
      serviceName,
      unit,
      unitPrice:
        amountBlocked && hasCurrencyConflictReviewOnOrderLike(data)
          ? 0
          : unitPrice,
      quantity,
      totalPrice: amountBlocked
        ? 0
        : Number(item?.totalPrice ?? unitPrice * quantity),
    };
  });

  return repairZeroQuantityHourItemsFromText(normalized, source, {
    logPrefix: "[OrdersRouteNormalizeHourFixV17_06]",
    skipFlatFeeRepair: trustClientItemValues || hasClientItemsPayload(data),
  }).items;
}

function isRouteOnlyWorkSiteOrServiceHintV17_33(line: string): boolean {
  const raw = String(line || "")
    .replace(/\s+/g, " ")
    .trim();
  const text = normalizeSearchText(raw);
  if (!raw || !text) return true;

  const startsAsWorkSite =
    /^\s*(?:arbeitsort|ausfuehrungsort|ausführungsort|einsatzort|objekt|baustelle)\s*:/i.test(
      raw,
    );
  const hasAddressEvidence =
    /\b\d{4,5}\b/.test(raw) ||
    /\b(?:strasse|straße|str\.?|weg|gasse|platz|allee|ring|rain|halde|steig|route|rue|avenue|av\.?|chemin|via|viale|street|road|lane)\s+\d+[a-z]?\b/i.test(
      raw,
    );
  const hasOperationalSignal =
    /\b(?:schluessel|schlussel|schlüssel|key|code|torcode|zugangscode|schluesselbox|schlusselbox|schlüsselbox|briefkasten|hund|dog|chien|leiter|sms|whatsapp|telefon|anrufen|nicht\s+einfach|vorher|termin|parkplatz|parking)\b/.test(
      text,
    );
  if ((startsAsWorkSite || hasAddressEvidence) && !hasOperationalSignal)
    return true;

  const hasWorkAction =
    /(?:\b|[a-z])(?:reinigen|reinigung|gereinigt|putzen|saeubern|säubern|clean(?:ing)?|nettoyage|nettoyer|pulizia|limpieza)\b/.test(
      text,
    );
  const hasMeasureOrPrice =
    /\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|laufmeter|stunden?|std|stueck|stück|stk|pcs?|chf|eur|euro|franken|stutz)\b/i.test(
      raw,
    ) ||
    /\(\s*\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|quadratmeter|meter|stueck|stück|stk)\s*\)/i.test(
      raw,
    ) ||
    /\b(?:chf|eur|euro|franken|stutz)\s*\d/i.test(raw);
  const actionCount = (
    text.match(
      /(?:\b|[a-z])(?:reinigen|reinigung|gereinigt|putzen|saeubern|säubern|clean(?:ing)?|nettoyage|nettoyer|pulizia|limpieza)\b/g,
    ) || []
  ).length;
  const hasListSeparator = /[,;+]/.test(raw);
  const hasServiceListSummary =
    hasListSeparator &&
    actionCount >= 1 &&
    /\b(?:anfahrt|fahrtkosten|fahrt|pauschale)\b/.test(text);
  if (
    hasWorkAction &&
    !hasOperationalSignal &&
    (hasMeasureOrPrice ||
      (hasListSeparator && actionCount >= 2) ||
      hasServiceListSummary)
  )
    return true;

  return false;
}

function extractExactOperationalHints(data: any) {
  const source = [data?.notes, data?.audioTranscript, data?.specialNotes]
    .filter(Boolean)
    .join("\n");
  if (!source) return [];

  return Array.from(
    new Set(
      source
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split(/\n+/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter(
          (line) =>
            !/^\[Titel\s*:/i.test(line) && !/^\[Priorität\s*:/i.test(line),
        )
        .filter((line) => {
          const text = normalizeSearchText(line);
          if (!text) return false;
          if (isRouteOnlyWorkSiteOrServiceHintV17_33(line)) return false;
          return (
            /nicht\s+anrufen|keine?\s+telefonische|kein\s+telefon|mail\s+reicht|e\s*mail\s+reicht|nur\s+(?:per\s+)?(?:mail|whats\s*app|sms)|whats\s*app(?:\s+nummer)?|\bsms\b/.test(
              text,
            ) ||
            /(?:bitte\s+)?(?:kurz\s+)?(?:anrufen|telefonieren|zurueckrufen|zuruckrufen|rueckrufen|ruckrufen|alueute|aluete|alute)\b/.test(
              text,
            ) ||
            /(?:nach|ab|erst\s+nach)\s*\d{1,2}(?::\d{2})?\s*(?:uhr)?\s*(?:anrufen|telefonieren|kontaktieren|melden|alueute|aluete|alute)/.test(
              text,
            ) ||
            /termin.*(?:klaeren|klaren|abstimmen|vereinbaren|abmachen|melden|ruecksprache|rucksprache|vorschlagen)|(?:ruecksprache|rucksprache|melden|abmachen|vorschlagen).*termin/.test(
              text,
            ) ||
            /\b\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?\b.*(?:bestaetigen|bestätigen|falls|waere|wäre|geht|passt|confirm)/i.test(
              line,
            ) ||
            /hund|dog|chien|perro|cane|leiter|schluessel|schlussel|key|rezeption|reception|zugang|hintereingang|seiteneingang|side entrance|park/.test(
              text,
            )
          );
        })
        .map((line) =>
          line.replace(/^\s*(?:whatsapp|telegram)\s*:\s*/i, "").trim(),
        ),
    ),
  );
}

function hasExplicitPriceCurrencySignal(data: any) {
  const source = [
    data?.notes,
    data?.description,
    data?.serviceName,
    data?.specialNotes,
    data?.audioTranscript,
    ...(Array.isArray(data?.items)
      ? data.items.flatMap((item: any) => [
          item?.serviceName,
          item?.description,
          item?.unitPrice,
        ])
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  const normalized = normalizeSearchText(source);
  return (
    /\b(chf|franken|stutz|sfr|eur|euro)\b|€|\.\-/.test(normalized) ||
    /€/.test(source)
  );
}

function normalizeReviewReasonsForPersist(data: any) {
  const reasons = Array.isArray(data?.reviewReasons)
    ? data.reviewReasons.filter(Boolean)
    : undefined;
  if (!reasons) return undefined;

  const items = Array.isArray(data?.items) ? data.items : [];
  const hasExplicitPriceSignal = hasExplicitPriceCurrencySignal(data);
  const allItemsComplete = hasCompleteManualItemsForPersist(data);
  const allItemsCompleteIgnoringCurrency =
    hasCompleteManualItemsIgnoringCurrencyForPersist(data);

  const firstPass = reasons.filter((reason: string) => {
    const key = String(reason || "");

    if (isReviewReasonResolvedByConfirmedItemForPersist(key, data)) {
      return false;
    }

    if (
      allItemsComplete &&
      !hasCurrencyConflictReviewOnOrderLike(data || {}) &&
      (key.startsWith("price_unclear:") ||
        key === "unit_price_review" ||
        key === "quantity_review" ||
        key === "manual_flat_service_from_text" ||
        key === "stunden_arbeitsposition_pruefen")
    ) {
      return false;
    }

    if (!key.startsWith("price_unclear:")) return true;
    const [, serviceName = ""] = key.split(":");
    const item = items.find(
      (candidate: any) =>
        normalizeSearchText(candidate?.serviceName) ===
        normalizeSearchText(serviceName),
    );
    if (!item) return true;
    const hasPrice =
      Number(item?.unitPrice || 0) > 0 && Number(item?.quantity || 0) > 0;
    return !(hasPrice && hasExplicitPriceSignal);
  });

  const hasRemainingItemCurrencyReview = firstPass.some((reason: string) => {
    const key = String(reason || "");
    return (
      key.startsWith("item_currency_mismatch:") ||
      key.startsWith("currency_conflict_item:")
    );
  });

  return firstPass.filter((reason: string) => {
    const key = String(reason || "");
    if (
      allItemsCompleteIgnoringCurrency &&
      !hasRemainingItemCurrencyReview &&
      (key === "currency_review" || key === "currency_conflict")
    ) {
      return false;
    }
    return true;
  });
}

const semanticNoteMatches: SemanticNoteMatch[] = [
  {
    label: "Gefährlicher Hund vor Ort",
    type: "safety",
    patterns: [
      /\bhund\b.*\b(?:bellt|frei|laeuft|läuft|aggressiv|beisst|beißt|beissen|beißen|achtung|warnung|gefahr|tuer\s+zu|türe\s+zu|tuer\s+geschlossen|türe\s+geschlossen|tor\s+geschlossen|geschlossen\s+halten)\b/,
      /\b(?:bellt|frei|laeuft|läuft|aggressiv|beisst|beißt|beissen|beißen|achtung|warnung|gefahr|tuer\s+zu|türe\s+zu|tuer\s+geschlossen|türe\s+geschlossen|tor\s+geschlossen|geschlossen\s+halten)\b.*\bhund\b/,
      /\bchien\b.*\b(?:attention|cour|portail|fermer|dangereux|agressif|aboie)\b/,
      /\b(?:attention|cour|portail|fermer|dangereux|agressif|aboie)\b.*\bchien\b/,
      /\bdog\b.*\b(?:barks|free|loose|aggressive|danger|warning|bite|biting)\b/,
      /\b(?:barks|free|loose|aggressive|danger|warning|bite|biting)\b.*\bdog\b/,
    ],
  },
  {
    label: "Hund vor Ort",
    type: "hint",
    patterns: [
      /\bhund\b/,
      /\bdog\b/,
      /\bchien\b/,
      /\bperro\b/,
      /\bcane\b/,
      /\bcao\b/,
      /\bpis\b/,
    ],
  },
  {
    label: "Rutschiger Boden wegen Öl",
    type: "safety",
    patterns: [
      /\b(oel|ol|oil|aceite|huile|olio|oleo)\b.*\b(rutsch|slippery|glissant|resbaladiz|scivolos|escorregadi)/,
      /\b(rutsch|slippery|glissant|resbaladiz|scivolos|escorregadi)\b.*\b(oel|ol|oil|aceite|huile|olio|oleo)\b/,
    ],
  },
  {
    label: "Rutschiger Boden",
    type: "safety",
    patterns: [
      /\brutsch/,
      /\bslippery\b/,
      /\bglissant\b/,
      /\bresbaladiz/,
      /\bscivolos/,
      /\bescorregadi/,
      /\bnasser boden\b/,
      /\bwet floor\b/,
      /\bsuelo mojado\b/,
      /\bsol mouille\b/,
      /\bpavimento bagnato\b/,
    ],
  },
  {
    label: "Öl vor Ort prüfen",
    type: "safety",
    patterns: [/\b(oel|ol|oil|aceite|huile|olio|oleo)\b/],
  },
  {
    label: "Offene Stromkabel / Stromgefahr",
    type: "safety",
    patterns: [
      /\bstromkabel\b/,
      /\boffene kabel\b/,
      /\belektr.*kabel\b/,
      /\belectric(al)? wires?\b/,
      /\bexposed wires?\b/,
      /\bcables? electricos?\b/,
      /\bcables? electriques?\b/,
      /\bcavi elettric/,
      /\bcabos? eletric/,
      /\bcorriente\b/,
    ],
  },
  {
    label: "Gas-/Rauchgeruch prüfen",
    type: "safety",
    patterns: [
      /\bgasgeruch\b/,
      /\bgas smell\b/,
      /\bsmell of gas\b/,
      /\bolor a gas\b/,
      /\bodeur de gaz\b/,
      /\bodore di gas\b/,
      /\brauchgeruch\b/,
      /\bsmoke smell\b/,
      /\bodeur de fumee\b/,
    ],
  },
  {
    label: "Brand-/Feuergefahr",
    type: "safety",
    patterns: [
      /\bbrandgefahr\b/,
      /\bfeuergefahr\b/,
      /\bfire hazard\b/,
      /\brisk of fire\b/,
      /\bpeligro de incendio\b/,
      /\brisque d incendie\b/,
      /\bpericolo di incendio\b/,
      /\brisco de incendio\b/,
    ],
  },
  {
    label: "Sturzgefahr",
    type: "safety",
    patterns: [
      /\bsturzgefahr\b/,
      /\babsturzgefahr\b/,
      /\bfall hazard\b/,
      /\brisk of falling\b/,
      /\briesgo de caida\b/,
      /\brisque de chute\b/,
      /\brischio di caduta\b/,
      /\brisco de queda\b/,
    ],
  },
  {
    label: "Scherben / Schnittgefahr",
    type: "safety",
    patterns: [
      /\bscherben\b/,
      /\bglasscherben\b/,
      /\bbroken glass\b/,
      /\bshards?\b/,
      /\bvidrios? rotos?\b/,
      /\bverre casse\b/,
      /\bvetro rotto\b/,
      /\bvidro quebrado\b/,
    ],
  },
  {
    label: "Asbestverdacht",
    type: "safety",
    patterns: [/\basbest\b/, /\basbestos\b/, /\bamiante\b/, /\bamianto\b/],
  },
  {
    label: "Schimmel / Gesundheitsgefahr",
    type: "safety",
    patterns: [
      /\bschimmel\b/,
      /\bmold\b/,
      /\bmould\b/,
      /\bmoho\b/,
      /\bmoisi/,
      /\bmuffa\b/,
      /\bbolor\b/,
    ],
  },
  {
    label: "Chemikalien vor Ort",
    type: "safety",
    patterns: [
      /\bchemikal/,
      /\bchemical/,
      /\bquimic/,
      /\bchimic/,
      /\bproduit chimique\b/,
      /\bproducto quimico\b/,
    ],
  },
  {
    label: "Instabile Bauteile / Einsturzgefahr",
    type: "safety",
    patterns: [
      /\beinsturzgefahr\b/,
      /\binstabil/,
      /\bunstable\b/,
      /\bcollapse risk\b/,
      /\briesgo de derrumbe\b/,
      /\brisque d effondrement\b/,
      /\brischio di crollo\b/,
      /\brisco de colapso\b/,
    ],
  },
  {
    label: "Leiter eventuell benötigt",
    type: "hint",
    patterns: [
      /\bleiter\b/,
      /\bladder\b/,
      /\bescalera\b/,
      /\bechelle\b/,
      /\bscala\b/,
      /\bescada\b/,
    ],
  },
  {
    label: "Rückruf vor Arbeitsbeginn",
    type: "hint",
    patterns: [
      /\bruckruf\b/,
      /\bzuruckrufen\b/,
      /\banrufen\b/,
      /\bcall back\b/,
      /\bplease call\b/,
      /\bllamar\b/,
      /\bdevolver la llamada\b/,
      /\brappeler\b/,
      /\brichiamare\b/,
      /\bligar de volta\b/,
    ],
  },
  {
    label: "Schwieriger Zugang",
    type: "hint",
    patterns: [
      /\bschwieriger zugang\b/,
      /\bschwer zuganglich\b/,
      /\bkein lift\b/,
      /\bohne lift\b/,
      /\bdifficult access\b/,
      /\bno elevator\b/,
      /\bno lift\b/,
      /\bdificil acceso\b/,
      /\bsin ascensor\b/,
      /\bacces difficile\b/,
      /\bsans ascenseur\b/,
      /\baccesso difficile\b/,
      /\bsem elevador\b/,
    ],
  },
  {
    label: "Zugang über Seiteneingang",
    type: "hint",
    patterns: [
      /\bseiteneingang\b/,
      /\bside entrance\b/,
      /\bentrada lateral\b/,
      /\bentree laterale\b/,
      /\bingresso laterale\b/,
    ],
  },
  {
    label: "Parkplatz prüfen",
    type: "hint",
    patterns: [
      /\bparkplatz\b/,
      /\bparking\b/,
      /\baparcamiento\b/,
      /\bestacionamento\b/,
      /\bparcheggio\b/,
    ],
  },
  {
    label: "Schlüssel / Zugang klären",
    type: "hint",
    patterns: [
      /\bschlussel\b/,
      /\bkey\b/,
      /\bllave\b/,
      /\bcle\b/,
      /\bchiave\b/,
      /\bchave\b/,
    ],
  },
  {
    label: "Termin klären",
    type: "hint",
    patterns: [
      /\btermin\s+(?:klaeren|klaren|abstimmen|vereinbaren)\b/,
      /\b(?:melden|kontaktieren|anrufen|schreiben)\b.*\btermin\b/,
      /\btermin\b.*\b(?:melden|kontaktieren|abstimmen|vereinbaren|klaeren|klaren)\b/,
      /\bappointment\s+(?:to\s+schedule|to\s+arrange|arrange|schedule)\b/,
      /\bschedule\b.*\bappointment\b/,
      /\bcita\b/,
      /\brendez vous\b/,
      /\bappuntamento\b/,
      /\bagendamento\b/,
    ],
  },
  {
    label: "Nicht anrufen, E-Mail reicht",
    type: "hint",
    patterns: [
      /nicht\s+anrufen.*(?:mail|e-?mail)|(?:mail|e-?mail).*nicht\s+anrufen/i,
      /keine?\s+telefonische\s+rücksprache.*(?:mail|e-?mail)|(?:mail|e-?mail).*keine?\s+telefonische\s+rücksprache/i,
      /nur\s+(?:per\s+)?(?:mail|e-?mail)|(?:mail|e-?mail)\s+reicht/i,
    ],
  },
  {
    label: "Keine telefonische Rückfrage",
    type: "hint",
    patterns: [
      /bitte\s+keine?\s+telefonische\s+r[uü]ckfrage/i,
      /keine?\s+telefonische\s+r[uü]ckfrage/i,
      /nicht\s+telefonisch/i,
      /nicht\s+anrufen/i,
      /pas\s+par\s+t[eé]l[eé]phone/i,
      /no\s+calls?/i,
    ],
  },
  {
    label: "WhatsApp bevorzugt",
    type: "hint",
    patterns: [/whats\s*app/i],
  },
  {
    label: "SMS bevorzugt",
    type: "hint",
    patterns: [/\bsms\b/i],
  },
  {
    label: "Hanglage",
    type: "hint",
    patterns: [
      /\bhanglage\b/,
      /\bhang\b/,
      /\bslope\b/,
      /\bsteep\b/,
      /\bpendiente\b/,
      /\bpente\b/,
      /\bpendio\b/,
    ],
  },
];

function detectSemanticNotes(source: unknown) {
  const text = normalizeSearchText(source);
  const safetyWarnings: string[] = [];
  const jobHints: string[] = [];

  if (!text) return { safetyWarnings, jobHints };

  for (const match of semanticNoteMatches) {
    if (match.patterns.some((pattern) => pattern.test(text))) {
      if (match.type === "safety") safetyWarnings.push(match.label);
      else jobHints.push(match.label);
    }
  }

  return {
    safetyWarnings: Array.from(new Set(safetyWarnings)),
    jobHints: Array.from(new Set(jobHints)),
  };
}

function normalizeOrderSpecialNotes(data: any) {
  const parsed = splitSpecialNotes(data?.specialNotes);
  const exactOperationalHints = extractExactOperationalHints(data);
  const detectedSemanticNotes = detectSemanticNotes(
    [data?.specialNotes, data?.audioTranscript, ...exactOperationalHints]
      .filter(Boolean)
      .join("\n"),
  );
  const detectedSafetyOnly = detectedSemanticNotes.safetyWarnings;
  const detectedJobHints = detectedSemanticNotes.jobHints;

  const existingSafety = parsed.safetyWarnings.flatMap((line) => {
    const detectedLine = detectSemanticNotes(line).safetyWarnings;
    return detectedLine.length > 0 ? detectedLine : [line];
  });

  const existingJobHints = parsed.jobHints.flatMap((line) => {
    const detectedLine = detectSemanticNotes(line);
    if (detectedLine.safetyWarnings.length > 0) return [];
    return detectedLine.jobHints.length > 0 ? detectedLine.jobHints : [line];
  });

  const nextSafetyWarnings = Array.from(
    new Set([...existingSafety, ...detectedSafetyOnly]),
  );
  const nextJobHints = Array.from(
    new Set([
      ...existingJobHints,
      ...detectedJobHints,
      ...exactOperationalHints,
    ]),
  );

  if (
    nextSafetyWarnings.length === 0 &&
    nextJobHints.length === 0 &&
    parsed.systemHints.length === 0
  ) {
    return data?.specialNotes ?? null;
  }

  return buildSpecialNotes({
    safetyWarnings: nextSafetyWarnings,
    jobHints: nextJobHints,
    systemHints: parsed.systemHints,
  });
}

/**
 * VAT persistence on Order (since 2026-04-18):
 *   - vatRate / vatAmount / total are stored columns (see prisma/schema.prisma).
 *   - totalPrice remains the NETTO subtotal (unchanged meaning).
 *   - For legacy orders that existed before the VAT columns were added, the
 *     column defaults (8.1 / 0 / 0) mean `vatAmount` and `total` may be 0 even
 *     though `totalPrice` has a value. We compute a safe fallback on read so
 *     old rows display correctly without rewriting them.
 */
function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function calculateVatTotals(netValue: number, vatRateValue: number) {
  const totalPrice = roundMoney(Number(netValue ?? 0));
  const vatRate =
    Number.isFinite(vatRateValue) && vatRateValue > 0 ? vatRateValue : 0;
  const vatAmount = roundMoney((totalPrice * vatRate) / 100);
  const total = roundMoney(totalPrice + vatAmount);

  return {
    totalPrice,
    vatRate,
    vatAmount,
    total,
  };
}

function getItemNetTotalForOrder(item: any, orderLike?: any): number {
  // V17.80: Harte Prüfpositionen (Einheit/Preis/Menge/Währung offen) dürfen
  // niemals über ein altes stored total oder quantity × price in Netto/MwSt./Total
  // zurücklaufen. Das gilt auch dann, wenn item.totalPrice fälschlich > 0 ist.
  if (isBlockedAmountReviewItemForPersist(item, orderLike || {})) return 0;

  const quantity = Number(item?.quantity ?? 0);
  const unitPrice = Number(item?.unitPrice ?? 0);
  const storedTotal = Number(item?.totalPrice ?? 0);
  const calculated = quantity > 0 && unitPrice > 0 ? quantity * unitPrice : 0;
  const lineTotal = storedTotal > 0 ? storedTotal : calculated;

  return Number.isFinite(lineTotal) && lineTotal > 0 ? lineTotal : 0;
}

function calculateItemsNetTotal(o: any): number | null {
  const items = Array.isArray(o?.items) ? o.items : [];
  if (items.length === 0) return null;

  // V17.20: Nicht mehr wegen eines globalen Mischwährungs-ReviewReasons
  // pauschal 0 zurückgeben. Unbestätigte Positionen werden schon mit
  // unitPrice/totalPrice 0 persistiert; manuell bestätigte Positionen sollen
  // sofort in Außenkarte und API-Response zählen.
  const net = items.reduce(
    (sum: number, item: any) => sum + getItemNetTotalForOrder(item, o),
    0,
  );

  // Wenn Positionen vorhanden sind, sind sie Source of Truth. Auch 0 ist dann
  // ein gültiges Ergebnis, damit rote Prüfpositionen nicht über stale
  // Order.totalPrice oder quantity × price wieder in die Summe laufen.
  return roundMoney(net);
}

function getOrderNetTotalForResponse(o: any): number {
  return calculateItemsNetTotal(o) ?? roundMoney(Number(o?.totalPrice ?? 0));
}

function normalizeOrderVat(o: any) {
  const totalPrice = getOrderNetTotalForResponse(o);
  const vatRate = o?.vatRate == null ? 8.1 : Number(o.vatRate);
  // If item rows exist, they are the source of truth for card/detail totals.
  // This prevents stale Order.totalPrice values from hiding repaired hour lines.
  const computed = calculateVatTotals(totalPrice, vatRate);

  return {
    vatRate: computed.vatRate,
    vatAmount: computed.vatAmount,
    total: computed.total,
  };
}

export async function GET(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams?.get("status");
    const where: any = { deletedAt: null, userId };
    if (status && status !== "Alle") where.status = status;
    const orders = await prisma.order.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            plz: true,
            city: true,
            customerNumber: true,
          },
        },
        items: { include: { workSite: true } },
        workSites: true,
      },
    });

    const safeOrders = await Promise.all(
      (orders ?? []).map(async (order: any) => {
        if (!shouldRunPersistedHourRepairForOrder(order)) return order;

        const repaired = await repairPersistedOrderZeroHourItemsFromText({
          prisma,
          order,
          originalText: getOrderSourceTextForItems(order),
          logPrefix: "[OrdersRouteGetHourFixV17_09_GET_ON_DEMAND]",
        });
        return repaired.order || order;
      }),
    );

    return NextResponse.json(
      safeOrders?.map((o: any) => ({
        ...o,
        description: stripInternalTitleLinesFromText(o?.description),
        notes: stripInternalTitleLinesFromText(o?.notes) || null,
        specialNotes: stripInternalTitleLinesFromText(o?.specialNotes) || null,
        audioTranscript:
          stripInternalTitleLinesFromText(o?.audioTranscript) || null,
        totalPrice: getOrderNetTotalForResponse(o),
        unitPrice: Number(o?.unitPrice ?? 0),
        quantity: Number(o?.quantity ?? 0),
        ...normalizeOrderVat(o),
        items: (o?.items ?? []).map((item: any) =>
          getDisplaySafeItemForOrder(item, o),
        ),
      })) ?? [],
    );
  } catch (error: any) {
    console.error(error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const rawData = await request.json();
    const data = {
      ...rawData,
      description: stripInternalTitleLinesFromText(rawData?.description),
      notes: stripInternalTitleLinesFromText(rawData?.notes),
      specialNotes: stripInternalTitleLinesFromText(rawData?.specialNotes),
      audioTranscript: stripInternalTitleLinesFromText(
        rawData?.audioTranscript,
      ),
    };
    const normalizedSpecialNotes = normalizeOrderSpecialNotes(data);
    const hasNormalizedSafetyWarnings =
      splitSpecialNotes(normalizedSpecialNotes).safetyWarnings.length > 0;
    const requestedCurrency =
      data?.currency === "EUR"
        ? "EUR"
        : data?.currency === "CHF"
          ? "CHF"
          : undefined;
    const currency =
      inferExplicitCurrencyFromPayload(data) || requestedCurrency || "CHF";
    const normalizedReviewReasonsForRequest =
      data?.reviewReasons !== undefined
        ? normalizeReviewReasonsForPersist(data)
        : undefined;
    const dataForPersist =
      data?.reviewReasons !== undefined
        ? { ...data, reviewReasons: normalizedReviewReasonsForRequest ?? [] }
        : data;
    const rawItems = data?.items as any[] | undefined;
    const items = normalizeItemsForPersist(rawItems, dataForPersist);
    let totalPrice = 0;
    let primaryServiceName = data?.serviceName ?? null;
    let primaryPriceType = data?.priceType ?? "Stunde";
    let primaryUnitPrice = Number(data?.unitPrice ?? 0);
    let primaryQuantity = Number(data?.quantity ?? 1);
    if (items && items.length > 0) {
      totalPrice = items.reduce(
        (sum: number, item: any) => sum + getItemNetTotalForOrder(item, dataForPersist),
        0,
      );
      primaryServiceName = normalizeServiceNameForDisplay(
        items[0].serviceName ?? primaryServiceName,
      );
      primaryPriceType = items[0].unit ?? primaryPriceType;
      primaryUnitPrice = Number(items[0].unitPrice ?? 0);
      primaryQuantity = Number(items[0].quantity ?? 1);
    } else {
      totalPrice = primaryQuantity * primaryUnitPrice;
    }
    // Resolve VAT: client-provided value wins; else fall back to CompanySettings;
    // else default 8.1 (current Swiss standard). A value of 0 means VAT disabled.
    let vatRate = 8.1;
    if (data?.vatRate !== undefined && data.vatRate !== null) {
      vatRate = Number(data.vatRate);
    } else {
      try {
        const settings = await prisma.companySettings.findFirst({
          where: { userId },
        });
        if (settings?.mwstAktiv && settings?.mwstSatz != null)
          vatRate = Number(settings.mwstSatz);
        else if (settings && !settings.mwstAktiv) vatRate = 0;
      } catch {}
    }
    if (!isFinite(vatRate) || vatRate < 0) vatRate = 0;
    const calculatedTotals = calculateVatTotals(totalPrice, vatRate);
    totalPrice = calculatedTotals.totalPrice;
    vatRate = calculatedTotals.vatRate;
    const vatAmount = calculatedTotals.vatAmount;
    const total = calculatedTotals.total;
    // Guard: reject creation linked to an archived customer
    if (data?.customerId) {
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    let order = await prisma.order.create({
      data: {
        customerId: data?.customerId,
        description: data?.description ?? "",
        serviceName: normalizeServiceNameForDisplay(primaryServiceName),
        status: data?.status ?? "Offen",
        priceType: primaryPriceType,
        unitPrice: primaryUnitPrice,
        quantity: primaryQuantity,
        totalPrice,
        vatRate,
        vatAmount,
        total,
        currency,
        siteAddressDifferent: Boolean(data?.siteAddressDifferent),
        siteName: cleanWorkSiteDisplayName(data?.siteName),
        siteAddress: data?.siteAddress?.trim() || null,
        sitePlz: data?.sitePlz?.trim() || null,
        siteCity: data?.siteCity?.trim() || null,
        siteNote: data?.siteNote?.trim() || null,
        date: data?.date ? new Date(data.date) : new Date(),
        notes: data?.notes || null,
        specialNotes: normalizedSpecialNotes,
        needsReview:
          data?.needsReview !== undefined ? Boolean(data.needsReview) : false,
        reviewReasons:
          normalizedReviewReasonsForRequest ??
          (Array.isArray(data?.reviewReasons)
            ? data.reviewReasons.filter(Boolean)
            : []),
        hinweisLevel:
          data?.hinweisLevel ??
          (hasNormalizedSafetyWarnings ? "warning" : "none"),
        mediaUrl: data?.mediaUrl ?? null,
        mediaType: data?.mediaType ?? null,
        imageUrls: data?.imageUrls ?? [],
        audioTranscript: data?.audioTranscript || null,
        userId,
        ...(items && items.length > 0
          ? {
              items: {
                create: items.map((item: any) => ({
                  serviceName: normalizeServiceNameForDisplay(item.serviceName),
                  description: item.description ?? "",
                  quantity: Number(item.quantity ?? 1),
                  unit: item.unit ?? "Stunde",
                  unitPrice: Number(item.unitPrice ?? 0),
                  totalPrice: getItemNetTotalForOrder(item, { ...data, reviewReasons: normalizedReviewReasonsForRequest ?? data?.reviewReasons }),
                })),
              },
            }
          : {}),
      },
      include: {
        customer: true,
        items: { include: { workSite: true } },
        workSites: true,
      },
    });

    // V16.37: If this browser/API path created an order linked to a blank
    // customer, persist an explicit nameless "Rechnung an:" block from the
    // original order text onto that customer. This does not touch real named
    // customers and never reads the execution address block.
    if (data?.customerId) {
      const explicitBillingAddress =
        extractNamelessBillingAddressFromOrderPayloadV1637(
          data?.notes,
          data?.description,
          data?.audioTranscript,
          data?.specialNotes,
        );

      if (explicitBillingAddress) {
        const linkedCustomer = await prisma.customer.findUnique({
          where: { id: data.customerId },
          select: {
            id: true,
            name: true,
            address: true,
            plz: true,
            city: true,
            phone: true,
            email: true,
          },
        });

        const customerNameMissing = !String(linkedCustomer?.name || "").trim();
        const customerAddressMissing =
          !String(linkedCustomer?.address || "").trim() &&
          !String(linkedCustomer?.plz || "").trim() &&
          !String(linkedCustomer?.city || "").trim();

        if (linkedCustomer && customerNameMissing && customerAddressMissing) {
          const customerUpdate: Record<string, string> = {};
          if (explicitBillingAddress.street)
            customerUpdate.address = explicitBillingAddress.street;
          if (explicitBillingAddress.plz)
            customerUpdate.plz = explicitBillingAddress.plz;
          if (explicitBillingAddress.city)
            customerUpdate.city = explicitBillingAddress.city;
          if (explicitBillingAddress.phone && !linkedCustomer.phone)
            customerUpdate.phone = explicitBillingAddress.phone;
          if (explicitBillingAddress.email && !linkedCustomer.email)
            customerUpdate.email = explicitBillingAddress.email;

          if (Object.keys(customerUpdate).length > 0) {
            await prisma.customer.update({
              where: { id: linkedCustomer.id },
              data: customerUpdate,
            });

            order =
              (await prisma.order.findUnique({
                where: { id: order.id },
                include: {
                  customer: true,
                  items: { include: { workSite: true } },
                  workSites: true,
                },
              })) ?? order;
          }
        }
      }
    }

    const persistedHourRepair = await repairPersistedOrderZeroHourItemsFromText(
      {
        prisma,
        order,
        originalText: getOrderSourceTextForItems(data),
        logPrefix: "[OrdersRoutePostHourFixV17_06]",
      },
    );
    if (persistedHourRepair.repairedCount > 0 && persistedHourRepair.order) {
      order = persistedHourRepair.order;
    }

    // V17.68/V17.70: Vollständige Ausführungsadressen zusätzlich dauerhaft am
    // Kunden merken. Dadurch bleiben frühere Arbeitsorte auch dann verfügbar,
    // wenn ein Auftrag später gelöscht, weitergeführt oder archiviert wird.
    const rememberedExecutionAddressCount =
      await rememberExecutionAddressesFromOrder(prisma, { userId, order });

    // V17.70: zusätzlicher Create-Pfad für WhatsApp-/Intake-Texte. Falls die
    // UI-/Order-Felder den erkannten Ausführungsort beim direkten POST noch
    // nicht vollständig enthalten, wird ein klarer "Ausführung:"-Block aus dem
    // Originaltext strukturell gelesen und direkt am Kunden gespeichert. Keine
    // Service-Wortliste: nur Adressmarker, Strasse, PLZ/Ort und Preis-/Rechen-
    // Stopps.
    const explicitExecutionAddress =
      extractExplicitExecutionAddressFromOrderPayloadV17_70(
        data?.notes,
        data?.description,
        data?.audioTranscript,
        data?.specialNotes,
      );

    if (
      explicitExecutionAddress &&
      data?.customerId &&
      !hasUnresolvedExecutionAddressRoleReviewV17_70(order) &&
      !isSameExecutionAsBillingV17_70(order, explicitExecutionAddress)
    ) {
      try {
        await rememberCustomerExecutionAddress(prisma, {
          customerId: data.customerId,
          userId,
          ...explicitExecutionAddress,
        });
      } catch (error) {
        console.warn(
          "[CustomerExecutionAddressV17_70] Explicit execution address persist failed",
          error,
        );
      }
    }

    if (rememberedExecutionAddressCount > 0 || explicitExecutionAddress) {
      order =
        (await prisma.order.findUnique({
          where: { id: order.id },
          include: {
            customer: true,
            items: { include: { workSite: true } },
            workSites: true,
          },
        })) ?? order;
    }

    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: "ORDER_CREATE",
      area: "ORDERS",
      targetType: "Order",
      targetId: order.id,
      request,
    });
    return NextResponse.json({
      ...order,
      description: stripInternalTitleLinesFromText(order?.description),
      notes: stripInternalTitleLinesFromText(order?.notes) || null,
      specialNotes:
        stripInternalTitleLinesFromText(order?.specialNotes) || null,
      audioTranscript:
        stripInternalTitleLinesFromText(order?.audioTranscript) || null,
      totalPrice: Number(order?.totalPrice ?? 0),
      unitPrice: Number(order?.unitPrice ?? 0),
      quantity: Number(order?.quantity ?? 0),
      vatRate: Number(order?.vatRate ?? 0),
      vatAmount: Number(order?.vatAmount ?? 0),
      total: Number(order?.total ?? 0),
      currency: order?.currency === "EUR" ? "EUR" : "CHF",
      items: (order?.items ?? []).map((item: any) => ({
        ...item,
        unitPrice: Number(item?.unitPrice ?? 0),
        quantity: Number(item?.quantity ?? 0),
        totalPrice: Number(item?.totalPrice ?? 0),
      })),
    });
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json(
      { error: "Fehler beim Erstellen" },
      { status: 500 },
    );
  }
}
