import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildSpecialNotes,
  splitSpecialNotes,
} from "@/lib/special-notes-utils";

interface MergeRequest {
  targetOrderId: string;
  sourceOrderIds: string[];
  finalCustomerId?: string;
}

interface MergeWorkSiteInput {
  key: string;
  siteName: string | null;
  siteAddress: string | null;
  sitePlz: string | null;
  siteCity: string | null;
  siteNote: string | null;
  sortOrder: number;
  isPrimary: boolean;
  sourceOrderId: string | null;
}

interface MergeItemInput {
  serviceName: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  aiWarning?: string | null;
  reviewReasons?: string[] | null;
  workSiteKey: string;
  sourceOrderId: string;
}

const normalizeMergeKeyPart = (value?: string | null) =>
  (value || "").trim().replace(/\s+/g, " ").toLowerCase();

const normalizeServiceKey = (value?: string | null) =>
  normalizeMergeKeyPart(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

const canonicalMergeServiceName = (value?: string | null) => {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  const key = normalizeServiceKey(name);

  if (
    /\b(anfahrt|anfahrt pauschal|fahrtkosten|fahrkosten|fahrpauschale|wegpauschale|deplacement|travel fee|travel cost|travel costs|trip fee|transport fee|trasferta|transferta|viaje)\b/i.test(
      key,
    )
  ) {
    return "Anfahrt";
  }

  if (
    /\b(clean floor|floor cleaning|bodenreinigung|boden reinigen|nettoyage du sol|nettoyage sol|pulizia pavimento|pulizia del pavimento|limpieza suelo|limpieza de suelo)\b/i.test(
      key,
    )
  ) {
    return "Boden reinigen";
  }

  if (
    /\b(clean windows|window cleaning|windows cleaning|fensterreinigung|fenster reinigen|nettoyage des vitres|nettoyage vitres|nettoyage des vitrines|nettoyage vitrines|vitres|vitrines|fenetres|pulizia finestre|pulizia delle finestre|limpieza ventanas|limpieza de ventanas)\b/i.test(
      key,
    )
  ) {
    return "Fenster reinigen";
  }

  return name;
};

const normalizeVatRate = (value?: number | string | null) => {
  const rate = Number(value || 0);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(rate * 100) / 100;
};

const getVatRateKey = (order: { vatRate?: number | string | null }) =>
  normalizeVatRate(order.vatRate).toFixed(2);

const formatVatRateLabel = (rate: number) => {
  if (rate <= 0) return "keine MwSt";

  return `${rate.toLocaleString("de-CH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} % MwSt`;
};

const buildVatMismatchNote = (targetOrder: any, sourceOrders: any[]) => {
  const allOrders = [targetOrder, ...sourceOrders];
  const vatKeys = new Set(allOrders.map(getVatRateKey));

  if (vatKeys.size <= 1) return "";

  const targetVatRate = normalizeVatRate(targetOrder.vatRate);
  const sourceLabels = sourceOrders.map((order, index) => {
    const rate = normalizeVatRate(order.vatRate);
    return `Quelle ${index + 1}: ${formatVatRateLabel(rate)}`;
  });

  return [
    "MwSt prüfen: Die verbundenen Aufträge hatten unterschiedliche MwSt-Einstellungen.",
    `Der verbundene Auftrag verwendet den MwSt-Satz des Hauptauftrags: ${formatVatRateLabel(targetVatRate)}.`,
    sourceLabels.join("; "),
    "Bitte vor Angebot oder Rechnung prüfen.",
  ]
    .filter(Boolean)
    .join(" ");
};

const uniqueTrimmedLines = (lines: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const cleaned = String(line || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(cleaned);
  }

  return result;
};

const cleanSiteValue = (value?: string | null) => {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (/^ausführungsadresse$/i.test(cleaned)) return null;
  if (/^ausfuehrungsadresse$/i.test(cleaned)) return null;
  return cleaned;
};

const siteKey = (site: {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
}) =>
  [site.siteName, site.siteAddress, site.sitePlz, site.siteCity]
    .map((value) => normalizeMergeKeyPart(value))
    .filter(Boolean)
    .join("|");

const siteLines = (site: {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
}) =>
  [
    cleanSiteValue(site.siteName),
    cleanSiteValue(site.siteAddress),
    [cleanSiteValue(site.sitePlz), cleanSiteValue(site.siteCity)]
      .filter(Boolean)
      .join(" "),
    cleanSiteValue(site.siteNote),
  ]
    .map((line) => String(line || "").trim())
    .filter(Boolean);

const fallbackSiteForOrder = (order: any): MergeWorkSiteInput => {
  const base = {
    siteName: cleanSiteValue(order.siteName),
    siteAddress: cleanSiteValue(order.siteAddress),
    sitePlz: cleanSiteValue(order.sitePlz),
    siteCity: cleanSiteValue(order.siteCity),
    siteNote: cleanSiteValue(order.siteNote),
  };

  const hasOrderSite = Boolean(
    base.siteName ||
    base.siteAddress ||
    base.sitePlz ||
    base.siteCity ||
    base.siteNote,
  );

  const site = hasOrderSite
    ? base
    : {
        siteName: null,
        siteAddress: cleanSiteValue(order.customer?.address),
        sitePlz: cleanSiteValue(order.customer?.plz),
        siteCity: cleanSiteValue(order.customer?.city),
        siteNote: null,
      };

  const key = siteKey(site) || `order:${order.id}`;

  return {
    key,
    ...site,
    sortOrder: 0,
    isPrimary: false,
    sourceOrderId: order.id,
  };
};

const getOrderSites = (order: any): MergeWorkSiteInput[] => {
  if (Array.isArray(order.workSites) && order.workSites.length > 0) {
    return order.workSites
      .slice()
      .sort(
        (a: any, b: any) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
      )
      .map((site: any, index: number) => {
        const normalized = {
          siteName: cleanSiteValue(site.siteName),
          siteAddress: cleanSiteValue(site.siteAddress),
          sitePlz: cleanSiteValue(site.sitePlz),
          siteCity: cleanSiteValue(site.siteCity),
          siteNote: cleanSiteValue(site.siteNote),
        };

        return {
          key:
            siteKey(normalized) || `worksite:${site.id || order.id}:${index}`,
          ...normalized,
          sortOrder: index,
          isPrimary: Boolean(site.isPrimary),
          sourceOrderId: site.sourceOrderId || order.id,
        };
      });
  }

  return [fallbackSiteForOrder(order)];
};

const getPrimarySiteForOrder = (order: any) => {
  const sites = getOrderSites(order);
  return sites.find((site) => site.isPrimary) || sites[0];
};

const getItemSiteKey = (order: any, item: any) => {
  if (item?.workSite) {
    const normalized = {
      siteName: cleanSiteValue(item.workSite.siteName),
      siteAddress: cleanSiteValue(item.workSite.siteAddress),
      sitePlz: cleanSiteValue(item.workSite.sitePlz),
      siteCity: cleanSiteValue(item.workSite.siteCity),
      siteNote: cleanSiteValue(item.workSite.siteNote),
    };
    return siteKey(normalized) || `worksite:${item.workSite.id}`;
  }

  return getPrimarySiteForOrder(order).key;
};

const buildItemMergeKey = (item: MergeItemInput) => {
  return [
    item.workSiteKey,
    normalizeMergeKeyPart(item.serviceName),
    normalizeMergeKeyPart(item.unit),
    Number(item.unitPrice || 0).toFixed(2),
  ].join("|");
};


const orderItemLooksLikeWorksiteOnlyArtifact = (order: any, item: any) => {
  const serviceName = normalizeServiceKey(item?.serviceName || item?.description || "");
  if (serviceName !== "eingangsbereich reinigen") return false;

  const source = [order?.notes, order?.description, order?.specialNotes, order?.audioTranscript]
    .filter(Boolean)
    .join("\n");
  const lines = source
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  // Keep a real priced Eingangsbereich service only if it appears as its own
  // service line. A line such as "Ausführung: Haus B, Keller und Eingangsbereich"
  // is an address/site label and must not become a service.
  return !lines.some((line) => {
    const text = normalizeServiceKey(line);
    if (!text || /^\s*\[?\s*(?:titel|title)\s*:/i.test(line)) return false;
    if (/^(?:ausfuehrung|ausfuehrungsadresse|arbeitsort|einsatzort|objekt)\b/.test(text)) return false;
    return (
      /\beingangsbereich\b/.test(text) &&
      /\b(reinigen|reinigung|putzen|clean|nettoyage|limpieza|pulizia)\b/.test(text) &&
      (/\b\d+(?:[.,]\d+)?\s*(?:m2|m²|qm|stk|stueck|stuck|stück|pcs|piece|pieces)\b/.test(text) || /\b(?:chf|eur|franken|stutz)\b|€/.test(text))
    );
  });
};

const toMergeItem = (order: any, item: any): MergeItemInput => {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);

  const serviceName = canonicalMergeServiceName(
    item.serviceName || item.description || "Manuell prüfen",
  );

  return {
    serviceName,
    description: item.description || serviceName || "",
    quantity,
    unit: item.unit || "Stück",
    unitPrice,
    totalPrice: quantity * unitPrice,
    aiWarning: item.aiWarning || null,
    reviewReasons: item.reviewReasons || [],
    workSiteKey: getItemSiteKey(order, item),
    sourceOrderId: order.id,
  };
};

const mergeOrderItems = (orders: any[]) => {
  const merged = new Map<string, MergeItemInput>();

  for (const order of orders) {
    for (const rawItem of order.items || []) {
      if (orderItemLooksLikeWorksiteOnlyArtifact(order, rawItem)) continue;
      const item = toMergeItem(order, rawItem);
      const hasUnsafeMerge =
        item.aiWarning?.trim() ||
        item.reviewReasons?.some((r) => r.startsWith("unit_mismatch:")) ||
        Number(item.quantity || 0) <= 0 ||
        Number(item.unitPrice || 0) <= 0;

      const key = hasUnsafeMerge
        ? `${buildItemMergeKey(item)}|${order.id}|${rawItem.id || Math.random()}`
        : buildItemMergeKey(item);

      const existing = merged.get(key);

      if (existing && !hasUnsafeMerge) {
        const quantity = existing.quantity + item.quantity;

        merged.set(key, {
          ...existing,
          quantity,
          totalPrice: quantity * existing.unitPrice,
          description:
            existing.description === item.description
              ? existing.description
              : [existing.description, item.description]
                  .filter(Boolean)
                  .filter((v, i, arr) => arr.indexOf(v) === i)
                  .join("\n"),
        });
      } else {
        merged.set(key, item);
      }
    }
  }

  return Array.from(merged.values());
};

const buildWorkSiteGroups = (orders: any[]) => {
  const groups = new Map<string, MergeWorkSiteInput>();

  orders.forEach((order, orderIndex) => {
    getOrderSites(order).forEach((site, siteIndex) => {
      const key = site.key || `order:${order.id}:${siteIndex}`;
      if (groups.has(key)) return;

      groups.set(key, {
        ...site,
        key,
        sortOrder: groups.size,
        isPrimary: orderIndex === 0 && (site.isPrimary || siteIndex === 0),
        sourceOrderId: site.sourceOrderId || order.id,
      });
    });
  });

  const values = Array.from(groups.values());
  if (!values.some((site) => site.isPrimary) && values[0]) {
    values[0].isPrimary = true;
  }
  return values;
};

const buildExecutionAddressMismatchNote = (workSites: MergeWorkSiteInput[]) => {
  if (workSites.length <= 1) return "";

  const lines = workSites.map((site, index) => {
    const label = siteLines(site).join(", ") || "nicht angegeben";
    return `${index + 1}. ${label}`;
  });

  return [
    "Mehrere Ausführungsorte: Die verbundenen Aufträge haben unterschiedliche Arbeitsorte.",
    "Die Leistungen bleiben nach Ausführungsort getrennt gespeichert und müssen vor Angebot/Rechnung/PDF geprüft werden.",
    lines.join("; "),
  ]
    .filter(Boolean)
    .join(" ");
};

const MERGE_CONTACT_DATA_PATTERN =
  /whatsapp|sms|mail|e-?mail|telefon|telefonisch|anruf|anrufen|rückruf|rueckruf|ruckruf|termin|uhr|appointment|call|no calls?|nicht anrufen|keine telefonische/i;

const MERGE_PHONE_PATTERN = /\+?\d[\d\s()./-]{6,}\d/g;

const mergeSiteLabelForOrder = (order: any) => {
  const site = getPrimarySiteForOrder(order);
  const lines = siteLines(site);
  const title = lines[0] || cleanSiteValue(order?.customer?.name) || "Quellauftrag";
  const address = lines.slice(1).join(", ");
  return [title, address].filter(Boolean).join(" · ");
};

const mergeContactDataSummary = (orders: any[]) => {
  const phoneSet = new Set<string>();
  let contactLines = 0;
  let appointmentLines = 0;
  let communicationLines = 0;

  for (const order of orders) {
    const split = splitSpecialNotes(order.specialNotes || "");
    const combinedText = [
      order?.customer?.phone,
      order?.notes,
      order?.specialNotes,
      order?.audioTranscript,
    ]
      .filter(Boolean)
      .join("\n");

    for (const match of combinedText.matchAll(MERGE_PHONE_PATTERN)) {
      const normalized = String(match[0] || "").replace(/\D/g, "");
      if (normalized.length >= 7) phoneSet.add(normalized);
    }

    for (const line of split.jobHints) {
      if (!MERGE_CONTACT_DATA_PATTERN.test(line)) continue;
      contactLines += 1;
      if (/termin|uhr|appointment/i.test(line)) appointmentLines += 1;
      if (/whatsapp|sms|mail|e-?mail|telefon|anruf|anrufen|rückruf|rueckruf|ruckruf|call|no calls?|nicht anrufen|keine telefonische/i.test(line)) {
        communicationLines += 1;
      }
    }
  }

  return {
    phoneCount: phoneSet.size,
    contactLines,
    appointmentLines,
    communicationLines,
    hasMultipleData:
      orders.length > 1 &&
      (phoneSet.size > 1 ||
        contactLines > 1 ||
        appointmentLines > 1 ||
        communicationLines > 1),
  };
};

const extractMergeContactHintsFromRawText = (order: any) => {
  const source = [order?.notes, order?.audioTranscript]
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  if (!source.trim()) return [];

  const rawParts = source
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const result: string[] = [];

  for (const line of rawParts) {
    if (/^\s*\[?\s*(?:titel|title)\s*:/i.test(line)) continue;
    if (/^(?:rechnung|rechnung an|facturation|ausführung|ausfuehrung|adresse travaux|arbeitsort|leistung|leistungen)\s*:?$/i.test(line)) continue;

    if (/bitte\s+nicht\s+anrufen|nicht\s+anrufen|keine\s+telefonische\s+rückfrage|keine\s+telefonische\s+rueckfrage|no\s+calls?\s+during|no\s+phone\s+calls?/i.test(line)) {
      result.push(line);
      continue;
    }

    if (/(?:whatsapp|sms)\s+(?:ist\s+)?(?:am\s+besten|bevorzugt|preferred)|(?:whatsapp|sms)\s*(?:nummer)?\s*[:.]?\s*\+?\d/i.test(line)) {
      result.push(line);
      continue;
    }

    if (/(?:mail|e-?mail)\s+reicht|nur\s+per\s+(?:mail|e-?mail)|per\s+(?:mail|e-?mail)\s+abstimmen/i.test(line)) {
      result.push(line);
      continue;
    }

    if (/termin\s+(?:noch\s+)?(?:offen|abstimmen|vereinbaren|klären|klaeren)|rücksprache\s+wegen\s+termin|ruecksprache\s+wegen\s+termin/i.test(line)) {
      result.push(line);
      continue;
    }

    if (/(?:vor\s+arbeitsbeginn|nach\s+\d{1,2}(?::|\.)?\d{0,2}\s*(?:uhr|h)?|erst\s+ab\s+\d{1,2})\s+.*(?:anrufen|zurückrufen|zurueckrufen)|(?:anrufen|zurückrufen|zurueckrufen).*?(?:nach|ab|erst\s+ab)\s+\d{1,2}/i.test(line)) {
      result.push(line);
    }
  }

  return uniqueTrimmedLines(result);
};


const looksLikeMergeSitePrefix = (value?: string | null) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\b\d{4}\b/.test(text)) return true;
  if (/\b(?:haus|gebäude|gebaeude|restaurant|küche|kueche|entrée|entree|technopark|limmatweg|chemin|strasse|straße|weg|gasse|platz)\b/i.test(text)) return true;
  return /\s·\s/.test(text);
};

const splitExistingMergeSitePrefix = (value?: string | null) => {
  let siteLabel: string | null = null;
  let text = String(value || "").replace(/\s+/g, " ").trim();

  // Lines can already be prefixed from an earlier merge, sometimes even twice:
  // "Haus A · ...: Haus B · ...: SMS ...". Keep the innermost real site label.
  for (let pass = 0; pass < 4; pass += 1) {
    const match = text.match(/^([^:]{2,180}):\s+(.+)$/);
    if (!match || !looksLikeMergeSitePrefix(match[1])) break;
    siteLabel = match[1].trim();
    text = match[2].trim();
  }

  return { siteLabel, text };
};

const normalizeMergeHintGerman = (value?: string | null) => {
  let text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[-•]\s*/, "")
    .replace(/^Kontakt vor Ort:\s*Grund:\s*/i, "")
    .replace(/^Grund:\s*/i, "")
    .trim();

  if (!text) return "";

  text = text
    .replace(/^No calls during office hours\.?$/i, "Keine Anrufe während der Bürozeiten.")
    .replace(/^Use WhatsApp if possible:\s*/i, "WhatsApp bevorzugt: ")
    .replace(/^Accès uniquement par l[’']entrée arrière\.?$/i, "Zugang nur über den Hintereingang.")
    .replace(/^Clé à la réception\.?$/i, "Schlüssel an der Rezeption.")
    .replace(/\bNutzung von WhatsApp gewünscht\b/i, "bitte WhatsApp verwenden")
    .replace(/\bNicht telefonisch zurückrufen\b/i, "Bitte nicht anrufen.")
    .replace(/\bKeine telefonischen Anrufe\b/i, "Keine Anrufe")
    .replace(/\bMail reicht, bitte keine telefonische Rückfrage\.?$/i, "Mail reicht; bitte keine telefonische Rückfrage.")
    .replace(/\bTermin noch offen, bitte per E-Mail abstimmen\.?$/i, "Termin noch offen; bitte per E-Mail abstimmen.")
    .replace(/\s+([.,;:!?])$/g, "$1")
    .trim();

  return text;
};

const normalizeSearchText = (value?: string | null) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9+\s:./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const mergeHintSemanticKey = (value?: string | null) => {
  const text = normalizeSearchText(value);
  if (!text) return "";
  if (/whatsapp/.test(text)) return "communication_whatsapp";
  if (/\bsms\b/.test(text)) return "communication_sms";
  if (/nicht anrufen|keine telefonische|kein telefon|no calls/.test(text)) return "communication_no_call";
  if (/mail|email|e mail|e-mail/.test(text) && /termin/.test(text)) return "appointment_email";
  if (/mail|email|e mail|e-mail/.test(text)) return "communication_email";
  if (/rueckruf|ruckruf|anruf|anrufen|telefon/.test(text) && /17\s*30|17:30|17\.30|erst ab|nach/.test(text)) return "callback_time";
  if (/rueckruf|ruckruf|anruf|anrufen|telefon/.test(text)) return "callback";
  if (/termin/.test(text)) return "appointment";
  if (/schluessel|schlussel|key|rezeption|hauswart/.test(text)) return "key";
  if (/zugang|hintereingang|eingang|access/.test(text)) return "access";
  if (/park/.test(text)) return "parking";
  if (/vormittag/.test(text)) return "time_morning";
  if (/nachmittag|hauswart/.test(text)) return "time_afternoon";
  return text;
};

const mergeHintSpecificityScore = (value?: string | null) => {
  const text = normalizeSearchText(value);
  let score = text.length;
  if (/\+?\d[\d\s()./-]{6,}\d/.test(String(value || ""))) score += 80;
  if (/nicht anrufen|keine telefonische|no calls/.test(text)) score += 60;
  if (/whatsapp|sms/.test(text)) score += 40;
  if (/termin noch offen|per e mail abstimmen/.test(text)) score += 30;
  return score;
};

const buildGroupedMergeSpecialNoteHints = (orders: any[], extraJobHints: string[] = []) => {
  const grouped = new Map<string, Map<string, string>>();
  const add = (siteLabel: string, hint: string) => {
    const cleanedSite = String(siteLabel || "Quellauftrag").replace(/\s+/g, " ").trim();
    const cleanedHint = normalizeMergeHintGerman(hint);
    if (!cleanedSite || !cleanedHint) return;
    if (/^Mehrere Telefonnummern, Termine oder Kontaktwege erkannt/i.test(cleanedHint)) return;

    const key = mergeHintSemanticKey(cleanedHint);
    if (!key) return;

    const bucket = grouped.get(cleanedSite) || new Map<string, string>();
    const previous = bucket.get(key);
    if (!previous || mergeHintSpecificityScore(cleanedHint) > mergeHintSpecificityScore(previous)) {
      bucket.set(key, cleanedHint);
    }
    grouped.set(cleanedSite, bucket);
  };

  for (const order of orders) {
    const split = splitSpecialNotes(order.specialNotes || "");
    const fallbackSiteLabel = mergeSiteLabelForOrder(order);
    const sourceHints = uniqueTrimmedLines([
      ...split.jobHints,
      ...extractMergeContactHintsFromRawText(order),
    ]);

    for (const hint of sourceHints) {
      const parsed = splitExistingMergeSitePrefix(hint);
      add(parsed.siteLabel || fallbackSiteLabel, parsed.text);
    }
  }

  const lines: string[] = [];
  for (const [siteLabel, hints] of grouped.entries()) {
    const values = Array.from(hints.values());
    if (values.length === 0) continue;
    lines.push(`${siteLabel}:`);
    values.forEach((hint) => lines.push(`- ${hint}`));
  }

  extraJobHints
    .map((hint) => normalizeMergeHintGerman(hint))
    .filter(Boolean)
    .forEach((hint) => lines.push(hint));

  if (mergeContactDataSummary(orders).hasMultipleData) {
    lines.push(
      "Mehrere Telefonnummern, Termine oder Kontaktwege erkannt. Bitte die gruppierten Besonderheiten manuell prüfen.",
    );
  }

  return uniqueTrimmedLines(lines);
};

const mergeSpecialNotes = (orders: any[], extraJobHints: string[] = []) => {
  const safetyWarnings: string[] = [];
  const systemHints: string[] = [];
  const hasMultipleOrders = orders.length > 1;

  for (const order of orders) {
    const split = splitSpecialNotes(order.specialNotes || "");
    safetyWarnings.push(...split.safetyWarnings);
    systemHints.push(...split.systemHints);
  }

  if (hasMultipleOrders) {
    return buildSpecialNotes({
      safetyWarnings: uniqueTrimmedLines(safetyWarnings),
      jobHints: buildGroupedMergeSpecialNoteHints(orders, extraJobHints),
      systemHints: uniqueTrimmedLines(systemHints),
    });
  }

  const jobHints: string[] = [];
  for (const order of orders) {
    const split = splitSpecialNotes(order.specialNotes || "");
    jobHints.push(
      ...uniqueTrimmedLines([
        ...split.jobHints,
        ...extractMergeContactHintsFromRawText(order),
      ]).map((hint) => normalizeMergeHintGerman(hint)),
    );
  }
  jobHints.push(...extraJobHints.map((hint) => normalizeMergeHintGerman(hint)));

  return buildSpecialNotes({
    safetyWarnings: uniqueTrimmedLines(safetyWarnings),
    jobHints: uniqueTrimmedLines(jobHints),
    systemHints: uniqueTrimmedLines(systemHints),
  });
};

const getOriginOrderIds = (order: any) => {
  const existing = Array.isArray(order.originOrderIds)
    ? order.originOrderIds
        .map((id: unknown) => String(id || "").trim())
        .filter(Boolean)
    : [];
  return existing.length > 0 ? existing : [order.id];
};

const compactMergeText = (text: string) => {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^\s*WhatsApp:\s*\n?/gim, "")
    .replace(/\[Verbunden von Auftrag [^\]]+\]/g, "")
    .replace(/^\s*Hauptauftrag:\s*/im, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Nicht authentifiziert" },
        { status: 401 },
      );
    }

    const body: MergeRequest = await request.json();
    const { targetOrderId, sourceOrderIds, finalCustomerId } = body;

    if (!targetOrderId || !sourceOrderIds || !Array.isArray(sourceOrderIds)) {
      return NextResponse.json(
        { error: "Ungültige Parameter" },
        { status: 400 },
      );
    }

    if (sourceOrderIds.length === 0) {
      return NextResponse.json(
        { error: "Mindestens ein Quell-Auftrag erforderlich" },
        { status: 400 },
      );
    }

    if (sourceOrderIds.includes(targetOrderId)) {
      return NextResponse.json(
        { error: "Ziel-Auftrag darf nicht in Quell-Aufträgen enthalten sein" },
        { status: 400 },
      );
    }

    const userId = session.user.id;

    const result = await prisma.$transaction(async (tx) => {
      const orderInclude = {
        customer: true,
        workSites: true,
        items: { include: { workSite: true } },
      } as const;

      const targetOrder = await tx.order.findUnique({
        where: { id: targetOrderId },
        include: orderInclude,
      });

      if (!targetOrder) {
        throw new Error("Ziel-Auftrag nicht gefunden");
      }

      if (targetOrder.userId !== userId) {
        throw new Error("Keine Berechtigung für diesen Auftrag");
      }

      if (targetOrder.deletedAt) {
        throw new Error(
          "Gelöschte Aufträge können nicht zusammengeführt werden",
        );
      }

      const sourceOrders = await tx.order.findMany({
        where: {
          id: { in: sourceOrderIds },
          userId,
          deletedAt: null,
        },
        include: orderInclude,
      });

      if (sourceOrders.length !== sourceOrderIds.length) {
        throw new Error(
          "Einige Quell-Aufträge wurden nicht gefunden oder gehören nicht Ihnen",
        );
      }

      const allOrders = [targetOrder, ...sourceOrders];
      const originOrderIds = Array.from(
        new Set(allOrders.flatMap(getOriginOrderIds)),
      );

      if (originOrderIds.length > 5) {
        throw new Error(
          `Zusammenführen nicht möglich: Dieser Merge würde ${originOrderIds.length} Ursprungsaufträge enthalten. Maximal erlaubt sind 5.`,
        );
      }

      const hasInvoiceOrOffer =
        sourceOrders.some((o) => o.invoiceId || o.offerId) ||
        targetOrder.invoiceId ||
        targetOrder.offerId;

      if (hasInvoiceOrOffer) {
        throw new Error(
          "Aufträge mit Rechnungen oder Angeboten können nicht zusammengeführt werden",
        );
      }

      const ordersWithAudio = allOrders.filter(
        (order) => order.mediaUrl && order.mediaType === "audio",
      );

      if (ordersWithAudio.length > 1) {
        throw new Error(
          "Mehrere Aufträge mit Audio erkannt. Bitte nur einen Audio-Auftrag auswählen.",
        );
      }

      const targetHasAudio =
        targetOrder.mediaUrl && targetOrder.mediaType === "audio";
      const sourceWithAudio = sourceOrders.find(
        (order) => order.mediaUrl && order.mediaType === "audio",
      );

      let audioData: Record<string, unknown> = {};

      if (sourceWithAudio && !targetHasAudio) {
        audioData = {
          mediaUrl: sourceWithAudio.mediaUrl,
          mediaType: sourceWithAudio.mediaType,
          audioTranscript: sourceWithAudio.audioTranscript,
          audioDurationSec: sourceWithAudio.audioDurationSec,
          audioTranscriptionStatus: sourceWithAudio.audioTranscriptionStatus,
        };
      }

      const allCustomerIds = [
        targetOrder.customerId,
        ...sourceOrders.map((o) => o.customerId),
      ];

      const safeFinalCustomerId =
        finalCustomerId && allCustomerIds.includes(finalCustomerId)
          ? finalCustomerId
          : targetOrder.customerId;

      const uniqueCustomerIds = [...new Set(allCustomerIds)];
      const hasCustomerMismatch = uniqueCustomerIds.length > 1;

      const currencies = Array.from(
        new Set(allOrders.map((order) => (order.currency || "CHF").trim())),
      );

      if (currencies.length > 1) {
        throw new Error(
          "Aufträge mit unterschiedlichen Währungen können nicht verbunden werden",
        );
      }

      const vatKeys = new Set(allOrders.map(getVatRateKey));
      const hasVatMismatch = vatKeys.size > 1;
      const vatMismatchNote = buildVatMismatchNote(targetOrder, sourceOrders);

      const workSiteGroups = buildWorkSiteGroups(allOrders);
      if (workSiteGroups.length > 5) {
        throw new Error(
          `Zusammenführen nicht möglich: ${workSiteGroups.length} unterschiedliche Arbeitsorte erkannt. Maximal erlaubt sind 5.`,
        );
      }

      const hasExecutionAddressMismatch = workSiteGroups.length > 1;

      const hasDoubleMerge = allOrders.some(
        (o) =>
          o.reviewReasons?.includes("manual_order_merge") ||
          getOriginOrderIds(o).length > 1,
      );

      const mergedImageUrls = [
        ...(targetOrder.imageUrls || []),
        ...sourceOrders.flatMap((o) => o.imageUrls || []),
      ];

      const mergedThumbnailUrls = [
        ...(targetOrder.thumbnailUrls || []),
        ...sourceOrders.flatMap((o) => o.thumbnailUrls || []),
      ];

      const additionalNotes = sourceOrders
        .filter((o) => !o.reviewReasons?.includes("image_only_no_text"))
        .map((o) => {
          const originalText = compactMergeText(
            o.notes || o.audioTranscript || "",
          );
          const parts: string[] = [];

          parts.push("────────────");
          parts.push("Zusammengeführt mit:");
          parts.push("");

          if (originalText) {
            parts.push(originalText);
          }

          return parts.join("\n").trim();
        })
        .filter(Boolean)
        .join("\n");

      const mergedNotes = [
        "Hauptauftrag:",
        "",
        compactMergeText(targetOrder.notes || ""),
        additionalNotes,
      ]
        .filter((part) => part !== undefined && part !== null && part !== "")
        .join("\n");

      const mergedItems = mergeOrderItems(allOrders);
      const mergedSpecialNotes = mergeSpecialNotes(
        allOrders,
        [vatMismatchNote].filter(Boolean),
      );

      const totalPrice = mergedItems.reduce(
        (sum, item) => sum + Number(item.totalPrice || 0),
        0,
      );

      const vatRate = Number(targetOrder.vatRate || 0);
      const vatAmount = vatRate > 0 ? (totalPrice * vatRate) / 100 : 0;
      const total = totalPrice + vatAmount;

      const newReviewReasons = [
        ...(targetOrder.reviewReasons || []),
        "manual_order_merge",
      ];

      if (hasCustomerMismatch)
        newReviewReasons.push("merged_different_customers");
      if (hasVatMismatch) newReviewReasons.push("vat_mismatch");
      if (hasExecutionAddressMismatch)
        newReviewReasons.push("merged_different_execution_addresses");
      if (mergeContactDataSummary(allOrders).hasMultipleData)
        newReviewReasons.push("merged_multiple_contact_data");
      if (hasDoubleMerge) newReviewReasons.push("double_merge");
      if (mergedItems.some((item) => Number(item.unitPrice || 0) <= 0)) {
        newReviewReasons.push("unit_price_review");
      }

      sourceOrders.forEach((o) => {
        if (o.reviewReasons) newReviewReasons.push(...o.reviewReasons);
      });

      const uniqueReviewReasons = [...new Set(newReviewReasons)];

      await tx.orderItem.deleteMany({ where: { orderId: targetOrderId } });
      await tx.orderWorkSite.deleteMany({ where: { orderId: targetOrderId } });

      const primarySite =
        workSiteGroups.find((site) => site.isPrimary) || workSiteGroups[0];
      const createdWorkSiteByKey = new Map<string, string>();

      for (const [index, site] of workSiteGroups.entries()) {
        const created = await tx.orderWorkSite.create({
          data: {
            orderId: targetOrderId,
            siteName: site.siteName,
            siteAddress: site.siteAddress,
            sitePlz: site.sitePlz,
            siteCity: site.siteCity,
            siteNote: site.siteNote,
            isPrimary: site.key === primarySite?.key,
            sortOrder: index,
            sourceOrderId: site.sourceOrderId,
          },
        });
        createdWorkSiteByKey.set(site.key, created.id);
      }

      const updatedOrder = await tx.order.update({
        where: { id: targetOrderId },
        data: {
          customerId: safeFinalCustomerId || targetOrder.customerId,
          imageUrls: mergedImageUrls,
          thumbnailUrls: mergedThumbnailUrls,
          notes: mergedNotes,
          specialNotes: mergedSpecialNotes,
          reviewReasons: uniqueReviewReasons,
          needsReview: true,
          hinweisLevel: "warning",
          totalPrice,
          vatAmount,
          total,
          originOrderIds,
          siteAddressDifferent: Boolean(primarySite),
          siteName: primarySite?.siteName || null,
          siteAddress: primarySite?.siteAddress || null,
          sitePlz: primarySite?.sitePlz || null,
          siteCity: primarySite?.siteCity || null,
          siteNote: primarySite?.siteNote || null,
          items: {
            create: mergedItems.map((item) => ({
              serviceName: item.serviceName,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              workSiteId: createdWorkSiteByKey.get(item.workSiteKey) || null,
            })),
          },
          ...audioData,
          audioTranscript:
            targetOrder.audioTranscript || sourceWithAudio
              ? mergedNotes
              : targetOrder.audioTranscript,
        },
        include: {
          items: { include: { workSite: true } },
          workSites: true,
          customer: true,
        },
      });

      await tx.order.updateMany({
        where: { id: { in: sourceOrderIds } },
        data: { deletedAt: new Date() },
      });

      return {
        success: true,
        mergedOrder: updatedOrder,
        mergedCount: sourceOrders.length,
        mergedItemsCount: mergedItems.length,
        hasDoubleMerge,
        hasCustomerMismatch,
        hasVatMismatch,
        hasExecutionAddressMismatch,
        workSiteCount: workSiteGroups.length,
        originOrderCount: originOrderIds.length,
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[ORDER MERGE] Error:", error);
    return NextResponse.json(
      { error: error.message || "Fehler beim Verbinden der Aufträge" },
      { status: 500 },
    );
  }
}
