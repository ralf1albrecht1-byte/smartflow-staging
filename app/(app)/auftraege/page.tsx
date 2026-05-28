"use client";
// CARD_BADGE_SPLIT_FINAL_V8
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import MergeOrdersDialog from "@/components/orders/MergeOrdersDialog";
import {
  ClipboardList,
  Plus,
  Trash2,
  Search,
  Loader2,
  AlertTriangle,
  FileText,
  FileCheck,
  Volume2,
  ImageIcon,
  Mail,
  MapPin,
  KeyRound,
  Phone,
  CalendarDays,
  DoorOpen,
  ParkingCircle,
  MessageCircle,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Mic,
} from "lucide-react";
import { TouchImageViewer } from "@/components/touch-image-viewer";
import { CommunicationChips } from "@/components/communication-block";
import { ServiceCombobox, ServiceOption } from "@/components/service-combobox";
import {
  mergeCustomerIntoForm,
  isFallbackCustomerName,
} from "@/lib/customer-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { formatCurrency } from "@/lib/currency";
import {
  DuplicateCheckPanel,
  type DuplicateMatch,
} from "@/components/customer-duplicate-check";
import {
  buildSpecialNotes,
  splitSpecialNotes,
  detectCallbackRequest,
} from "@/lib/special-notes-utils";
import { fetchAllJSON } from "@/lib/fetch-utils";
import { LoadErrorFallback } from "@/components/load-error-fallback";
import { ORDER_STATUS_STYLES, getStatusStyle } from "@/lib/status-colors";
import { useDialogBackGuard } from "@/lib/use-dialog-back-guard";
import {
  isCustomerDataIncomplete,
  isRequiredCustomerFieldMissing,
} from "@/lib/customer-links";
import { MwStControl } from "@/components/mwst-control";
import { PlzOrtInput } from "@/components/plz-ort-input";
import { CustomerSearchCombobox } from "@/components/customer-search-combobox";
import { AutoReuseBanner } from "@/components/auto-reuse-banner";
import { MissingCustomerDataBadge } from "@/components/missing-customer-data-badge";
import { MobileListShortcut } from "@/components/mobile-list-shortcut";

function LadderIcon({
  className = "h-4 w-4",
  strokeWidth = 2.2,
}: {
  className?: string;
  strokeWidth?: number | string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 22 12 2" />
      <path d="m18 22-6-20" />
      <path d="M8 14h8" />
      <path d="M9.5 9h5" />
      <path d="M10.8 5h2.4" />
      <path d="M6.8 18h10.4" />
    </svg>
  );
}

interface OrderWorkSite {
  id: string;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  isPrimary?: boolean | null;
  sortOrder?: number | null;
}

interface OrderItem {
  id?: string;
  workSiteId?: string | null;
  workSite?: OrderWorkSite | null;
  serviceName: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

interface Order {
  currency?: "CHF" | "EUR" | null;
  siteAddressDifferent?: boolean | null;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  id: string;
  customerId: string;
  description: string;
  serviceName: string | null;
  status: string;
  priceType: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  date: string;
  createdAt?: string;
  notes: string | null;
  specialNotes: string | null;
  needsReview?: boolean;
  reviewReasons?: string[] | null;
  hinweisLevel?: string;
  mediaUrl: string | null;
  mediaType: string | null;
  imageUrls?: string[];
  audioTranscript?: string | null;
  audioDurationSec?: number | null;
  audioTranscriptionStatus?: string | null;
  offerId?: string | null;
  invoiceId?: string | null;
  vatRate?: number | null;
  vatAmount?: number | null;
  total?: number | null;
  customer?: {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    plz?: string | null;
    city?: string | null;
    customerNumber?: string | null;
  };
  workSites?: OrderWorkSite[];
  originOrderIds?: string[];
  items?: OrderItem[];
}
interface Customer {
  id: string;
  name: string;
  customerNumber?: string | null;
  address?: string | null;
  plz?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
}
interface ServiceDef {
  id: string;
  name: string;
  defaultPrice: number;
  unit: string;
}

const statuses = ["Alle", "Offen", "Erledigt"];
const orderStatuses = ["Offen", "Erledigt"];
const statusColors: Record<string, string> = {
  Offen:
    "bg-orange-200 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200 border border-orange-300",
  Erledigt:
    "bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-200 border border-green-300",
};

const priceTypes = [
  "Stunde",
  "Tag",
  "Pauschal",
  "Meter",
  "Quadratmeter",
  "Kubikmeter",
  "Stück",
  "Kilogramm",
  "Tonne",
  "Liter",
];

const unitConflictTextByReason: Record<string, string> = {
  Menge_erkannt_aber_Leistung_basiert_auf_Stunden:
    "⚠ Menge prüfen: Fläche/Menge erkannt, aber diese Leistung ist nach Stunden hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Tagen:
    "⚠ Menge prüfen: Menge erkannt, aber diese Leistung ist nach Tagen hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Metern:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Metern hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Quadratmetern:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Quadratmetern hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Kubikmetern:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Kubikmetern hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Tonnen:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Tonnen hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Litern:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Litern hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Kilogramm:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Kilogramm hinterlegt.",
  Menge_erkannt_aber_Leistung_basiert_auf_Stueck:
    "⚠ Menge prüfen: andere Einheit erkannt, aber diese Leistung ist nach Stück hinterlegt.",
  Menge_erkannt_aber_Leistung_ist_pauschal:
    "⚠ Menge prüfen: Menge erkannt, aber diese Leistung ist pauschal hinterlegt.",
};

interface FormItem {
  key: string; // client-side key for React
  serviceName: string;
  unit: string;
  unitPrice: string;
  quantity: string;
  aiWarning?: string;
  catalogReviewConfirmed?: boolean;
  workSiteId?: string | null;
  workSite?: OrderWorkSite | null;
}

const createEmptyItem = (): FormItem => ({
  key: Math.random().toString(36).slice(2),
  serviceName: "",
  unit: "Stunde",
  unitPrice: "",
  quantity: "",
  catalogReviewConfirmed: false,
  workSiteId: null,
});

const AI_WARNING_PREFIX = "[AI_WARNING]";
const PRICE_REVIEW_CONFIRMED_PREFIX = "[PRICE_REVIEW_CONFIRMED]";

const isCatalogReviewConfirmedDescription = (
  description?: string | null,
) => compactText(description).startsWith(PRICE_REVIEW_CONFIRMED_PREFIX);

const getCatalogReviewConfirmedFromItemDescription = (
  description?: string | null,
) => isCatalogReviewConfirmedDescription(description);

const stripInternalItemDescriptionMarkers = (description?: string | null) => {
  const value = compactText(description);
  if (!value) return "";
  return value
    .replace(new RegExp(`^\\s*${PRICE_REVIEW_CONFIRMED_PREFIX}\\s*`, "i"), "")
    .replace(new RegExp(`^\\s*${AI_WARNING_PREFIX}\\s*`, "i"), "")
    .trim();
};

const isCatalogReviewConfirmedItem = (item?: {
  description?: string | null;
  catalogReviewConfirmed?: boolean | null;
}) => Boolean(item?.catalogReviewConfirmed) ||
  isCatalogReviewConfirmedDescription(item?.description);

const shouldCollapseCustomerMessagesForOrder = (order?: Order | null) => {
  if (!order) return true;

  const originCount = Array.isArray(order.originOrderIds)
    ? order.originOrderIds.filter(Boolean).length
    : 0;

  const mergedText = [order.notes, order.description]
    .filter(Boolean)
    .join("\n");

  return (
    originCount > 1 ||
    /(?:hauptauftrag|zusammengeführt\s+mit|zusammengefuehrt\s+mit|verbunden\s+von\s+auftrag)/i.test(
      mergedText,
    )
  );
};

const getAiWarningFromItemDescription = (description?: string | null) => {
  if (!description) return "";
  const value = compactText(description);
  return value.startsWith(AI_WARNING_PREFIX)
    ? value.replace(AI_WARNING_PREFIX, "").trim()
    : "";
};

const hasQuantityReviewForService = (
  reviewReasons: string[] | null | undefined,
  serviceName?: string | null,
) => {
  const name = (serviceName || "").trim().toLowerCase();
  if (!name) return false;

  return (
    reviewReasons?.some((reason) => {
      if (reason.startsWith("unit_mismatch:")) {
        const [, reasonService] = reason.split(":");
        return (reasonService || "").trim().toLowerCase() === name;
      }

      return false;
    }) ?? false
  );
};

const buildItemDescription = (item: FormItem) => {
  if (item.aiWarning?.trim()) {
    return `${AI_WARNING_PREFIX} ${item.aiWarning.trim()}`;
  }

  if (item.catalogReviewConfirmed) {
    return `${PRICE_REVIEW_CONFIRMED_PREFIX} ${item.serviceName}`.trim();
  }

  return item.serviceName;
};

const CUSTOMER_REVIEW_REASONS = new Set([
  "possible_customer",
  "customer_needs_review",
  "service_location_review",
  "missing_customer_data",
  "customer_conflict",
  "customer_data_incomplete",
]);

const hasRealCustomerReviewReason = (order: Order) => {
  return (
    order.reviewReasons?.some((reason) =>
      CUSTOMER_REVIEW_REASONS.has(reason),
    ) ?? false
  );
};

type ReviewBadge = {
  key: string;
  label: string;
  className: string;
  icon?: boolean;
  tooltip?: string;
  focusTarget?: "specialNotes";
};

const compactText = (value?: string | null) =>
  (value || "").replace(/\s+/g, " ").trim();

const normalizeForMatch = (value?: string | null) =>
  compactText(value)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");

const SOURCE_LINE_GENERIC_TOKENS = new Set([
  "arbeiten",
  "arbeit",
  "auftrag",
  "service",
  "leistung",
  "leistungen",
  "reinigen",
  "reinigung",
  "cleaning",
  "clean",
  "nettoyage",
  "pulizia",
  "limpieza",
  "machen",
  "bitte",
]);

const sourceLineServiceTokens = (serviceName?: string | null) => {
  const serviceKey = normalizeForMatch(serviceName);
  const tokens = serviceKey
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !SOURCE_LINE_GENERIC_TOKENS.has(token));

  if (/fenster|vitrin|vitre|window|fenetre|finestr|ventan/.test(serviceKey)) {
    tokens.push("fenster", "vitrin", "vitre", "window", "fenetre", "finestr", "ventan");
  }

  if (/boden|floor|sol|paviment|suelo/.test(serviceKey)) {
    tokens.push("boden", "floor", "sol", "paviment", "suelo");
  }

  if (/anfahrt|fahrt|weg|deplacement|deplacement|travel|trip|transport|trasfert|viaje/.test(serviceKey)) {
    tokens.push("anfahrt", "fahrt", "deplacement", "travel", "trip", "transport", "trasfert", "viaje");
  }

  return Array.from(new Set(tokens));
};

const normalizeSourceNumber = (value?: string | number | null) => {
  const numeric = Number(String(value ?? "").replace("'", "").replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return Number.isInteger(numeric)
    ? String(numeric)
    : String(Number(numeric.toFixed(2))).replace(".", "[.,]");
};

const sourceLineContainsNumber = (line: string, value?: string | number | null) => {
  const numberPattern = normalizeSourceNumber(value);
  if (!numberPattern) return false;
  return new RegExp(`(^|[^0-9])${numberPattern}([^0-9]|$)`).test(line);
};

const sourceLineUnitTokens = (unit?: string | null) => {
  const key = normalizeForMatch(unit);
  if (!key) return [];
  if (key === "quadratmeter") return ["quadratmeter", "qm", "m2", "m²", "sqm"];
  if (key === "kubikmeter") return ["kubikmeter", "cbm", "m3", "m³"];
  if (key === "meter") return ["meter", "laufmeter", "lfm"];
  if (key === "stueck" || key === "stuck") return ["stueck", "stuck", "stück", "stk", "piece", "pieces", "vitrine", "vitrines"];
  if (key === "stunde") return ["stunde", "stunden", "std", "hour", "hours"];
  if (key === "tag") return ["tag", "tage", "day", "days"];
  if (key === "pauschal") return ["pauschal", "pauschale", "flat", "forfait"];
  if (key === "kilogramm") return ["kilogramm", "kg"];
  if (key === "tonne") return ["tonne", "tonnen", "t"];
  if (key === "liter") return ["liter", "ltr", "l"];
  return [key];
};

const findCustomerTextLineForService = (
  sourceText?: string | null,
  serviceName?: string | null,
  item?: { quantity?: string | number | null; unit?: string | null; unitPrice?: string | number | null },
) => {
  const source = String(sourceText || "").trim();
  const serviceKey = normalizeForMatch(serviceName);
  if (!source || !serviceKey) return "";

  const importantTokens = sourceLineServiceTokens(serviceName);
  if (importantTokens.length === 0) return "";

  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  let bestLine = "";
  let bestScore = 0;

  for (const line of lines) {
    if (/^\s*\[?\s*(?:titel|title)\s*:/i.test(line)) continue;
    const lineKey = normalizeForMatch(line);
    if (!lineKey) continue;

    const directNameMatch = lineKey.includes(serviceKey);
    const tokenHits = importantTokens.filter((token) =>
      lineKey.includes(normalizeForMatch(token)),
    ).length;

    // Important: never match only on generic words such as "reinigen".
    // This prevents "Boden reinigen" from being shown as evidence for
    // "Fenster reinigen".
    if (!directNameMatch && tokenHits === 0) continue;

    let score = directNameMatch ? 10 : tokenHits * 4;

    if (sourceLineContainsNumber(lineKey, item?.quantity)) score += 3;
    if (sourceLineContainsNumber(lineKey, item?.unitPrice)) score += 3;

    const unitTokens = sourceLineUnitTokens(item?.unit);
    if (unitTokens.some((token) => lineKey.includes(normalizeForMatch(token)))) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  return bestScore >= 4 ? bestLine : "";
};

const canonicalServiceNameForOrderItem = (value?: string | null) => {
  const name = compactText(value);
  const key = normalizeForMatch(name);

  // Display safety: normalize obvious service intent to German catalog names.
  // This is intentionally semantic/broad (cleaning intent), not tied to a
  // specific room such as Veloraum/Keller/Terrasse.
  if (
    /(^|\b)(anfahrt|anfahrt pauschal|fahrtkosten|fahrkosten|fahrpauschale|wegpauschale|deplacement|déplacement|travel fee|travel cost|travel costs|trip fee|transport fee|trasferta|transferta|viaje)(\b|$)/i.test(
      key,
    )
  ) {
    return "Anfahrt";
  }

  const hasFloorIntent =
    /(?:^|\b|[a-z])boden\b|\bbode\b|\bfloor\b|\bsol\b|\bpaviment|\bsuelo\b/i.test(key) ||
    /bodenreinigung|floor cleaning|nettoyage du sol|nettoyage sol|pulizia pavimento|limpieza suelo/.test(key);
  const hasCleaningIntent =
    /reinig|putz|putze|saeuber|säuber|clean|nettoyage|pulizia|limpieza|wisch/.test(key);

  if (hasFloorIntent && hasCleaningIntent) {
    return "Boden reinigen";
  }

  const hasWindowIntent =
    /fenster|fensterli|vitrin|vitre|window|fenetre|fenêtre|finestr|ventan/.test(key);
  const hasNonCleaningWindowIntent =
    /streich|maler|lackier|reparier|ersetzen|montier|einbau|abdicht|dicht/.test(key);

  if (hasWindowIntent && !hasNonCleaningWindowIntent) {
    return "Fenster reinigen";
  }

  return name;
};

const formatMergedNumberString = (value: number) => {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(4)));
};

const mergeEquivalentFormItems = (items: FormItem[]) => {
  const merged: FormItem[] = [];
  const indexByKey = new Map<string, number>();

  items.forEach((item) => {
    const serviceName = canonicalServiceNameForOrderItem(item.serviceName);
    const normalizedItem: FormItem = { ...item, serviceName };
    const unitKey = normalizeForMatch(normalizedItem.unit);
    const unitPriceNumber = Number(normalizedItem.unitPrice || 0);
    const unitPriceKey = Number.isFinite(unitPriceNumber)
      ? String(unitPriceNumber)
      : compactText(normalizedItem.unitPrice);
    const warningKey = normalizeForMatch(normalizedItem.aiWarning);
    const confirmedKey = normalizedItem.catalogReviewConfirmed
      ? "catalog_review_confirmed"
      : "";
    const mergeKey = [
      normalizeForMatch(serviceName),
      unitKey,
      unitPriceKey,
      warningKey,
      confirmedKey,
      normalizedItem.workSiteId || "",
    ].join("|");

    const existingIndex = indexByKey.get(mergeKey);
    const quantityNumber = Number(normalizedItem.quantity || 0);

    if (existingIndex !== undefined && Number.isFinite(quantityNumber)) {
      const existing = merged[existingIndex];
      const existingQuantity = Number(existing.quantity || 0);
      if (Number.isFinite(existingQuantity)) {
        existing.quantity = formatMergedNumberString(
          existingQuantity + quantityNumber,
        );
      }
      return;
    }

    indexByKey.set(mergeKey, merged.length);
    merged.push(normalizedItem);
  });

  return merged;
};

const mergeEquivalentOrderItems = (items: any[]) =>
  mergeEquivalentFormItems(
    items.map((item) => ({
      key: Math.random().toString(36).slice(2),
      serviceName: item.serviceName ?? item.description ?? "",
      unit: item.unit ?? item.priceType ?? "Stunde",
      unitPrice: String(item.unitPrice ?? 0),
      quantity: String(item.quantity ?? 0),
      aiWarning: getAiWarningFromItemDescription(item.description),
      catalogReviewConfirmed: getCatalogReviewConfirmedFromItemDescription(
        item.description,
      ),
      workSiteId: item.workSiteId || null,
      workSite: item.workSite || null,
    })),
  ).map((item) => ({
    serviceName: item.serviceName,
    description: buildItemDescription(item),
    quantity: Number(item.quantity || 0),
    unit: item.unit,
    unitPrice: Number(item.unitPrice || 0),
    workSiteId: item.workSiteId || null,
    workSite: item.workSite || null,
  }));

const hasMissingOrFallbackCustomerName = (value?: string | null) => {
  const name = compactText(value);
  return !name || isFallbackCustomerName(name);
};

const pushUniqueBadge = (badges: ReviewBadge[], badge: ReviewBadge) => {
  if (badges.some((existing) => existing.key === badge.key)) return;
  badges.push(badge);
};

const hasOrderImage = (order: Order) => {
  return (
    (order.imageUrls?.length ?? 0) > 0 ||
    (Boolean(order.mediaUrl) && order.mediaType === "image")
  );
};

// CARD_BADGE_SEMANTIC_SPECIAL_NOTES_V14
// Card chips are now based on cleaned semantic specialNotes only.
// We no longer scan raw notes/audio/description/service text for chips, because
// phrases like "kein Hund" or "kein Termin" created false positives.
const getSemanticBadgeKind = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return null;

  if (
    /oel|öl|rutsch|strom|kabel|gas|rauch|scherb|asbest|schimmel|chem|feuer|brand|sturz|absturz/.test(
      text,
    )
  ) {
    return "warning";
  }

  if (/hund/.test(text)) return "dog";
  // Leiter nur als Werkzeug anzeigen, nicht bei Rollenwörtern wie Bauleiter.
  // Darum nicht mehr auf jedes "leiter" reagieren, sondern nur bei echtem
  // Ausrüstungs-/Mitbring-Signal.
  if (
    /\b(?:kleine|grosse|große|hohe|eigene|tritt|steh|auszieh)?\s*leiter\b/.test(
      text,
    ) &&
    /\b(?:benoetigt|benötigt|braucht|mitbringen|bringen|nehmen|erforderlich|noetig|nötig|vorhanden|aufstellen|kleine|grosse|große|tritt|steh|auszieh)\b/.test(
      text,
    )
  )
    return "ladder";
  if (/park|zufahrt|innenhof|reserviert/.test(text)) return "parking";
  if (/schluessel|schlussel|schlüssel/.test(text)) return "key";
  if (/zugang|eingang|tor|lift|seiteneingang|hintereingang/.test(text))
    return "access";
  if (/termin|datum|uhr|morgen|vormittag|nachmittag/.test(text))
    return "appointment";
  if (/schubkarre/.test(text)) return "wheelbarrow";
  if (/absperrband/.test(text)) return "barrier_tape";
  if (/geruest|gerüst/.test(text)) return "scaffold";
  if (/hanglage|hang|steigung/.test(text)) return "slope";

  return null;
};

const isNonActionableSemanticHint = (
  value?: string | null,
  context?: string | null,
) => {
  const text = normalizeForMatch(value);
  const contextText = normalizeForMatch(context);
  if (!text) return true;

  // Negative access/parking information is actionable: no parking / no lift
  // must still create an orange chip. Other negated hints stay inside only.
  if (
    /kein parkplatz|keine parkplaetze|keine parkplätze|kein parken|parkverbot|kein lift|ohne lift/.test(
      text,
    )
  ) {
    return false;
  }

  const hasRealAccessConstraint =
    /seiteneingang|hintereingang|nebeneingang|rampe|schmal|enger?\s+zugang|schwieriger\s+zugang|kein lift|ohne lift|back entrance|side entrance|rear entrance|access difficult|difficult access|acces difficile/.test(
      text,
    );

  const isOnlyNormalDoorInstruction =
    /klingeln|warten|haustuer|haustür|haupteingang|eingangstuer|eingangstür|kunde ist vor ort|kundin ist vor ort|oeffnet die tuer|öffnet die tür|sonner|attendre|ouvre la porte|main entrance|ring the bell|doorbell/.test(
      text,
    ) && !hasRealAccessConstraint;

  return (
    /kein|keine|keinen|nicht benoetigt|nicht benötigt|muss nicht|kein thema|ohne/.test(
      text,
    ) ||
    /termin flexibel|kein fester termin|kein terminwunsch|irgendwann/.test(
      text,
    ) ||
    /leiter eventuell|eventuell leiter|vielleicht leiter|leiter vielleicht/.test(
      text,
    ) ||
    /zugang.*(frei|offen|unproblematisch)|tuer.*offen|tür.*offen|kunde ist vor ort|kundin ist vor ort/.test(
      text,
    ) ||
    isOnlyNormalDoorInstruction ||
    /parkplatz.*(kein thema|nicht wichtig)|direkt halten|genug platz/.test(
      text,
    ) ||
    (/parkplatz.*(vorhanden|reserviert|frei|innenhof|vor ort)|parkplatz/.test(
      text,
    ) &&
      /parkplatz.*kein thema|direkt halten|genug platz|parkplatz.*nicht wichtig/.test(
        contextText,
      ))
  );
};

const isPositiveSemanticHint = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  return /park(?:platz|ieren|en)?.*(reserviert|innenhof|vorhanden|frei|erlaubt|moeglich|möglich)|(?:innenhof).*(park(?:platz|ieren|en)?|zufahrt)|parkplatz im innenhof|parkplatz vor ort|parken moeglich|parken möglich|parking available|parking allowed/.test(
    text,
  );
};

const PARKING_NO_PATTERN =
  /kein parkplatz|keine parkplaetze|keine parkplätze|kein parken|parkverbot|kein stellplatz|keine stellplaetze|keine stellplätze|no parking|sans parking|sin parking/;

const PARKING_DIFFICULT_PATTERN =
  /parkplatz schwierig|parken schwierig|parkieren schwierig|nur kurz(?:zeitig)? halten|kurzhalten|an der strasse|an der straße|strasse abgestellt|straße abgestellt|fahrzeug muss .*strasse|fahrzeug muss .*straße|ausladen.*strasse|ausladen.*straße/;

const hasParkingReference = (value?: string | null) =>
  /park|parking|parkplatz|parken|zufahrt|innenhof/.test(
    normalizeForMatch(value),
  );

const getParkingSignal = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text || !hasParkingReference(text)) {
    return {
      hasParking: false,
      hasPositive: false,
      hasNoParking: false,
      hasDifficult: false,
    };
  }

  return {
    hasParking: true,
    hasPositive: isPositiveSemanticHint(text),
    hasNoParking: PARKING_NO_PATTERN.test(text),
    hasDifficult: PARKING_DIFFICULT_PATTERN.test(text),
  };
};


const isMergedOrderForCard = (order: Order) =>
  Boolean(
    order.reviewReasons?.includes("manual_order_merge") ||
      order.reviewReasons?.includes("double_merge") ||
      (Array.isArray(order.originOrderIds) && order.originOrderIds.length > 1),
  );

const formatWorkSiteLabelForHint = (site: {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
}) => {
  const title = cleanWorkSiteDisplayName(site.siteName) || compactText(site.siteAddress);
  const address = [
    compactText(site.siteAddress),
    [site.sitePlz, site.siteCity].map(compactText).filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return [title, address].filter(Boolean).join(" · ");
};

const looksLikeWorkSitePrefix = (value?: string | null) => {
  const text = compactText(value);
  if (!text) return false;
  if (/\b\d{4,5}\b/.test(text)) return true;
  if (/\b(?:haus|gebäude|gebaeude|restaurant|küche|kueche|entrée|entree|technopark|limmatweg|chemin|strasse|straße|weg|gasse|platz|adresse|arbeitsort)\b/i.test(text)) return true;
  return /\s·\s/.test(text);
};

const splitLocationPrefixedHint = (value?: string | null) => {
  let text = compactText(value).replace(/^\[HINWEIS\]\s*/i, "").replace(/^[-•]\s*/, "");
  let location = "";

  for (let pass = 0; pass < 4; pass += 1) {
    const match = text.match(/^([^:]{2,190}):\s+(.+)$/);
    if (!match || !looksLikeWorkSitePrefix(match[1])) break;
    location = compactText(match[1]);
    text = compactText(match[2]).replace(/^[-•]\s*/, "");
  }

  return { location, hint: text };
};

const stripRepeatedLocationPrefix = (hint: string, location: string) => {
  let text = compactText(hint).replace(/^[-•]\s*/, "");
  const normalizedLocation = normalizeForMatch(location);

  for (let pass = 0; pass < 4; pass += 1) {
    const parsed = splitLocationPrefixedHint(text);
    if (!parsed.location) break;
    if (normalizeForMatch(parsed.location) !== normalizedLocation) break;
    text = parsed.hint;
  }

  return text;
};

const SPECIAL_NOTES_GROUP_SEPARATOR = "────────────────────";

const isSpecialNotesGroupSeparator = (value?: string | null) =>
  /^[-─—–_]{6,}$/.test(compactText(value));

const isSpecialNotesGroupHeader = (value?: string | null) => {
  const text = compactText(value);
  if (!/^[^:]{2,190}:$/.test(text)) return false;
  return looksLikeWorkSitePrefix(text.replace(/:$/, ""));
};

const formatSpecialNotesForDisplay = (lines: string[]) => {
  const result: string[] = [];
  let hasCurrentGroupContent = false;

  for (const rawLine of lines) {
    const line = compactText(rawLine);
    if (!line || isSpecialNotesGroupSeparator(line)) continue;

    if (isSpecialNotesGroupHeader(line)) {
      if (result.length > 0 && hasCurrentGroupContent) {
        result.push(SPECIAL_NOTES_GROUP_SEPARATOR);
      }
      result.push(line);
      hasCurrentGroupContent = false;
      continue;
    }

    result.push(line);
    hasCurrentGroupContent = true;
  }

  return result.join("\n");
};

const structuredSpecialNoteHints = (order: Order) => {
  const lines = String(order.specialNotes || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => compactText(line).replace(/^\[HINWEIS\]\s*/i, ""))
    .filter(Boolean);

  const fallbackSites = (order.workSites ?? [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.isPrimary ? 1 : 0) - Number(a.isPrimary ? 1 : 0) ||
        Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
    )
    .map(formatWorkSiteLabelForHint)
    .filter(Boolean);
  const singleFallbackSite = fallbackSites.length === 1 ? fallbackSites[0] : "";

  const result: Array<{ location: string; hint: string }> = [];
  let currentLocation = "";

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-•]\s*/, "");
    const parsed = splitLocationPrefixedHint(line);

    if (parsed.location) {
      currentLocation = parsed.location;
      if (parsed.hint) {
        result.push({
          location: currentLocation,
          hint: stripRepeatedLocationPrefix(parsed.hint, currentLocation),
        });
      }
      continue;
    }

    if (/^[^:]{2,190}:$/.test(line) && looksLikeWorkSitePrefix(line.replace(/:$/, ""))) {
      currentLocation = compactText(line.replace(/:$/, ""));
      continue;
    }

    result.push({
      location: currentLocation || singleFallbackSite,
      hint: line,
    });
  }

  return result;
};

const operationalHintMatchesKind = (
  kind: string,
  line: string,
  contextText: string,
) => {
  if (kind === "parking") {
    return Boolean(getParkingBadge(line, contextText)) || getParkingSignal(line).hasParking;
  }
  return getSemanticBadgeKind(line) === kind;
};

const formatOperationalHintTooltip = (
  order: Order,
  kind: string,
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
  fallbackLine: string,
  contextText: string,
) => {
  const entries = [
    ...structuredSpecialNoteHints(order),
    ...parsedNotes.jobHints.map((line) => splitLocationPrefixedHint(line)),
  ]
    .map((entry) => ({
      location: compactText(entry.location),
      hint: compactText(stripRepeatedLocationPrefix(entry.hint, entry.location)),
    }))
    .filter((entry) => entry.hint && operationalHintMatchesKind(kind, entry.hint, contextText));

  const seen = new Set<string>();
  const formatted: string[] = [];

  for (const entry of entries) {
    const key = `${normalizeForMatch(entry.location)}|${normalizeForMatch(entry.hint)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    formatted.push(
      entry.location
        ? `${entry.location}:\n${entry.hint}`
        : entry.hint,
    );
  }

  if (formatted.length > 0) return formatted.join("\n\n");
  return compactText(fallbackLine);
};

const getParkingConflictBadge = (
  values: Array<string | null | undefined>,
): { label: string; className: string } | null => {
  const signal = values.reduce(
    (acc, value) => {
      const next = getParkingSignal(value);
      return {
        hasParking: acc.hasParking || next.hasParking,
        hasPositive: acc.hasPositive || next.hasPositive,
        hasNoParking: acc.hasNoParking || next.hasNoParking,
        hasDifficult: acc.hasDifficult || next.hasDifficult,
      };
    },
    {
      hasParking: false,
      hasPositive: false,
      hasNoParking: false,
      hasDifficult: false,
    },
  );

  if (!signal.hasParking) return null;

  // After merging multiple orders, conflicting parking information should not
  // be shown as a clean "Parken" or "Kein Parkplatz" chip.
  if (
    (signal.hasPositive && (signal.hasNoParking || signal.hasDifficult)) ||
    (signal.hasNoParking && signal.hasDifficult)
  ) {
    return {
      label: "Parken prüfen",
      className: "bg-amber-100 text-amber-800 border border-amber-300",
    };
  }

  return null;
};

const getParkingBadge = (
  value?: string | null,
  context?: string | null,
): { label: string; className: string } | null => {
  const text = normalizeForMatch(value);
  const contextSignal = getParkingSignal(context);
  const ownSignal = getParkingSignal(text);
  if (!ownSignal.hasParking) return null;

  if (!ownSignal.hasNoParking && contextSignal.hasNoParking) return null;

  if (ownSignal.hasNoParking) {
    return {
      label: "Kein Parkplatz",
      className: "bg-amber-100 text-amber-800 border border-amber-300",
    };
  }

  if (ownSignal.hasDifficult) {
    return {
      label: "Parkplatz schwierig",
      className: "bg-amber-100 text-amber-800 border border-amber-300",
    };
  }

  if (ownSignal.hasPositive) {
    return {
      label: "Parken",
      className: "bg-emerald-100 text-emerald-700 border border-emerald-300",
    };
  }

  return {
    label: "Parken prüfen",
    className: "bg-amber-100 text-amber-800 border border-amber-300",
  };
};

const badgeLabelByKind: Record<string, string> = {
  warning: "Achtung",
  dog: "Hund",
  ladder: "Leiter",
  parking: "Parken",
  key: "Schlüssel",
  access: "Zugang",
  appointment: "Termin",
  wheelbarrow: "Schubkarre",
  barrier_tape: "Absperrband",
  scaffold: "Gerüst",
  slope: "Hanglage",
};

const dangerBadgeLabel = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (/hund/.test(text)) return "Hund";
  if (/oel|öl/.test(text)) return "Öl";
  if (/rutsch/.test(text)) return "Rutschig";
  if (/strom|kabel/.test(text)) return "Strom";
  if (/gas|rauch/.test(text)) return "Gas/Rauch";
  if (/scherb/.test(text)) return "Scherben";
  if (/asbest/.test(text)) return "Asbest";
  if (/schimmel/.test(text)) return "Schimmel";
  if (/chem/.test(text)) return "Chemie";
  if (/feuer|brand/.test(text)) return "Feuer";
  if (/sturz|absturz/.test(text)) return "Sturz";
  return "Achtung";
};

const badgeSortRank = (badge: ReviewBadge) => {
  const className = badge.className || "";
  if (/bg-red-|text-red-|border-red-/.test(className)) return 0;
  if (
    /bg-orange-|text-orange-|border-orange-|bg-amber-|text-amber-|border-amber-|bg-yellow-|text-yellow-|border-yellow-/.test(
      className,
    )
  )
    return 1;
  if (
    /bg-emerald-|text-emerald-|border-emerald-|bg-green-|text-green-|border-green-/.test(
      className,
    )
  )
    return 2;
  return 3;
};

const sortReviewBadges = (badges: ReviewBadge[]) =>
  badges
    .map((badge, index) => ({ badge, index }))
    .sort(
      (a, b) =>
        badgeSortRank(a.badge) - badgeSortRank(b.badge) || a.index - b.index,
    )
    .map((entry) => entry.badge);

const formatAppointmentTime = (hour: string, minute?: string) => {
  const normalizedHour = hour.padStart(2, "0");
  return `${normalizedHour}:${minute || "00"}`;
};

const parseAppointmentBaseDate = (value?: string | null) => {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  date.setHours(12, 0, 0, 0);
  return date;
};

const parseAppointmentReferenceDate = (value?: string | null) => {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatAppointmentDate = (date: Date) =>
  `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.`;

const resolveWeekdayAppointmentDate = (
  weekdayIndex: number,
  baseDateInput?: string | null,
  forceNextWeek = false,
) => {
  const baseDate = parseAppointmentBaseDate(baseDateInput);
  const currentWeekday = baseDate.getDay() === 0 ? 7 : baseDate.getDay();

  if (forceNextWeek) {
    const daysUntilNextMonday = 8 - currentWeekday;
    return addDays(baseDate, daysUntilNextMonday + weekdayIndex - 1);
  }

  let daysUntilTarget = weekdayIndex - currentWeekday;
  if (daysUntilTarget < 0) daysUntilTarget += 7;
  return addDays(baseDate, daysUntilTarget);
};

const buildAppointmentMoment = (
  date: Date,
  time?: string,
  dayPart?: string,
) => {
  const appointmentMoment = new Date(date);

  if (time) {
    const [hour, minute] = time.split(":").map((part) => Number(part));
    appointmentMoment.setHours(hour || 0, minute || 0, 0, 0);
  } else if (dayPart === "Vorm.") {
    appointmentMoment.setHours(12, 0, 0, 0);
  } else if (dayPart === "Nachm.") {
    appointmentMoment.setHours(18, 0, 0, 0);
  } else if (dayPart === "Abend") {
    appointmentMoment.setHours(23, 59, 0, 0);
  } else {
    appointmentMoment.setHours(23, 59, 0, 0);
  }

  return appointmentMoment;
};

const isAmbiguousElapsedSameDayAppointment = (
  date: Date,
  baseDateInput?: string | null,
  time?: string,
  dayPart?: string,
) => {
  const reference = parseAppointmentReferenceDate(baseDateInput);
  const appointmentMoment = buildAppointmentMoment(date, time, dayPart);

  const sameCalendarDay =
    appointmentMoment.getFullYear() === reference.getFullYear() &&
    appointmentMoment.getMonth() === reference.getMonth() &&
    appointmentMoment.getDate() === reference.getDate();

  return sameCalendarDay && appointmentMoment.getTime() <= reference.getTime();
};

const isNonActionableAppointmentHint = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return true;

  return (
    /termin\s*(?:ist\s*)?flexibel/.test(text) ||
    /flexibler\s+termin/.test(text) ||
    /kein\s+fester\s+termin/.test(text) ||
    /kein\s+terminwunsch/.test(text) ||
    /terminwunsch\s*(?:offen|flexibel)/.test(text) ||
    /\birgendwann\b/.test(text) ||
    /nach\s+absprache/.test(text) ||
    /wenn\s+es\s+passt/.test(text) ||
    /no\s+fixed\s+appointment/.test(text) ||
    /flexible\s+appointment/.test(text)
  );
};

const splitAppointmentSources = (
  ...values: Array<string | null | undefined>
) => {
  const sources: string[] = [];

  values.forEach((value) => {
    const raw = String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
    if (!raw) return;

    raw
      .split(/\n+/g)
      .map((line) => compactText(line))
      .filter(Boolean)
      .forEach((line) => sources.push(line));

    // Keep the full text as a fallback so "Termin 22.05. 16:00" is not
    // split after the date dot and the real time stays visible on the chip.
    const compactRaw = compactText(raw);
    if (compactRaw) sources.push(compactRaw);
  });

  return Array.from(new Set(sources));
};

const isSameAppointmentCalendarDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const getAppointmentBadgeVisual = (
  appointmentMoment: Date | null,
  labelParts: string[],
  orderStatus?: string | null,
) => {
  const normalClass = "bg-violet-100 text-violet-700 border border-violet-300";
  const tomorrowClass =
    "bg-violet-200 text-violet-800 border border-violet-400";
  const todayClass = "bg-orange-100 text-orange-800 border border-orange-300";
  const overdueClass = "bg-slate-100 text-slate-600 border border-slate-300";
  const doneClass = "bg-slate-100 text-slate-600 border border-slate-300";

  const cleanLabel = labelParts.filter(Boolean).join(" ").trim();
  const completed = normalizeForMatch(orderStatus).includes("erledigt");

  if (!appointmentMoment || Number.isNaN(appointmentMoment.getTime())) {
    return {
      label: cleanLabel ? `Termin ${cleanLabel}` : "Termin",
      className: normalClass,
    };
  }

  if (completed) {
    return {
      label: cleanLabel ? `Termin ${cleanLabel}` : "Termin",
      className: doneClass,
    };
  }

  const now = new Date();
  const tomorrow = addDays(now, 1);

  if (appointmentMoment.getTime() < now.getTime()) {
    return {
      label: cleanLabel ? `Überfällig ${cleanLabel}` : "Überfällig",
      className: overdueClass,
      icon: true,
    };
  }

  if (isSameAppointmentCalendarDay(appointmentMoment, now)) {
    const timeLabel = labelParts.slice(1).filter(Boolean).join(" ").trim();
    return {
      label: timeLabel ? `Heute ${timeLabel}` : "Heute",
      className: todayClass,
    };
  }

  if (isSameAppointmentCalendarDay(appointmentMoment, tomorrow)) {
    const timeLabel = labelParts.slice(1).filter(Boolean).join(" ").trim();
    return {
      label: timeLabel ? `Morgen ${timeLabel}` : "Morgen",
      className: tomorrowClass,
    };
  }

  return {
    label: cleanLabel ? `Termin ${cleanLabel}` : "Termin",
    className: normalClass,
  };
};

const extractAppointmentBadge = (
  value?: string | null,
  baseDateInput?: string | null,
  orderStatus?: string | null,
) => {
  const raw = compactText(value);
  const text = normalizeForMatch(raw);
  if (
    !text ||
    isCallbackTimeLine(raw) ||
    isDoNotComeAppointmentLine(raw) ||
    isNonActionableSemanticHint(raw) ||
    isNonActionableAppointmentHint(raw)
  ) {
    return null;
  }

  const weekdayMap: Array<[RegExp, number]> = [
    [
      /\b(montag|monday|lundi|lunes|lunedi)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      1,
    ],
    [
      /\b(dienstag|tuesday|mardi|martes|martedi)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      2,
    ],
    [
      /\b(mittwoch|wednesday|mercredi|miercoles|mercoledi)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      3,
    ],
    [
      /\b(donnerstag|thursday|jeudi|jueves|giovedi)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      4,
    ],
    [
      /\b(freitag|friday|vendredi|viernes|venerdi)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      5,
    ],
    [
      /\b(samstag|saturday|samedi|sabado|sabato)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      6,
    ],
    [
      /\b(sonntag|sunday|dimanche|domingo|domenica)(?:morgen|vormittag|nachmittag|abend)?\b/i,
      7,
    ],
  ];

  const weekdayIndex =
    weekdayMap.find(([pattern]) => pattern.test(text))?.[1] || null;
  const hasNextWeek =
    /\b(naechste woche|nächste woche|next week|semaine prochaine|proxima semana|settimana prossima)\b/i.test(
      text,
    );
  const hasToday = /\b(heute|today|aujourd'hui|hoy|oggi)\b/i.test(text);
  const hasTomorrow =
    /\b(morgen|tomorrow|demain|mañana|manana|domani)\b/i.test(text) &&
    !weekdayIndex;

  const dayPart = /vormittag|morning|matin|mattina/i.test(text)
    ? "Vorm."
    : /nachmittag|afternoon|apres midi|après-midi|tarde|pomeriggio/i.test(text)
      ? "Nachm."
      : /abend|evening|soir|noche|sera/i.test(text)
        ? "Abend"
        : "";

  const timeMatch =
    raw.match(/\b([01]?\d|2[0-3]):(\d{2})\b/) ||
    raw.match(/\b([01]?\d|2[0-3])\.(\d{2})\s*(?:uhr|h)\b/i) ||
    raw.match(/\b([01]?\d|2[0-3])\s*(?:uhr|h)\b/i);
  const time = timeMatch
    ? formatAppointmentTime(timeMatch[1], timeMatch[2])
    : "";

  const dateMatch = raw.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  const baseDate = parseAppointmentBaseDate(baseDateInput);
  const explicitDateObject = dateMatch
    ? new Date(
        dateMatch[3]
          ? Number(
              dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3],
            )
          : baseDate.getFullYear(),
        Number(dateMatch[2]) - 1,
        Number(dateMatch[1]),
      )
    : null;

  const computedAppointmentDate =
    explicitDateObject ||
    (hasToday ? baseDate : null) ||
    (hasTomorrow ? addDays(baseDate, 1) : null) ||
    (!dateMatch && weekdayIndex
      ? resolveWeekdayAppointmentDate(weekdayIndex, baseDateInput, hasNextWeek)
      : null);

  const isAmbiguousSameWeekdayAppointment =
    computedAppointmentDate !== null &&
    !hasNextWeek &&
    !hasToday &&
    !hasTomorrow &&
    !explicitDateObject &&
    weekdayIndex !== null &&
    isSameAppointmentCalendarDay(computedAppointmentDate, baseDate);

  const shouldShowGenericAppointmentOnly =
    computedAppointmentDate !== null &&
    !hasNextWeek &&
    !hasToday &&
    !hasTomorrow &&
    !explicitDateObject &&
    (isAmbiguousSameWeekdayAppointment ||
      isAmbiguousElapsedSameDayAppointment(
        computedAppointmentDate,
        baseDateInput,
        time,
        dayPart,
      ));

  if (shouldShowGenericAppointmentOnly) {
    return {
      label: "Termin",
      className: "bg-violet-100 text-violet-700 border border-violet-300",
    };
  }

  const date = computedAppointmentDate
    ? formatAppointmentDate(computedAppointmentDate)
    : "";

  // Only show an outside appointment chip when there is a concrete day/date,
  // a relative date such as heute/morgen, or a concrete time.
  if (!date && !time) return null;

  const appointmentMoment = computedAppointmentDate
    ? buildAppointmentMoment(computedAppointmentDate, time, dayPart)
    : null;
  const parts = [date, time || dayPart].filter(Boolean);

  return getAppointmentBadgeVisual(appointmentMoment, parts, orderStatus);
};

type AppointmentDetail = {
  site: string;
  address: string;
  label: string;
  reason?: string;
};

const looksLikeAddressLine = (value?: string | null) => {
  const raw = compactText(value);
  const text = normalizeForMatch(raw);
  if (!raw || !text) return false;

  return (
    /\b\d{4,5}\b/.test(raw) ||
    /\b(strasse|straße|weg|platz|gasse|allee|ring|chemin|route|rue|road|street|avenue|av\.|hauptstrasse|aarauerstrasse|limmatweg|technoparkstrasse)\b/.test(text)
  );
};

const isAppointmentContactTimeLine = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  return (
    /\b(?:anrufen|zurueckrufen|zuruckrufen|telefonieren|rueckruf|ruckruf|call)\b/.test(text) &&
    /\b(?:ab|nach|erst ab|erst nach)\s+\d{1,2}(?::|\.)?\d{0,2}\s*(?:uhr|h)?\b/.test(text)
  );
};

const isDoNotComeAppointmentLine = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  return (
    /\bmorgen\b.*\b(?:nicht|nicht\s+einfach|keinesfalls|erst\s+nach\s+ruecksprache)\b.*\b(?:kommen|erscheinen|vorbeikommen|starten)\b/.test(text) ||
    /\b(?:nicht|nicht\s+einfach|keinesfalls)\b.*\bmorgen\b.*\b(?:kommen|erscheinen|vorbeikommen|starten)\b/.test(text) ||
    /\bbitte\s+morgen\s+nicht\s+einfach\s+kommen\b/.test(text)
  );
};

const normalizeAppointmentDateLabel = (value: string) => {
  const match = value.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (!match) return "";

  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3]
    ? match[3].length === 2
      ? `20${match[3]}`
      : match[3]
    : "";

  return year ? `${day}.${month}.${year}` : `${day}.${month}.`;
};

const normalizeAppointmentTimeLabel = (value: string) => {
  const match =
    value.match(/\b([01]?\d|2[0-3]):(\d{2})\b/) ||
    value.match(/\b([01]?\d|2[0-3])\.(\d{2})\s*(?:uhr|h)?\b/i) ||
    value.match(/\b([01]?\d|2[0-3])\s*(?:uhr|h)\b/i);

  if (!match) return "";
  return formatAppointmentTime(match[1], match[2]);
};

const extractAppointmentDetailLabel = (value: string) => {
  const raw = compactText(value);
  if (!raw || isAppointmentContactTimeLine(raw)) return "";

  const date = normalizeAppointmentDateLabel(raw);
  const time = normalizeAppointmentTimeLabel(raw);
  const text = normalizeForMatch(raw);
  const dayPart = /vormittag|morning|matin/.test(text)
    ? "vormittags"
    : /nachmittag|afternoon|apres midi|après-midi/.test(text)
      ? "nachmittags"
      : /abend|evening|soir/.test(text)
        ? "abends"
        : "";

  if (!date && !time && !dayPart) return "";
  return [date, time || dayPart].filter(Boolean).join(" · ");
};

const cleanAppointmentReason = (value?: string | null) =>
  compactText(value)
    .replace(/^Grund\s*[:\-–—]\s*/i, "")
    .replace(/^Hinweis\s*[:\-–—]\s*/i, "")
    .replace(/^Kontakt\s+vor\s+Ort\s*[:\-–—]\s*Grund\s*[:\-–—]?\s*/i, "")
    .replace(/^Kontakt\s+vor\s+Ort\s*[:\-–—]\s*/i, "")
    .trim();

const appointmentDetailKey = (detail: AppointmentDetail) =>
  normalizeForMatch([detail.site, detail.address, detail.label].join(" "));

const extractAppointmentDetailsFromRawText = (
  ...values: Array<string | null | undefined>
): AppointmentDetail[] => {
  const rawLines = values
    .filter(Boolean)
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => compactText(line))
    .filter(Boolean);

  const details: AppointmentDetail[] = [];
  let currentSite = "";
  let currentAddressParts: string[] = [];
  let lastDetailIndex = -1;

  const pushDetail = (line: string) => {
    const label = extractAppointmentDetailLabel(line);
    if (!label) return;

    const detail: AppointmentDetail = {
      site: currentSite,
      address: currentAddressParts.join(" · "),
      label,
    };
    const key = appointmentDetailKey(detail);
    if (!key || details.some((existing) => appointmentDetailKey(existing) === key)) return;

    details.push(detail);
    lastDetailIndex = details.length - 1;
  };

  for (const rawLine of rawLines) {
    const line = compactText(rawLine);
    const normalized = normalizeForMatch(line);
    if (!line || !normalized) continue;

    const worksiteMatch = line.match(/^(?:Arbeitsort|Ausführung|Ausfuehrung|Adresse\s+travaux|Arbeitsadresse)\s*\d*\s*[:\-–—]\s*(.*)$/i);
    if (worksiteMatch) {
      const site = compactText(worksiteMatch[1]);
      currentSite = site || currentSite;
      currentAddressParts = [];
      lastDetailIndex = -1;
      continue;
    }

    if (
      currentSite &&
      currentAddressParts.length < 2 &&
      looksLikeAddressLine(line) &&
      !/^Termin\b/i.test(line) &&
      !/^Grund\b/i.test(line) &&
      !/^Leistung\b/i.test(line)
    ) {
      currentAddressParts.push(line);
      continue;
    }

    if (/^Termin\b/i.test(line) || extractAppointmentDetailLabel(line)) {
      pushDetail(line);
      continue;
    }

    if (/^Grund\s*[:\-–—]/i.test(line) && lastDetailIndex >= 0) {
      const reason = cleanAppointmentReason(line);
      if (reason) details[lastDetailIndex] = { ...details[lastDetailIndex], reason };
      continue;
    }
  }

  return details;
};

const extractAppointmentDetailsFromGroupedNotes = (
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
): AppointmentDetail[] => {
  const details: AppointmentDetail[] = [];
  let currentSite = "";

  parsedNotes.jobHints.forEach((hint) => {
    const line = compactText(hint);
    if (!line) return;

    const groupedMatch = line.match(/^([^:]{2,160})\s*:\s*(.+)$/);
    const site = compactText(groupedMatch?.[1] || currentSite);
    const value = compactText(groupedMatch?.[2] || line);
    if (groupedMatch) currentSite = site;

    // "Kontakt vor Ort: ... 13.08.2026 14:00" is contextual information for
    // an already extracted appointment, not a third appointment by itself.
    if (/^kontakt\s+vor\s+ort$/i.test(site)) return;

    const label = extractAppointmentDetailLabel(value);
    if (!label) return;

    const detail: AppointmentDetail = {
      site,
      address: "",
      label,
      reason: cleanAppointmentReason(value.replace(/^(?:Termin|Zeitfenster)\s*[:\-–—]?\s*/i, "")),
    };
    const key = appointmentDetailKey(detail);
    if (key && !details.some((existing) => appointmentDetailKey(existing) === key)) {
      details.push(detail);
    }
  });

  return details;
};

const formatAppointmentDetailsTooltip = (details: AppointmentDetail[]) =>
  details
    .map((detail, index) => {
      const header = [detail.site, detail.address].filter(Boolean).join(" · ");
      return [
        `${index + 1}. ${header || "Termin"}`,
        `   ${detail.label}`,
        detail.reason ? `   ${detail.reason}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

const getMultipleAppointmentBadge = (
  order: Order,
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
): ReviewBadge | null => {
  const details = [
    ...extractAppointmentDetailsFromRawText(
      order.notes,
      order.audioTranscript,
      order.specialNotes,
    ),
    ...extractAppointmentDetailsFromGroupedNotes(parsedNotes),
  ].filter((detail, index, all) => {
    const key = appointmentDetailKey(detail);
    if (!key) return false;

    const labelKey = normalizeForMatch(detail.label);
    const firstSameKeyIndex = all.findIndex((other) => appointmentDetailKey(other) === key);
    if (firstSameKeyIndex !== index) return false;

    // Same date/time from raw text + cleaned notes must count once.
    // Otherwise a single Nachkontrolle can become "Termine · 3".
    if (labelKey) {
      const firstSameLabelIndex = all.findIndex(
        (other) => normalizeForMatch(other.label) === labelKey,
      );
      if (firstSameLabelIndex !== index) return false;
    }

    return true;
  });

  if (details.length < 2) return null;

  return {
    key: "appointments_multiple",
    label: `Termine · ${details.length}`,
    className: "bg-violet-100 text-violet-700 border border-violet-300",
    tooltip: formatAppointmentDetailsTooltip(details),
  };
};

const getOperationalBadges = (
  order: Order,
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
): ReviewBadge[] => {
  const badges: ReviewBadge[] = [];
  const orderBadgeContext = [
    order.specialNotes,
    order.notes,
    order.audioTranscript,
  ]
    .map((part) => compactText(part))
    .filter(Boolean)
    .join(" | ");

  const redWarningClass = "bg-red-100 text-red-700 border border-red-300";
  const amberHintClass = "bg-amber-100 text-amber-700 border border-amber-300";
  const greenInfoClass =
    "bg-emerald-100 text-emerald-700 border border-emerald-300";

  const addDanger = (key: string, label: string, tooltip?: string) =>
    pushUniqueBadge(badges, {
      key,
      label,
      className: redWarningClass,
      icon: true,
      tooltip,
    });

  const addHint = (
    key: string,
    label: string,
    className = amberHintClass,
    tooltip?: string,
  ) =>
    pushUniqueBadge(badges, {
      key,
      label,
      className,
      tooltip,
    });

  parsedNotes.safetyWarnings.forEach((line) => {
    const label = dangerBadgeLabel(line);
    addDanger(`danger_${normalizeForMatch(label)}`, label, line);
  });

  const parkingConflictBadge = getParkingConflictBadge([
    ...parsedNotes.jobHints,
    order.specialNotes,
    order.notes,
    order.audioTranscript,
  ]);

  parsedNotes.jobHints.forEach((line) => {
    if (isNonActionableSemanticHint(line, orderBadgeContext)) return;

    const kind = getSemanticBadgeKind(line);
    if (!kind || kind === "warning" || kind === "appointment") return;

    if (kind === "parking") {
      if (parkingConflictBadge) return;
      const parkingBadge = getParkingBadge(line, orderBadgeContext);
      if (!parkingBadge) return;
      addHint(
        `hint_parking_${normalizeForMatch(parkingBadge.label)}`,
        parkingBadge.label,
        parkingBadge.className,
        formatOperationalHintTooltip(order, "parking", parsedNotes, line, orderBadgeContext),
      );
      return;
    }

    const label = badgeLabelByKind[kind];
    if (!label) return;

    // If a safety warning already created a red danger chip, do not add the
    // same semantic hint again in yellow. Example: "Achtung Hund" must show
    // one Hund chip, not red Hund + yellow Hund.
    if (
      badges.some(
        (badge) => normalizeForMatch(badge.label) === normalizeForMatch(label),
      )
    ) {
      return;
    }

    addHint(
      `hint_${kind}`,
      label,
      isPositiveSemanticHint(line) ? greenInfoClass : amberHintClass,
      formatOperationalHintTooltip(order, kind, parsedNotes, line, orderBadgeContext),
    );
  });

  if (parkingConflictBadge) {
    addHint(
      "hint_parking_review",
      parkingConflictBadge.label,
      parkingConflictBadge.className,
      formatOperationalHintTooltip(
        order,
        "parking",
        parsedNotes,
        "Es gibt unterschiedliche oder unklare Parkhinweise. Bitte Auftrag öffnen und prüfen.",
        orderBadgeContext,
      ),
    );
  }

  // Unknown operational notes stay inside the order detail. The card only shows short, useful chips.
  // CARD_BADGE_SORT_AND_LIMIT_V15
  const sortedBadges = sortReviewBadges(badges);
  if (sortedBadges.length <= 9) return sortedBadges;

  const visible = sortedBadges.slice(0, 8);
  visible.push({
    key: "more_operational_badges",
    label: `+${sortedBadges.length - 8}`,
    className: "bg-muted text-muted-foreground border border-border",
  });
  return visible;
};

const AMOUNT_REVIEW_BADGE_KEYS = new Set([
  "price_quantity",
  "unit_conflict",
  "currency_review",
  "price_deviation",
  "catalog_missing",
  "catalog_review_combined",
]);

const PRICE_AMOUNT_REVIEW_BADGE_KEYS = new Set([
  "price_quantity",
  "unit_conflict",
  "price_deviation",
]);

const isAmountReviewBadge = (badge: ReviewBadge) =>
  AMOUNT_REVIEW_BADGE_KEYS.has(badge.key);

const findCatalogServiceForName = (
  services: ServiceDef[],
  serviceName?: string | null,
) => {
  const key = normalizeForMatch(canonicalServiceNameForOrderItem(serviceName));
  if (!key) return null;

  return (
    services.find(
      (service) =>
        normalizeForMatch(canonicalServiceNameForOrderItem(service.name)) ===
        key,
    ) || null
  );
};

const normalizePriceUnitForCompare = (value?: string | null) => {
  const unit = normalizeForMatch(value);
  if (!unit) return "";
  if (["stueck", "stück", "stk", "piece", "pieces"].includes(unit))
    return "piece";
  if (["quadratmeter", "qm", "m2", "m²", "sqm"].includes(unit))
    return "square_meter";
  if (["kubikmeter", "cbm", "m3", "m³"].includes(unit)) return "cubic_meter";
  if (["stunde", "stunden", "std", "h", "hour", "hours"].includes(unit))
    return "hour";
  if (["tag", "tage", "day", "days"].includes(unit)) return "day";
  if (["meter", "laufmeter", "lfm", "m"].includes(unit)) return "meter";
  if (["kilogramm", "kg"].includes(unit)) return "kilogram";
  if (["tonne", "tonnen"].includes(unit)) return "ton";
  if (["liter", "ltr", "l"].includes(unit)) return "liter";
  if (["pauschal", "pauschale", "fixpreis", "festpreis", "flat"].includes(unit))
    return "flat";
  return unit;
};

const hasUnitMismatchReviewForService = (
  reviewReasons: string[] | null | undefined,
  serviceName?: string | null,
) => {
  const key = normalizeForMatch(serviceName);
  if (!key) return false;

  return (
    reviewReasons?.some((reason) => {
      if (!reason.startsWith("unit_mismatch:")) return false;
      const [, reasonService] = reason.split(":");
      return normalizeForMatch(reasonService) === key;
    }) ?? false
  );
};

const hasCatalogPriceDeviationForItem = (
  item: Pick<OrderItem, "serviceName" | "unit" | "unitPrice"> & {
    description?: string | null;
    catalogReviewConfirmed?: boolean | null;
  },
  services: ServiceDef[],
  reviewReasons?: string[] | null,
) => {
  if (!item?.serviceName?.trim()) return false;
  if (isCatalogReviewConfirmedItem(item)) return false;
  if (hasUnitMismatchReviewForService(reviewReasons, item.serviceName))
    return false;

  const catalog = findCatalogServiceForName(services, item.serviceName);
  if (!catalog) return false;

  const catalogUnit = normalizePriceUnitForCompare(catalog.unit);
  const itemUnit = normalizePriceUnitForCompare(item.unit);
  if (catalogUnit && itemUnit && catalogUnit !== itemUnit) return false;

  const catalogPrice = Number(catalog.defaultPrice || 0);
  const itemPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(catalogPrice) || !Number.isFinite(itemPrice))
    return false;
  if (catalogPrice <= 0 || itemPrice <= 0) return false;

  return Math.abs(catalogPrice - itemPrice) >= 0.01;
};

const hasCatalogTextFlatOverrideForItem = (
  item: Pick<OrderItem, "serviceName" | "unit" | "unitPrice" | "quantity"> & {
    description?: string | null;
    catalogReviewConfirmed?: boolean | null;
  },
  services: ServiceDef[],
  reviewReasons?: string[] | null,
) => {
  if (!item?.serviceName?.trim()) return false;
  if (isCatalogReviewConfirmedItem(item)) return false;
  if (hasUnitMismatchReviewForService(reviewReasons, item.serviceName))
    return false;

  const catalog = findCatalogServiceForName(services, item.serviceName);
  if (!catalog) return false;

  const catalogUnit = normalizePriceUnitForCompare(catalog.unit);
  const itemUnit = normalizePriceUnitForCompare(item.unit);
  if (!catalogUnit || !itemUnit) return false;
  if (catalogUnit === itemUnit) return false;
  if (itemUnit !== "flat") return false;

  const itemPrice = Number(item.unitPrice || 0);
  const itemQuantity = Number(item.quantity || 0);
  return Number.isFinite(itemPrice) && itemPrice > 0 && itemQuantity === 1;
};

const getCatalogPriceDeviationItems = (
  order: Order,
  services: ServiceDef[],
) => {
  const items =
    order.items && order.items.length > 0
      ? order.items
      : order.serviceName
        ? [
            {
              serviceName: order.serviceName,
              description: order.description || order.serviceName,
              quantity: order.quantity,
              unit: order.priceType,
              unitPrice: order.unitPrice,
              totalPrice: order.totalPrice,
            },
          ]
        : [];

  return items.filter((item) =>
    hasCatalogPriceDeviationForItem(item, services, order.reviewReasons),
  );
};

const getCatalogTextFlatOverrideItems = (
  order: Order,
  services: ServiceDef[],
) => {
  const items =
    order.items && order.items.length > 0
      ? order.items
      : order.serviceName
        ? [
            {
              serviceName: order.serviceName,
              description: order.description || order.serviceName,
              quantity: order.quantity,
              unit: order.priceType,
              unitPrice: order.unitPrice,
              totalPrice: order.totalPrice,
            },
          ]
        : [];

  return items.filter((item) =>
    hasCatalogTextFlatOverrideForItem(item, services, order.reviewReasons),
  );
};

const formatReviewUnitLabel = (unit?: string | null) => {
  const normalized = normalizePriceUnitForCompare(unit);
  if (normalized === "square_meter") return "m²";
  if (normalized === "cubic_meter") return "m³";
  if (normalized === "piece") return "Stück";
  if (normalized === "hour") return "Std.";
  if (normalized === "day") return "Tag";
  if (normalized === "meter") return "Meter";
  if (normalized === "flat") return "pauschal";
  return unit || "";
};

const getCatalogMissingItems = (order: Order, services: ServiceDef[]) => {
  const items =
    order.items && order.items.length > 0
      ? order.items
      : order.serviceName
        ? [
            {
              serviceName: order.serviceName,
              description: order.description || order.serviceName,
              quantity: order.quantity,
              unit: order.priceType,
              unitPrice: order.unitPrice,
              totalPrice: order.totalPrice,
              catalogReviewConfirmed: false,
            },
          ]
        : [];

  return items.filter((item) => {
    if (!item?.serviceName?.trim()) return false;
    if ((item as any).catalogReviewConfirmed) return false;
    return !findCatalogServiceForName(services, item.serviceName);
  });
};

const formatCatalogReviewTooltip = (input: {
  title: string;
  item?: Pick<OrderItem, "serviceName" | "unit" | "unitPrice" | "quantity"> | null;
  catalog?: ServiceDef | null;
  currency?: "CHF" | "EUR" | null;
  sourceLine?: string | null;
}) => {
  const currency = input.currency === "EUR" ? "EUR" : "CHF";
  const lines: string[] = [];

  if (input.title) {
    lines.push(input.title.replace(/\.$/, ""));
  }

  if (input.item?.serviceName) {
    lines.push(compactText(input.item.serviceName));
  }

  if (input.item) {
    const itemUnit = input.item.unit || "Einheit prüfen";
    const itemPrice = Number(input.item.unitPrice || 0);
    const itemQuantity = Number(input.item.quantity || 0);
    const itemPriceLabel =
      itemPrice > 0 ? formatCurrency(itemPrice, currency) : "Preis prüfen";
    const itemQuantityLabel =
      itemQuantity > 0 ? String(input.item.quantity) : "Menge prüfen";
    lines.push(
      `Auftrag: ${itemQuantityLabel} ${formatReviewUnitLabel(itemUnit)} · ${itemPriceLabel}`,
    );
  }

  if (input.catalog) {
    lines.push(
      `Katalog: ${formatReviewUnitLabel(input.catalog.unit)} · ${formatCurrency(
        Number(input.catalog.defaultPrice || 0),
        currency,
      )}`,
    );
  }

  if (input.sourceLine?.trim()) {
    lines.push(`Text: ${input.sourceLine.trim()}`);
  }

  return lines.filter(Boolean).join("\n");
};

const formatCatalogMissingTooltip = (
  items: Array<Pick<OrderItem, "serviceName" | "unit" | "unitPrice" | "quantity">>,
  currency?: "CHF" | "EUR" | null,
) => {
  const safeCurrency = currency === "EUR" ? "EUR" : "CHF";
  if (items.length === 0) return "Nicht im Katalog.";

  const lines = [
    items.length > 1
      ? `${items.length} Leistungen nicht im Katalog:`
      : "Nicht im Katalog:",
    ...items.slice(0, 5).map((item) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice || 0);
      const quantityLabel = quantity > 0
        ? `${item.quantity} ${formatReviewUnitLabel(item.unit || "")}`
        : formatReviewUnitLabel(item.unit || "");
      const priceLabel = unitPrice > 0
        ? formatCurrency(unitPrice, safeCurrency)
        : "Preis prüfen";
      return `${item.serviceName || "Leistung"} · ${quantityLabel} · ${priceLabel}`;
    }),
  ];

  if (items.length > 5) {
    lines.push(`+${items.length - 5} weitere`);
  }

  return lines.filter(Boolean).join("\n");
};

const cleanWorkSiteDisplayName = (value?: string | null) => {
  let text = compactText(value);
  if (!text) return "";

  // Remove generic source markers from the title. Keep the actual object name.
  text = text
    .replace(/^(?:arbeitsort|ausführungsort|ausfuehrungsort|ausführung|ausfuehrung|ausführungsadresse|ausfuehrungsadresse|einsatzort|objekt|baustelle|job site|work site|lieu|lieu d['’]?intervention|adresse de travail)\s*(?:ist|isch|is|=|:)?\s*/i, "")
    .replace(/^(?:wo\s+gemacht\s+werden\s+muss|wo\s+arbeiten\s+sind|wo\s+es\s+gemacht\s+wird)\s*:?\s*/i, "")
    .replace(/^(?:ist|isch|is)\s+(?:nicht|nöd|noed|not)\s+(?:gleich|gliich)\s*,?\s*/i, "")
    .replace(/^(?:nicht|nöd|noed|not)\s+(?:gleich|gliich)\s*,?\s*/i, "")
    .replace(/^[:\-–,\s]+/, "")
    .trim();

  return text || compactText(value);
};

const formatExecutionAddressTooltip = (order: Order) => {
  const workSiteLines = (order.workSites ?? [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.isPrimary ? 1 : 0) - Number(a.isPrimary ? 1 : 0) ||
        Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
    )
    .map((site, index) => {
      const title =
        cleanWorkSiteDisplayName(site.siteName) ||
        compactText(site.siteAddress) ||
        `Arbeitsort ${index + 1}`;
      const address = [
        compactText(site.siteAddress),
        [site.sitePlz, site.siteCity].map(compactText).filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(" · ");

      return [
        `${index + 1}. ${title}`,
        address ? `   ${address}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean);

  if (workSiteLines.length > 0) {
    const visibleLines = workSiteLines.slice(0, 8);
    const hiddenCount = Math.max(0, workSiteLines.length - visibleLines.length);
    return [
      workSiteLines.length > 1
        ? `Ausführungsorte (${workSiteLines.length}):`
        : "Ausführungsadresse:",
      ...visibleLines,
      hiddenCount > 0 ? `+${hiddenCount} weitere Arbeitsorte` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const fallback = [
    compactText(order.siteName),
    compactText(order.siteAddress),
    [order.sitePlz, order.siteCity].map(compactText).filter(Boolean).join(" "),
  ].filter(Boolean);

  return fallback.length > 0
    ? ["Ausführungsadresse:", ...fallback].join("\n")
    : "Arbeit wird an einer anderen Adresse ausgeführt.";
};

const combineCatalogReviewBadges = (badges: ReviewBadge[]) => badges;

const buildAmountReviewBadges = (badges: ReviewBadge[]): ReviewBadge[] => {
  const currencyBadges = badges.filter(
    (badge) => badge.key === "currency_review",
  );
  const blockingBadges = badges.filter((badge) =>
    ["price_quantity", "unit_conflict"].includes(badge.key),
  );
  const catalogBadges = combineCatalogReviewBadges(
    badges.filter((badge) =>
      ["price_deviation", "catalog_missing"].includes(badge.key),
    ),
  );

  // Wenn die Währung selbst unsicher/konfliktbehaftet ist, reicht außen
  // "Währung prüfen". Zusätzliche Sammelchips sind dann doppelt.
  if (currencyBadges.length > 0) {
    return currencyBadges;
  }

  if (blockingBadges.length > 1) {
    return [
      {
        key: "price_inputs_review",
        label: "Preisangaben prüfen",
        className: "bg-red-100 text-red-700 border border-red-300",
        icon: true,
        tooltip:
          "Mehrere Preis-/Mengenprobleme gefunden. Bitte vor Angebot/Rechnung korrigieren.",
      },
      ...catalogBadges,
    ];
  }

  return [...blockingBadges, ...catalogBadges];
};

const MERGED_CONTACT_DATA_PATTERN =
  /whatsapp|sms|mail|e-?mail|telefon|telefonisch|anruf|anrufen|rückruf|rueckruf|ruckruf|termin|uhr|appointment|call|no calls?|nicht anrufen|keine telefonische/i;

const hasMergedMultipleContactData = (
  order: Order,
  parsedNotes?: ReturnType<typeof splitSpecialNotes>,
) => {
  if (order.reviewReasons?.includes("merged_multiple_contact_data")) return true;

  const isMergedOrder =
    order.reviewReasons?.includes("manual_order_merge") ||
    order.reviewReasons?.includes("double_merge") ||
    (Array.isArray(order.originOrderIds) && order.originOrderIds.length > 1);

  if (!isMergedOrder) return false;

  const notes = parsedNotes || splitSpecialNotes(order.specialNotes || "");
  const groupedContactLines = notes.jobHints.filter((line) => {
    const value = compactText(line);
    return /^[^:]{2,120}:\s+/.test(value) && MERGED_CONTACT_DATA_PATTERN.test(value);
  });

  const phoneCandidates = [
    order.customer?.phone,
    order.notes,
    order.specialNotes,
    order.audioTranscript,
  ]
    .filter(Boolean)
    .join("\n")
    .match(/\+?\d[\d\s()./-]{6,}\d/g) || [];

  const uniquePhones = new Set(
    phoneCandidates
      .map((phone) => phone.replace(/\D/g, ""))
      .filter((phone) => phone.length >= 7),
  );

  return groupedContactLines.length > 1 || uniquePhones.size > 1;
};

const getSystemBadges = (
  order: Order,
  services: ServiceDef[] = [],
): ReviewBadge[] => {
  const badges: ReviewBadge[] = [];

  if (order.siteAddressDifferent) {
    const workSiteCount = Array.isArray(order.workSites) ? order.workSites.length : 0;
    pushUniqueBadge(badges, {
      key: "site_address",
      label: workSiteCount > 1 ? `Ausführungsorte · ${workSiteCount}` : "Ausführungsadresse",
      className: "bg-cyan-100 text-cyan-700 border border-cyan-300",
      tooltip: formatExecutionAddressTooltip(order),
    });
  }

  const isMergedOrder =
    order.reviewReasons?.includes("manual_order_merge") ||
    order.reviewReasons?.includes("double_merge");

  if (isMergedOrder) {
    const originCount = Array.isArray(order.originOrderIds)
      ? order.originOrderIds.filter(Boolean).length
      : 0;
    const mergedCount = originCount > 1 ? originCount : 0;
    pushUniqueBadge(badges, {
      key: "merged",
      label: mergedCount > 0 ? `Zusammengeführt · ${mergedCount}` : "Zusammengeführt",
      className: "bg-blue-100 text-blue-700 border border-blue-300",
      tooltip:
        mergedCount > 0
          ? `${mergedCount} Aufträge verbunden.`
          : "Mehrere Aufträge verbunden.",
    });
  }

  const hasPriceQuantityReview =
    order.items && order.items.length > 0
      ? order.items.some(
          (it) =>
            Number(it.unitPrice || 0) <= 0 || Number(it.quantity || 0) <= 0,
        )
      : Number(order.unitPrice || 0) <= 0 || Number(order.quantity || 0) <= 0;

  // Rote Betragschips nur bei echten Blockern anzeigen.
  // Textpreis/Katalogabweichung mit vorhandenen Werten bleibt gelb,
  // sonst wirkt ein korrekt berechneter Auftrag unnötig gesperrt.
  if (hasPriceQuantityReview) {
    pushUniqueBadge(badges, {
      key: "price_quantity",
      label: "Betrag prüfen",
      className: "bg-red-100 text-red-700 border border-red-300",
      icon: true,
      tooltip:
        "Preis oder Menge fehlt/ist unsicher. Bitte vor Angebot/Rechnung korrigieren.",
    });
  }

  const hasUnitConflict =
    order.reviewReasons?.some((r) => r.startsWith("unit_mismatch:")) ?? false;

  if (hasUnitConflict) {
    pushUniqueBadge(badges, {
      key: "unit_conflict",
      label: "Einheit prüfen",
      className: "bg-red-100 text-red-700 border border-red-300",
      tooltip:
        "Einheit aus Kundentext und Leistungskatalog passen nicht sicher zusammen. Bitte Menge, Einheit und Preis prüfen.",
    });
  }

  const hasCurrencyReview =
    order.reviewReasons?.some((reason) => reason.startsWith("currency_")) ??
    false;

  if (hasCurrencyReview) {
    pushUniqueBadge(badges, {
      key: "currency_review",
      label: "Währung prüfen",
      className: "bg-red-100 text-red-700 border border-red-300",
      icon: true,
      tooltip: "Die Währung ist unklar oder mehrere Währungen wurden erkannt.",
    });
  }

  const priceDeviationItems = getCatalogPriceDeviationItems(order, services);
  const flatOverrideItems = getCatalogTextFlatOverrideItems(order, services);
  const catalogMissingItems = getCatalogMissingItems(order, services);
  const firstPriceDeviationItem = priceDeviationItems[0] || flatOverrideItems[0];
  const firstCatalogMissingItem = catalogMissingItems[0];
  const firstPriceCatalog = firstPriceDeviationItem
    ? findCatalogServiceForName(services, firstPriceDeviationItem.serviceName)
    : null;
  const hasPriceDeviationReview =
    (order.reviewReasons?.some((reason) =>
      reason.startsWith("price_override:"),
    ) ??
      false) ||
    priceDeviationItems.length > 0 ||
    flatOverrideItems.length > 0;

  if (hasPriceDeviationReview) {
    pushUniqueBadge(badges, {
      key: "price_deviation",
      label: "Preis abweichend",
      className:
        "bg-yellow-100 text-yellow-900 border border-yellow-400 shadow-sm ring-1 ring-yellow-200/70",
      tooltip: formatCatalogReviewTooltip({
        title: "Preis weicht vom Katalog ab.",
        item: firstPriceDeviationItem || null,
        catalog: firstPriceCatalog,
        currency: order.currency,
      }),
    });
  }

  if (catalogMissingItems.length > 0) {
    pushUniqueBadge(badges, {
      key: "catalog_missing",
      label: "Nicht im Katalog",
      className:
        "bg-yellow-100 text-yellow-900 border border-yellow-400 shadow-sm ring-1 ring-yellow-200/70",
      tooltip: formatCatalogMissingTooltip(catalogMissingItems, order.currency),
    });
  }

  const hasCustomerReview =
    hasRealCustomerReviewReason(order) ||
    isCustomerDataIncomplete(order.customer);

  if (hasCustomerReview) {
    pushUniqueBadge(badges, {
      key: "customer_review",
      label: "Kunde prüfen",
      className: "bg-yellow-100 text-yellow-700 border border-yellow-300",
      tooltip: "Kundendaten fehlen, sind unvollständig oder müssen gegen mögliche Duplikate geprüft werden.",
    });
  }

  return badges;
};

const detectAppointmentClarificationHint = (...values: Array<string | null | undefined>) => {
  const lines = values
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\n+/g))
    .map((line) => compactText(line))
    .filter(Boolean);

  return lines.find((line) => {
    const text = normalizeForMatch(line);
    if (!text) return false;

    const wantsSchedulingContact =
      /(?:termin|datum|zeitfenster|zeitpunkt).*(?:klaeren|klaren|abstimmen|melden|kontaktieren|vereinbaren|ausmachen|besprechen)|(?:melden|kontaktieren|anrufen|schreiben).*(?:termin|datum|zeitfenster|zeitpunkt)/.test(text);
    if (!wantsSchedulingContact) return false;

    // Fixed appointments stay normal violet appointment chips.
    const hasConcreteDateOrTime =
      /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(line) ||
      /\b(?:heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(text) ||
      /\b(?:vormittag|nachmittag|abend)\b/.test(text) ||
      /\b\d{1,2}(?::|\.)\d{2}\b/.test(line) ||
      /\b\d{1,2}\s*(?:uhr|h)\b/.test(text);

    return !hasConcreteDateOrTime;
  }) || null;
};


const extractCallbackTimeHint = (...values: Array<string | null | undefined>) => {
  const source = values
    .filter(Boolean)
    .join("\n")
    .split(/\n+/g)
    .map((line) => compactText(line))
    .filter(Boolean);

  for (const line of source) {
    const normalized = normalizeForMatch(line);
    if (!/(anrufen|zurueckrufen|zuruckrufen|telefonieren|rueckruf|ruckruf|call)/.test(normalized)) {
      continue;
    }

    const match =
      line.match(/(?:erst\s+)?(?:ab|nach)\s*(\d{1,2})(?::|\.)(\d{2})\s*(?:uhr|h)?/i) ||
      line.match(/(?:erst\s+)?(?:ab|nach)\s*(\d{1,2})\s*(?:uhr|h)\b/i);

    if (match?.[1]) {
      const hour = match[1].padStart(2, "0");
      const minute = match[2] || "00";
      return `erst ab ${hour}:${minute}`;
    }
  }

  return "";
};

const isCallbackTimeLine = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  return (
    /\b(?:anrufen|zurueckrufen|zuruckrufen|telefonieren|rueckruf|ruckruf|call)\b/.test(text) &&
    /\b(?:ab|nach|erst ab|erst nach)\s+\d{1,2}(?::|\.)?\d{0,2}\s*(?:uhr|h)?\b/.test(text)
  );
};

const getBottomBadges = (
  order: Order,
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
): ReviewBadge[] => {
  const badges: ReviewBadge[] = [];
  const blueClass = "bg-blue-100 text-blue-700 border border-blue-300";

  // Zusammengeführt wird oben bei den Systemchips neben der Ausführungsadresse angezeigt.
  // Wenn ein Merge mehrere Telefonnummern, Kontaktwege oder Termine enthält,
  // zeigen wir außen nicht Mail/WhatsApp/SMS/Rückruf/Termin einzeln.
  // Stattdessen steht dieser Sammelchip in der Kontaktchip-Zeile und springt
  // direkt zu den gruppierten Besonderheiten.
  if (hasMergedMultipleContactData(order, parsedNotes)) {
    pushUniqueBadge(badges, {
      key: "merged_data_review",
      label: "Mehrere Daten prüfen",
      className: "bg-emerald-100 text-emerald-800 border border-emerald-300",
      tooltip:
        "Mehrere Telefonnummern, Termine oder Kontaktwege erkannt. Bitte in den Besonderheiten manuell prüfen.",
      focusTarget: "specialNotes",
    });
  }

  const callbackSource = [
    order.specialNotes,
    order.notes,
    order.audioTranscript,
    ...parsedNotes.jobHints,
  ]
    .filter(Boolean)
    .join("\n");

  const directCallbackHint = [
    order.specialNotes,
    order.notes,
    order.audioTranscript,
    ...parsedNotes.jobHints,
  ]
    .filter(Boolean)
    .flatMap((part) => String(part).split(/\n+/g))
    .map((line) => line.trim())
    .find((line) => isPositiveCallbackChipLine(line));

  if (detectCallbackRequest(callbackSource) || directCallbackHint) {
    const callbackTimeHint = extractCallbackTimeHint(
      order.specialNotes,
      order.notes,
      order.audioTranscript,
      ...parsedNotes.jobHints,
    );
    const callbackTooltip = [
      directCallbackHint || "Kunde wünscht Rückruf oder telefonische Rücksprache.",
      callbackTimeHint,
    ]
      .filter(Boolean)
      .join(" · ");

    pushUniqueBadge(badges, {
      key: "callback_request",
      label: callbackTimeHint ? `Rückruf ${callbackTimeHint}` : "Rückruf",
      className: "bg-blue-100 text-blue-700 border border-blue-400 shadow-sm",
      tooltip: callbackTooltip,
    });
  }

  // Communication chips (Mail/SMS/WhatsApp) are rendered by CommunicationChips only.
  // Do not add an extra SMS review badge here; otherwise SMS appears twice.

  const appointmentBaseDate = order.createdAt || order.date;
  const rawAppointmentContext = [
    ...parsedNotes.jobHints,
    order.specialNotes,
    order.notes,
    order.audioTranscript,
  ]
    .filter(Boolean)
    .join("\n");
  const suppressIsolatedTomorrowChip = /morgen.*nicht.*(?:kommen|erscheinen|starten)|nicht.*morgen.*(?:kommen|erscheinen|starten)|nicht\s+einfach\s+kommen/i.test(
    normalizeForMatch(rawAppointmentContext),
  );
  const appointmentSourceLines = splitAppointmentSources(
    ...parsedNotes.jobHints,
    order.specialNotes,
    order.notes,
    order.audioTranscript,
  ).filter((line) => {
    if (isCallbackTimeLine(line) || isDoNotComeAppointmentLine(line)) return false;
    if (suppressIsolatedTomorrowChip && /^\s*(morgen|tomorrow|demain|domani)\s*$/i.test(line)) return false;
    return true;
  });

  const multipleAppointmentBadge = getMultipleAppointmentBadge(order, parsedNotes);

  const appointmentBadge = multipleAppointmentBadge ||
    appointmentSourceLines
      .map((line) =>
        extractAppointmentBadge(line, appointmentBaseDate, order.status),
      )
      .find(Boolean);

  if (appointmentBadge) {
    pushUniqueBadge(badges, {
      key: multipleAppointmentBadge ? "appointments_multiple" : "appointment",
      label: appointmentBadge.label,
      className: appointmentBadge.className,
      icon: appointmentBadge.icon,
      tooltip: multipleAppointmentBadge ? multipleAppointmentBadge.tooltip : undefined,
    });
  } else {
    const appointmentClarification = detectAppointmentClarificationHint(
      ...parsedNotes.jobHints,
      order.specialNotes,
      order.notes,
      order.audioTranscript,
    );

    if (appointmentClarification) {
      pushUniqueBadge(badges, {
        key: "appointment_clarify",
        label: "Termin klären",
        className: "bg-amber-100 text-amber-800 border border-amber-300",
        tooltip: compactText(appointmentClarification).slice(0, 120),
      });
    }
  }

  return badges;
};

const isPositiveCallbackChipLine = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  const negative =
    /kein(?:e[nm]?)?\s+(?:telefonischer\s+)?(?:rueckruf|ruckruf|anruf)|nicht\s+(?:telefonisch\s+)?(?:zurueckrufen|zuruckrufen|anrufen)|(?:rueckruf|ruckruf)\s+(?:nicht\s+)?(?:noetig|notig|erwuenscht)/.test(
      text,
    );

  if (negative) return false;

  if (/(?:nach|ab|erst\s+ab|erst\s+nach)\s+\d{1,2}(?::\d{2})?\s*(?:uhr|h)?\s+(?:anrufen|telefonieren|kontaktieren|zurueckrufen|zuruckrufen)/.test(text)) return true;

  return /(?:rueckruf|ruckruf)\s+(?:gewuenscht|erwuenscht|bitte|vor|arbeitsbeginn|ankunft)|bitte\s+(?:kurz\s+)?(?:zurueckrufen|zuruckrufen|anrufen)|vorher\s+(?:kurz\s+)?(?:anrufen|telefonieren|kontaktieren|zurueckrufen|zuruckrufen)|vor\s+ankunft\s+(?:kurz\s+)?(?:zurueckrufen|zuruckrufen|anrufen|telefonieren|kontaktieren)|vor\s+arbeitsbeginn\s+(?:kurz\s+)?(?:telefonisch\s+)?(?:kontaktieren|melden|anrufen|telefonieren)|vor\s+ort\s+(?:kurz\s+)?(?:anrufen|telefonieren|kontaktieren|zurueckrufen|zuruckrufen)|telefonischer\s+(?:rueckruf|ruckruf)|telefonisch\s+(?:abklaeren|kontaktieren|melden)|\b\d+\s*minuten\s+(?:vorher|vor\s+arbeitsbeginn|vor\s+ankunft)\s+(?:anrufen|telefonieren|kontaktieren|zurueckrufen|zuruckrufen)/.test(
    text,
  );
};

const isNegativeWhatsAppLine = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text || !/whatsapp|whats\s*app/.test(text)) return false;

  return /(?:keine?|kein|nicht|ohne|no|not)\s+(?:whatsapp|whats\s*app)|(?:whatsapp|whats\s*app)\s+(?:nicht|nein|no|not)/.test(
    text,
  );
};

const removeCallbackLinesForCommunicationChips = (value?: string | null) =>
  String(value || "")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter((line) => line && !isPositiveCallbackChipLine(line) && !isNegativeWhatsAppLine(line))
    .join("\n");

const getStrongerCardBadgeClassName = (className?: string | null) =>
  String(className || "")
    .replace(/\bborder\s+border-/g, "border-2 border-")
    .replace(/\bborder\s+border\b/g, "border-2 border");

const renderBadgeTooltip = (
  badge: ReviewBadge,
  align: "left" | "right" = "left",
) => {
  const tooltip = String(badge.tooltip || "").trim();
  if (!tooltip) return null;

  const alignClass = align === "right" ? "right-0" : "left-0";

  return (
    <span
      className={`pointer-events-none absolute ${alignClass} bottom-full z-[9999] mb-1 hidden w-max max-w-[min(18rem,calc(100vw-2rem))] max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-xl group-hover:block group-focus:block dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100`}
    >
      {tooltip}
    </span>
  );
};

const renderReviewBadge = (
  badge: ReviewBadge,
  className: string,
  options: { strong?: boolean; tooltipAlign?: "left" | "right" } = {},
) => {
  const hasTooltip = Boolean(compactText(badge.tooltip));

  return (
    <span
      key={badge.key}
      tabIndex={hasTooltip ? 0 : undefined}
      onClick={(event) => {
        if (hasTooltip) event.stopPropagation();
      }}
      className={`group relative inline-flex items-center gap-1 rounded-full shrink-0 outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${className} ${
        options.strong ? getStrongerCardBadgeClassName(badge.className) : badge.className
      }`}
    >
      {badge.key === "callback_request" && (
        <span className="text-red-600 leading-none">☎</span>
      )}
      {badge.icon && badge.key !== "callback_request" && (
        <AlertTriangle className="w-3 h-3" />
      )}
      {badge.label}
      {renderBadgeTooltip(badge, options.tooltipAlign || "left")}
    </span>
  );
};

const renderOrderCardBadge = (
  badge: ReviewBadge,
  tooltipAlign: "left" | "right" = "left",
) => {
  const isLargeYellowBadge = [
    "price_deviation",
    "catalog_missing",
    "catalog_review_combined",
  ].includes(badge.key);

  return renderReviewBadge(
    badge,
    isLargeYellowBadge
      ? "text-[11px] px-2 py-0.5 font-semibold"
      : "text-[10px] px-1.5 py-0.5 font-medium",
    { strong: true, tooltipAlign },
  );
};

const mobileIconForBadge = (badge: ReviewBadge) => {
  const label = normalizeForMatch(badge.label);
  if (badge.key === "site_address") return MapPin;
  if (badge.key === "callback_request") return Phone;
  if (badge.key === "appointment" || badge.key === "appointment_clarify") return CalendarDays;
  if (label.includes("leiter")) return LadderIcon;
  if (label.includes("schluessel") || label.includes("schlussel")) return KeyRound;
  if (label.includes("zugang")) return DoorOpen;
  if (label.includes("park")) return ParkingCircle;
  if (label.includes("mail")) return Mail;
  if (label.includes("whatsapp")) return MessageCircle;
  if (label.includes("sms")) return MessageCircle;
  if (badge.icon) return AlertTriangle;
  return null;
};

const mobileIconBadgeClass = (badge: ReviewBadge) => {
  const className = badge.className || "";
  if (/red/.test(className)) return "bg-red-50 text-red-700 border-red-300";
  if (/blue/.test(className)) return "bg-blue-50 text-blue-700 border-blue-300";
  if (/cyan/.test(className)) return "bg-cyan-50 text-cyan-700 border-cyan-300";
  if (/emerald|green/.test(className)) return "bg-emerald-50 text-emerald-700 border-emerald-300";
  if (/violet|purple/.test(className)) return "bg-violet-50 text-violet-700 border-violet-300";
  if (/yellow|amber|orange/.test(className)) return "bg-amber-50 text-amber-700 border-amber-300";
  return "bg-slate-50 text-slate-700 border-slate-300";
};

const renderMobileIconBadge = (badge: ReviewBadge) => {
  const title = compactText(badge.tooltip) || badge.label;
  const Icon = mobileIconForBadge(badge);
  return (
    <button
      key={badge.key}
      type="button"
      tabIndex={0}
      title={title}
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[13px] font-semibold shadow-sm ${mobileIconBadgeClass(badge)}`}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={2.2} /> : badge.label.slice(0, 1)}
    </button>
  );
};

const renderMobileActionBadge = (order: Order, badge: ReviewBadge) => {
  if (badge.key !== "callback_request") return renderMobileIconBadge(badge);

  const phone = getOrderPhoneForHref(order);
  const callbackInfo = compactText(badge.tooltip);
  const title = phone
    ? [`Anrufen: ${phone}`, callbackInfo].filter(Boolean).join(" · ")
    : callbackInfo || "Rückruf gewünscht · Nummer fehlt";
  const Icon = mobileIconForBadge(badge) || Phone;
  const className = `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[13px] font-semibold shadow-sm ${mobileIconBadgeClass(badge)}`;

  if (!phone) {
    return (
      <button
        key={badge.key}
        type="button"
        tabIndex={0}
        title={title}
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={className}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
      </button>
    );
  }

  return (
    <a
      key={badge.key}
      href={`tel:${phone}`}
      onClick={(event) => event.stopPropagation()}
      aria-label={title}
      title={title}
      className={className}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
    </a>
  );
};

const renderMobileTextBadge = (badge: ReviewBadge, align: "left" | "right" = "right") =>
  renderReviewBadge(
    badge,
    "max-w-full truncate text-[10px] px-1.5 py-0.5 font-semibold",
    { strong: true, tooltipAlign: align },
  );

const mobileOverflowBadge = (count: number) =>
  count > 0 ? (
    <span
      key="mobile_more_badges"
      className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-1.5 text-[11px] font-semibold text-slate-600"
    >
      +{count}
    </span>
  ) : null;

const extractPhoneForHref = (...values: Array<string | null | undefined>) => {
  const source = values.filter(Boolean).join("\n");
  const explicitPhone =
    source.match(/(?:tel\.?|telefon|phone|mobile|handy|natel|whats\s*app(?:\s+nummer)?|sms|kontakt(?:\s+vor\s+ort)?|anrufen|al[uü]te)\s*[:.]?\s*(\+?\d[\d\s()./-]{6,}\d)/i)?.[1] ||
    source.match(/(?:bitte\s+)?(?:kurz\s+)?(?:anrufen|telefonieren|zur[uü]ckrufen|rueckrufen|ruckrufen).*?(\+?\d[\d\s()./-]{6,}\d)/i)?.[1] ||
    source.match(/(\+\d[\d\s()./-]{7,}\d)/)?.[1] ||
    "";
  const normalized = explicitPhone.replace(/[^+0-9]/g, "");
  return normalized.length >= 7 ? normalized : "";
};

const getOrderPhoneForHref = (order: Order) =>
  extractPhoneForHref(
    order.customer?.phone,
    order.notes,
    order.specialNotes,
    order.audioTranscript,
  );

const renderCallbackCardBadge = (
  order: Order,
  badge: ReviewBadge,
  tooltipAlign: "left" | "right" = "left",
) => {
  const phone = getOrderPhoneForHref(order);
  if (!phone) {
    return renderOrderCardBadge(
      {
        ...badge,
        tooltip: compactText(badge.tooltip) || "Rückruf gewünscht · Nummer fehlt",
      },
      tooltipAlign,
    );
  }

  const callbackInfo = compactText(badge.tooltip);
  const clickableBadge = {
    ...badge,
    tooltip: [`Anrufen: ${phone}`, callbackInfo].filter(Boolean).join(" · "),
  };

  return (
    <a
      key={badge.key}
      href={`tel:${phone}`}
      onClick={(event) => event.stopPropagation()}
      className="inline-flex"
    >
      {renderOrderCardBadge(clickableBadge, tooltipAlign)}
    </a>
  );
};

const cleanServiceLabel = (value?: string | null) => {
  let text = compactText(canonicalServiceNameForOrderItem(value));
  if (!text) return "";

  text = text
    .replace(/^[-–—•\d.)\s]+/, "")
    .replace(/\s+[–—]\s+.*$/, "")
    .replace(/\s+-\s+.*$/, "")
    // Einheit-/Preiswörter gehören nicht in den sichtbaren Kartentitel.
    .replace(
      /\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > 55) {
    text = `${text.slice(0, 52).trim()}…`;
  }

  return text;
};

const uniqueServiceLabels = (labels: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  labels.forEach((label) => {
    const cleaned = cleanServiceLabel(label);
    const key = normalizeForMatch(cleaned);
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });

  return result;
};

const formatServiceSummary = (labels: string[]) => {
  const unique = uniqueServiceLabels(labels);
  if (unique.length === 0) return "";
  return unique.join(" + ");
};

const extractFallbackServiceLabels = (order: Order) => {
  const raw = [
    order.description,
    order.serviceName,
    order.notes,
    order.audioTranscript,
  ]
    .map((part) => compactText(part))
    .filter(Boolean)
    .join(". ");

  const text = normalizeForMatch(raw);
  const labels: string[] = [];

  const addIf = (regex: RegExp, label: string) => {
    if (regex.test(text)) labels.push(label);
  };

  addIf(/baum.*(faell|gefaellt|entfern|schneid|rod)/, "Baum fällen");
  addIf(/rasen.*(maeh|maehen|schnitt)/, "Rasen mähen");
  addIf(/treppenhaus.*rein/, "Treppenhaus reinigen");
  addIf(/kellerboden.*rein|keller.*boden.*rein/, "Kellerboden reinigen");
  addIf(/farbe.*entfern|alte farbe.*entfern/, "Farbe entfernen");
  addIf(/fenster.*rein/, "Fenster reinigen");
  addIf(/unterhaltsreinigung/, "Unterhaltsreinigung");
  addIf(/hauswartung/, "Hauswartung");
  addIf(/hecke.*(schneid|schnitt)/, "Hecke schneiden");
  addIf(/strasse.*rein|weg.*rein|platz.*rein/, "Aussenbereich reinigen");

  const known = uniqueServiceLabels(labels);
  if (known.length > 0) return known;

  const beforeDash = compactText(raw.split(/[–—]/)[0]);
  if (beforeDash.length >= 3 && beforeDash.length <= 80) {
    return [beforeDash];
  }

  const cleaned = compactText(raw)
    .replace(/das beigefuegte bild zeigt.*$/i, "")
    .replace(/das beigefügte bild zeigt.*$/i, "")
    .replace(/weitere details.*$/i, "")
    .replace(
      /der kunde moechte|der kunde möchte|kunde moechte|kunde möchte/gi,
      "",
    )
    .replace(/\b(ein|eine|einen|soll|sollen|muss|muessen|müssen|bitte)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];
  return [cleaned.length > 80 ? `${cleaned.slice(0, 77).trim()}…` : cleaned];
};

const getOrderCardServiceSummary = (order: Order) => {
  const itemLabels =
    order.items && order.items.length > 0
      ? order.items.map((item) => item.serviceName)
      : [];

  const structuredLabels =
    itemLabels.length > 0 ? itemLabels : [order.serviceName || ""];
  const usableStructuredLabels = structuredLabels.filter(
    (label) => normalizeForMatch(label) !== "sonstiges",
  );

  const structuredSummary = formatServiceSummary(usableStructuredLabels);
  if (structuredSummary) return structuredSummary;

  const fallbackSummary = formatServiceSummary(
    extractFallbackServiceLabels(order),
  );
  return fallbackSummary || "Leistung prüfen";
};

const formatMobileServiceSummary = (labels: string[]) => {
  const unique = uniqueServiceLabels(labels);
  if (unique.length === 0) return "Leistung prüfen";
  const visible = unique.slice(0, 3);
  const hidden = unique.length - visible.length;
  return `${visible.join(" · ")}${hidden > 0 ? ` · +${hidden}` : ""}`;
};

const getMobileOrderCardServiceSummary = (order: Order) => {
  const itemLabels =
    order.items && order.items.length > 0
      ? order.items.map((item) => item.serviceName)
      : [];
  const structuredLabels =
    itemLabels.length > 0 ? itemLabels : [order.serviceName || ""];
  const usableStructuredLabels = structuredLabels.filter(
    (label) => normalizeForMatch(label) !== "sonstiges",
  );
  const structuredSummary = formatMobileServiceSummary(usableStructuredLabels);
  if (structuredSummary && structuredSummary !== "Leistung prüfen") return structuredSummary;
  return formatMobileServiceSummary(extractFallbackServiceLabels(order));
};

const emptyForm = {
  customerId: "",
  description: "",
  status: "Offen",
  date: new Date().toISOString().split("T")[0],
  notes: "",
  specialNotes: "",
  siteAddressDifferent: false,
  siteName: "",
  siteAddress: "",
  sitePlz: "",
  siteCity: "",
  siteNote: "",
};

const CRITICAL_CONVERSION_REVIEW_PATTERNS = [
  /^currency_/,
  /^item_currency_mismatch/,
  /^unit_mismatch:/,
  /^unit_price_review$/,
  /^quantity_review$/,
  /^price_unclear:/,
  /^unbekannte_leistung_pruefen$/,
  /^stunden_arbeitsposition_pruefen$/,
  /^total_unrealistic_check$/,
  /^currency_unsupported$/,
  /^manual_flat_service_from_text$/,
];

const getOrderConversionBlockers = (order: Order | any): string[] => {
  const blockers: string[] = [];
  // Status is intentionally NOT a blocker. Open orders may be moved to
  // Angebot/Rechnung when the actual data is safe enough.
  const items: any[] = Array.isArray(order?.items) ? order.items : [];
  const reviewReasons: string[] = Array.isArray(order?.reviewReasons)
    ? order.reviewReasons.filter(Boolean)
    : [];

  if (items.length === 0) {
    blockers.push("Keine Leistungen vorhanden");
  }

  if (
    items.some(
      (item) =>
        Number(item?.unitPrice || 0) <= 0 ||
        Number(item?.quantity || 0) <= 0 ||
        Number(
          item?.totalPrice ??
            Number(item?.unitPrice || 0) * Number(item?.quantity || 0),
        ) <= 0,
    )
  ) {
    blockers.push("Preis/Menge prüfen");
  }

  if (
    reviewReasons.some((reason) =>
      CRITICAL_CONVERSION_REVIEW_PATTERNS.some((pattern) =>
        pattern.test(reason),
      ),
    )
  ) {
    blockers.push("Offene Prüfhinweise im Auftrag");
  }

  if (order?.needsReview && reviewReasons.length > 0) {
    blockers.push("Auftrag ist noch auf Prüfen gesetzt");
  }

  if (isCustomerDataIncomplete(order?.customer)) {
    blockers.push("Kundendaten prüfen");
  }

  return Array.from(new Set(blockers));
};

const blockConversionIfUnsafe = (
  order: Order | any,
  targetLabel: "Angebot" | "Rechnung",
) => {
  const blockers = getOrderConversionBlockers(order);
  if (blockers.length === 0) return false;

  toast.error(
    `${targetLabel} nicht möglich: ${blockers.slice(0, 3).join(", ")}`,
  );
  return true;
};

export default function AuftraegePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<ServiceDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("Alle");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<
    "newest" | "oldest" | "name" | "amount" | "review"
  >("newest");
  // ─── Merge Assistant (guided 3-step flow) ───
  // Step 0 = inactive, Step 1 = selecting orders, Step 2 = main order + customer + preview, Step 3 = final review
  const [mergeStep, setMergeStep] = useState<0 | 1 | 2 | 3>(0);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [selectedMainOrderId, setSelectedMainOrderId] = useState<string | null>(
    null,
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [textPreviewOpen, setTextPreviewOpen] = useState<
    Record<string, boolean>
  >({});

  const [merging, setMerging] = useState(false);
  // Resolved image preview URLs (up to 3 per selected order)
  const [mergePreviewUrls, setMergePreviewUrls] = useState<
    Record<string, string[]>
  >({});
  // Resolved audio URLs for inline playback in merge Step 2
  const [mergeAudioUrls, setMergeAudioUrls] = useState<Record<string, string>>(
    {},
  );
  const isMergeMode = mergeStep === 1;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [siteAddressEditing, setSiteAddressEditing] = useState(false);
  // Phase 2d (Stage 3): read-only info line shown in the edit dialog after an
  // Undo of auto-reuse, to give back the previously visible address context
  // without writing anything into the new minimal customer master record.
  const [undoPreviousAddress, setUndoPreviousAddress] = useState<{
    address: string | null;
    plz: string | null;
    city: string | null;
  } | null>(null);
  const [formItems, setFormItems] = useState<FormItem[]>([createEmptyItem()]);
  const [formWorkSites, setFormWorkSites] = useState<OrderWorkSite[]>([]);
  const [editingWorkSiteId, setEditingWorkSiteId] = useState<string | null>(
    null,
  );
  const [activeWorkSiteId, setActiveWorkSiteId] = useState<string | null>(null);
  const [expandedWorkSiteIds, setExpandedWorkSiteIds] = useState<string[]>([]);
  const [customerMessagesExpanded, setCustomerMessagesExpanded] =
    useState(false);
  const [serviceOverviewExpanded, setServiceOverviewExpanded] =
    useState(false);
  const [movingItemKey, setMovingItemKey] = useState<string | null>(null);
  // Persisted MwSt on Auftrag — saved on the Order itself (see app/api/orders)
  // and forwarded to the derived Offer/Invoice when converting.
  const [orderVatRate, setOrderVatRate] = useState(8.1);
  const [defaultVatRate, setDefaultVatRate] = useState(8.1);
  const [currency, setCurrency] = useState<"CHF" | "EUR">("CHF");
  const [saving, setSaving] = useState(false);

  // New customer inline / edit customer
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [newCust, setNewCust] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    plz: "",
    city: "",
    country: "CH",
  });
  const [savingCust, setSavingCust] = useState(false);

  // Stage E (deterministic chip flow): pending customerId waiting for the dialog
  // to mount + form to be populated before the customer-edit section is opened.
  // Set by `openEdit(o, { openCustomerSection: true })` when the user taps the
  // "Kundendaten unvollständig" / "Prüfen" chip in a list card. The effect
  // below picks it up once `dialogOpen && form.customerId === pendingId`,
  // loads fresh customer data and reveals the editor — guaranteed to run
  // AFTER the dialog has opened and the form is in sync, so it can never
  // race against `openEdit`'s own resets.
  const [pendingOpenCustomerEditor, setPendingOpenCustomerEditor] = useState<
    string | null
  >(null);
  const customerEditorRef = useRef<HTMLDivElement | null>(null);
  const specialNotesRef = useRef<HTMLDivElement | null>(null);
  const [pendingFocusSection, setPendingFocusSection] = useState<
    "specialNotes" | null
  >(null);

  // New duplicate check (Phase C — Sheet-based)
  const [dupCheckOpen, setDupCheckOpen] = useState(false);

  // ISSUE 2 — Inline PLZ/city suggestion from exact duplicate matches.
  // Shown directly in the customer section without requiring "Duplikate prüfen".
  const [inlineSuggestion, setInlineSuggestion] = useState<{
    type: "plz" | "city";
    value: string;
    sourceName: string;
  } | null>(null);
  const inlineSuggestionFetchRef = useRef(0);

  // Android/browser back: close the edit dialog FIRST instead of jumping to the
  // previously visited module. Safe version — see lib/use-dialog-back-guard.ts.
  useDialogBackGuard(dialogOpen, () => setDialogOpen(false));

  // Block D — single shared entry point for "Kunde bearbeiten". Used by
  // both the existing "✏️ Bearbeiten" link AND the newly-clickable customer
  // display card. Phase 2f: fetch fresh customer data from the server so
  // stale local state can never silently wipe values. Fall back to local
  // state on error.
  //
  // Optional `customerIdOverride` lets callers (e.g. the list-card chip
  // shortcut) pass a customer id directly without first relying on the
  // form state being flushed — useful when called immediately after
  // `openEdit()` because React state updates batch.
  // Optional `noteOverride` is the order/record notes used to merge any
  // freshly-extracted customer fields. When omitted we look it up from the
  // current edit order (existing behavior).
  const openCustomerEditor = async (
    customerIdOverride?: string,
    noteOverride?: string | null,
  ) => {
    const targetId = customerIdOverride || form.customerId;
    if (!targetId) return;
    let freshCust: Customer | null =
      customers.find((c: Customer) => c.id === targetId) || null;
    try {
      const res = await fetch(`/api/customers/${targetId}`);
      if (res.ok) {
        const fetched = await res.json();
        if (fetched && fetched.id) {
          freshCust = fetched;
          setCustomers((prev) =>
            prev.map((c) => (c.id === fetched.id ? { ...c, ...fetched } : c)),
          );
        }
      }
    } catch {}
    if (freshCust) {
      const currentOrder = editId
        ? orders.find((o: Order) => o.id === editId)
        : null;
      const canUseOrderNotesForCustomer = !hasMissingOrFallbackCustomerName(
        freshCust.name,
      );
      const noteSource = canUseOrderNotesForCustomer
        ? noteOverride !== undefined
          ? noteOverride
          : currentOrder?.notes
        : null;
      // ─── CRITICAL: Use a blank form as the base for merging, NOT the
      // potentially stale `newCust` state. This prevents data from a
      // previously viewed order/customer from leaking into the editor.
      // The customer's actual DB values are the sole source of truth.
      const blankForm = {
        name: "",
        phone: "",
        email: "",
        address: "",
        plz: "",
        city: "",
        country: "CH",
      };
      const merged = mergeCustomerIntoForm(
        blankForm,
        freshCust as any,
        noteSource,
      );
      setNewCust(merged);
    }
    setEditingCustomer(true);
    setShowNewCustomer(true);
  };

  // Media playback
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [customerMessageImagePreviewUrls, setCustomerMessageImagePreviewUrls] =
    useState<string[]>([]);

  // Dropdown menu for create offer/invoice
  const [dropdownOpenId, setDropdownOpenId] = useState<string | null>(null);
  const [serviceActionMenuKey, setServiceActionMenuKey] = useState<
    string | null
  >(null);
  const [catalogDecision, setCatalogDecision] = useState<null | {
    index: number;
    itemKey: string;
    normalizedName: string;
    existing: ServiceDef;
    price: number;
    unit: string;
  }>(null);
  const [catalogDecisionSaving, setCatalogDecisionSaving] = useState(false);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpenId) return;
    const handler = () => setDropdownOpenId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [dropdownOpenId]);

  // Close manual-service action menu when the user clicks anywhere outside it.
  useEffect(() => {
    if (!serviceActionMenuKey) return;
    const handler = () => setServiceActionMenuKey(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [serviceActionMenuKey]);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const {
      results: [o, c, s, settings],
      errors,
    } = await fetchAllJSON<[Order[], Customer[], ServiceDef[], any]>([
      { url: "/api/orders", fallback: [] },
      { url: "/api/customers", fallback: [] },
      { url: "/api/services", fallback: [] },
      { url: "/api/settings", fallback: null },
    ]);
    // If ALL critical endpoints failed, show error state
    if (errors.length >= 2) {
      setLoadError(errors);
      setLoading(false);
      return;
    }
    // Merge customers from orders (they may be soft-deleted and not in /api/customers)
    const custMap = new Map<string, Customer>();
    (c ?? []).forEach((cust: Customer) => custMap.set(cust.id, cust));
    (o ?? []).forEach((order: any) => {
      if (order.customer && !custMap.has(order.customer.id)) {
        custMap.set(order.customer.id, order.customer);
      }
    });
    setOrders(o ?? []);
    setCustomers(Array.from(custMap.values()));
    setServices(s ?? []);
    // Default VAT rate: from CompanySettings (mwstAktiv/mwstSatz) if available, else 8.1
    if (settings) {
      setCurrency(settings.currency === "EUR" ? "EUR" : "CHF");
      if (settings.mwstAktiv && settings.mwstSatz != null) {
        setDefaultVatRate(Number(settings.mwstSatz));
      } else if (settings.mwstAktiv === false) {
        setDefaultVatRate(0);
      }
    }
    // Show partial-failure toast if some requests failed but data is usable
    if (errors.length > 0)
      toast.error("Einige Daten konnten nicht vollständig geladen werden");
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // Auto-refresh on tab/window focus removed:
  // it caused visible reload flicker and scroll loss while editing orders.
  // Support ?kunde= filter from Kunden page, with optional autoEdit
  useEffect(() => {
    const kundeFilter = searchParams?.get("kunde");
    const autoEdit = searchParams?.get("autoEdit");
    if (kundeFilter) {
      setSearch(kundeFilter);
      if (autoEdit === "1" && orders.length > 0) {
        const match = orders.find(
          (o: Order) =>
            o.customer?.name?.toLowerCase() === kundeFilter.toLowerCase(),
        );
        if (match) openEdit(match);
      }
      router.replace("/auftraege", { scroll: false });
    }
  }, [orders]);

  useEffect(() => {
    const isNew = searchParams?.get("new") === "1";
    const custId = searchParams?.get("customerId");
    const editOrderId = searchParams?.get("edit");
    if (isNew) {
      setEditId(null);
      const newForm = { ...emptyForm };
      if (custId) newForm.customerId = custId;
      setForm(newForm);
      setFormItems([createEmptyItem()]);
      setFormWorkSites([]);
      setExpandedWorkSiteIds([]);
      setCustomerMessagesExpanded(false);
      setServiceOverviewExpanded(false);
      setShowNewCustomer(false);
      setDialogOpen(true);
      return;
    }
    // Package F: direct-fetch the exact target order by id so that open-from-detail
    // is reliable even if the order is filtered from the in-memory list (e.g.
    // already linked to an offer/invoice, or list still loading).
    if (editOrderId && !dialogOpen) {
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch(`/api/orders/${editOrderId}`);
          if (cancelled) return;
          if (!res.ok) {
            toast.error(
              res.status === 404
                ? "Auftrag nicht gefunden"
                : "Fehler beim Öffnen",
            );
            router.replace("/auftraege", { scroll: false });
            return;
          }
          const order = await res.json();
          if (cancelled) return;
          openEdit(order);
          router.replace("/auftraege", { scroll: false });
        } catch {
          if (!cancelled) {
            toast.error("Fehler beim Öffnen");
            router.replace("/auftraege", { scroll: false });
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Only show orders NOT linked to an offer or invoice (they've been "moved")
  const unlinked =
    orders?.filter((o: Order) => !o.offerId && !o.invoiceId) ?? [];
  const filtered = unlinked
    .filter((o: Order) => {
      if (statusFilter === "Offen" && o.status === "Erledigt") return false;
      if (statusFilter === "Erledigt" && o.status !== "Erledigt") return false;
      const s = search?.toLowerCase() ?? "";
      if (!s) return true;
      const svcLine =
        o.items && o.items.length > 0
          ? o.items.map((it) => it.serviceName).join(" ")
          : (o.serviceName ?? "");
      return (
        o?.description?.toLowerCase()?.includes(s) ||
        o?.customer?.name?.toLowerCase()?.includes(s) ||
        svcLine.toLowerCase().includes(s) ||
        o?.customer?.city?.toLowerCase()?.includes(s) ||
        o?.customer?.customerNumber?.toLowerCase()?.includes(s)
      );
    })
    .sort((a: Order, b: Order) => {
      switch (sortBy) {
        case "oldest":
          return (
            new Date(a.createdAt ?? a.date ?? 0).getTime() -
            new Date(b.createdAt ?? b.date ?? 0).getTime()
          );
        case "name":
          return (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "");
        case "amount":
          return getSafeOrderTotal(b) - getSafeOrderTotal(a);
        case "review":
          return (
            (b.needsReview ? 1 : 0) - (a.needsReview ? 1 : 0) ||
            new Date(b.createdAt ?? 0).getTime() -
              new Date(a.createdAt ?? 0).getTime()
          );
        default:
          return (
            new Date(b.createdAt ?? b.date ?? 0).getTime() -
            new Date(a.createdAt ?? a.date ?? 0).getTime()
          );
      }
    });

  const openNew = () => {
    setEditId(null);
    setForm(emptyForm);
    setFormItems([createEmptyItem()]);
    setFormWorkSites([]);
    setEditingWorkSiteId(null);
    setActiveWorkSiteId(null);
    setExpandedWorkSiteIds([]);
    setCustomerMessagesExpanded(false);
    setServiceOverviewExpanded(false);
    setSiteAddressEditing(false);
    setShowNewCustomer(false);
    setEditingCustomer(false);
    setOrderVatRate(defaultVatRate);
    setUndoPreviousAddress(null);
    setServiceActionMenuKey(null);
    setDialogOpen(true);
  };

  /**
   * Opens the order edit dialog for the given order.
   *
   * Optional `opts.openCustomerSection: true` immediately expands the
   * customer-edit panel and preloads fresh customer data — used by the
   * list-card "Kundendaten unvollständig" chip so the user lands directly
   * inside the customer editor with one tap (no extra "Bearbeiten" click).
   */
  const openEdit = (
    o: Order,
    opts?: { openCustomerSection?: boolean; focusSection?: "specialNotes" },
  ) => {
    setEditId(o.id);
    setServiceActionMenuKey(null);
    setDupCheckOpen(false);
    setUndoPreviousAddress(null);
    // ─── CRITICAL: Reset customer form to blank state BEFORE anything else.
    // Without this, stale customer data from a previously opened order leaks
    // into the merge logic of openCustomerEditor() and appears in the
    // customer editor for fallback / empty customers.
    setNewCust({
      name: "",
      phone: "",
      email: "",
      address: "",
      plz: "",
      city: "",
      country: "CH",
    });
    setForm({
      customerId: o.customerId ?? "",
      description: o.description ?? "",
      status: o.status ?? "Offen",
      date: o.date ? new Date(o.date).toISOString().split("T")[0] : "",
      notes: o.notes ?? "",
      specialNotes: (() => {
        const parsedSpecialNotes = splitSpecialNotes(o.specialNotes);
        return buildSpecialNotes({
          safetyWarnings: parsedSpecialNotes.safetyWarnings,
          jobHints: parsedSpecialNotes.jobHints,
        });
      })(),
      siteAddressDifferent: Boolean(o.siteAddressDifferent),
      siteName: o.siteName ?? "",
      siteAddress: o.siteAddress ?? "",
      sitePlz: o.sitePlz ?? "",
      siteCity: o.siteCity ?? "",
      siteNote: o.siteNote ?? "",
    });
    const nextWorkSites = (o.workSites ?? [])
      .slice()
      .sort(
        (a, b) =>
          Number(b.isPrimary ? 1 : 0) - Number(a.isPrimary ? 1 : 0) ||
          Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
      );
    setFormWorkSites(nextWorkSites);
    setEditingWorkSiteId(null);
    setActiveWorkSiteId(nextWorkSites[0]?.id || null);
    setExpandedWorkSiteIds([]);
    setCustomerMessagesExpanded(!shouldCollapseCustomerMessagesForOrder(o));
    setServiceOverviewExpanded(false);
    setMovingItemKey(null);
    setSiteAddressEditing(
      nextWorkSites.length <= 1 &&
        Boolean(o.siteAddressDifferent) &&
        ![o.siteName, o.siteAddress, o.sitePlz, o.siteCity, o.siteNote].some(
          (value) => String(value || "").trim(),
        ),
    );
    // Populate items from order
    if (o.items && o.items.length > 0) {
      setFormItems(
        mergeEquivalentFormItems(
          o.items.map((item) => {
            const hasQuantityReview = hasQuantityReviewForService(
              o.reviewReasons,
              item.serviceName,
            );

            return {
              key: Math.random().toString(36).slice(2),
              serviceName: canonicalServiceNameForOrderItem(item.serviceName ?? ""),
              unit: item.unit ?? "Stunde",
              unitPrice:
                Number(item.unitPrice || 0) === 0 ? "" : String(item.unitPrice),
              quantity: hasQuantityReview
                ? ""
                : Number(item.quantity || 0) === 0
                  ? ""
                  : String(item.quantity),
              aiWarning: getAiWarningFromItemDescription(item.description),
              catalogReviewConfirmed:
                getCatalogReviewConfirmedFromItemDescription(item.description),
              workSiteId: item.workSiteId || null,
            };
          }),
        ),
      );
    } else {
      setFormItems(
        mergeEquivalentFormItems([
          {
            key: Math.random().toString(36).slice(2),
            serviceName: o.serviceName ?? "",
            unit: o.priceType ?? "Stunde",
            unitPrice:
              Number(o.unitPrice || 0) === 0 ? "" : String(o.unitPrice),
            quantity: Number(o.quantity || 0) === 0 ? "" : String(o.quantity),
            aiWarning: "",
            catalogReviewConfirmed: false,
            workSiteId: null,
          },
        ]),
      );
    }
    if (opts?.openCustomerSection && o.customerId) {
      // Stage E (deterministic flow): DO NOT call openCustomerEditor() in this
      // synchronous click — React batches the setForm/setEditId/setDialogOpen
      // updates and the async fetch in openCustomerEditor would race against
      // them. Instead, mark a pending request; the effect below picks it up
      // once the dialog has mounted AND form.customerId matches, then loads
      // fresh customer data and reveals the editor section. This guarantees
      // the editor is opened *after* all opening-state has settled, so it can
      // never be stomped by openEdit's own resets.
      setPendingOpenCustomerEditor(o.customerId);
      // We intentionally DO NOT reset showNewCustomer / editingCustomer here.
      // The effect will set them to true once it runs.
    } else {
      setShowNewCustomer(false);
      setEditingCustomer(false);
      setPendingOpenCustomerEditor(null);
    }
    setOrderVatRate(o.vatRate != null ? Number(o.vatRate) : defaultVatRate);
    setCurrency(o.currency === "EUR" ? "EUR" : "CHF");
    setDialogOpen(true);
    setPendingFocusSection(opts?.focusSection || null);
    // V16.22: Do not auto-fill customer master data from order notes on dialog open.
    // Notes may contain execution addresses / onsite contact details and must not
    // silently write into the billing customer record. Manual customer editing stays available.
  };

  // Stage E (deterministic chip flow): the "open customer editor on dialog open"
  // effect. Watches for a pending request set by openEdit({openCustomerSection:true}).
  // Fires only AFTER the dialog has actually opened AND the form is populated
  // with the matching customerId — so it can never race against openEdit's own
  // state resets. Loads fresh customer data, reveals the editor, scrolls it
  // into view, then clears the pending flag.
  useEffect(() => {
    if (!pendingOpenCustomerEditor) return;
    if (!dialogOpen) return;
    if (form.customerId !== pendingOpenCustomerEditor) return;
    const targetId = pendingOpenCustomerEditor;
    let cancelled = false;
    (async () => {
      try {
        let freshCust: Customer | null =
          customers.find((c: Customer) => c.id === targetId) || null;
        try {
          const res = await fetch(`/api/customers/${targetId}`);
          if (res.ok) {
            const fetched = await res.json();
            if (fetched && fetched.id) {
              freshCust = fetched;
              if (!cancelled) {
                setCustomers((prev) =>
                  prev.map((c) =>
                    c.id === fetched.id ? { ...c, ...fetched } : c,
                  ),
                );
              }
            }
          }
        } catch {}
        if (cancelled) return;
        if (freshCust) {
          const currentOrder = editId
            ? orders.find((o: Order) => o.id === editId)
            : null;
          const noteSource = hasMissingOrFallbackCustomerName(freshCust.name)
            ? null
            : (currentOrder?.notes ?? null);
          const merged = mergeCustomerIntoForm(
            {
              name: "",
              phone: "",
              email: "",
              address: "",
              plz: "",
              city: "",
              country: "CH",
            },
            freshCust as any,
            noteSource,
          );
          setNewCust(merged);
        }
        // Reveal the editor — these run AFTER dialog open and AFTER any reset.
        setEditingCustomer(true);
        setShowNewCustomer(true);
        setPendingOpenCustomerEditor(null);
        // Scroll the editor into view on the next paint.
        requestAnimationFrame(() => {
          customerEditorRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        });
      } catch {
        if (!cancelled) setPendingOpenCustomerEditor(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenCustomerEditor, dialogOpen, form.customerId]);

  // Clear the pending flag when the dialog closes — prevents a stale request
  // from triggering on a subsequent unrelated open.
  useEffect(() => {
    if (!dialogOpen) {
      setPendingOpenCustomerEditor(null);
      setPendingFocusSection(null);
    }
  }, [dialogOpen]);

  useEffect(() => {
    if (!dialogOpen || pendingFocusSection !== "specialNotes") return;

    const frame = requestAnimationFrame(() => {
      specialNotesRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      specialNotesRef.current?.focus?.();
      setPendingFocusSection(null);
    });

    return () => cancelAnimationFrame(frame);
  }, [dialogOpen, pendingFocusSection]);

  // ISSUE 2 — Fetch inline PLZ/city suggestion when customer card is shown.
  // Only fires for existing customers (editId) with missing PLZ or city.
  useEffect(() => {
    if (!dialogOpen || !editId || !form.customerId) {
      setInlineSuggestion(null);
      return;
    }
    // Don't fetch while customer editor is open (user is editing)
    if (showNewCustomer) return;
    const cust = customers.find((c: Customer) => c.id === form.customerId);
    if (!cust) return;
    const hasName = (cust.name || "").trim().length > 0;
    const hasAddress = (cust.address || "").trim().length > 0;
    const hasPlz = (cust.plz || "").trim().length > 0;
    const hasCity = (cust.city || "").trim().length > 0;
    // Need at least name + address + one of (plz, city) to check, and the other must be empty
    if (!hasName || !hasAddress) {
      setInlineSuggestion(null);
      return;
    }
    if (hasPlz && hasCity) {
      setInlineSuggestion(null);
      return;
    } // nothing missing
    if (!hasPlz && !hasCity) {
      setInlineSuggestion(null);
      return;
    } // can't suggest without either
    const fetchId = ++inlineSuggestionFetchRef.current;
    (async () => {
      try {
        const res = await fetch("/api/customers/find-duplicates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: cust.name,
            address: cust.address,
            plz: cust.plz,
            city: cust.city,
            phone: cust.phone,
            email: cust.email,
            excludeId: cust.id,
          }),
        });
        if (fetchId !== inlineSuggestionFetchRef.current) return;
        if (!res.ok) return;
        const matches = await res.json();
        const exakt = matches.filter((m: any) => m.classification === "EXAKT");
        if (exakt.length === 0) {
          setInlineSuggestion(null);
          return;
        }
        if (!hasPlz && hasCity) {
          // Suggest PLZ from exact matches
          const withPlz = exakt.filter(
            (m: any) => (m.plz || "").trim().length > 0,
          );
          if (withPlz.length === 0) {
            setInlineSuggestion(null);
            return;
          }
          const unique = Array.from(
            new Set(
              withPlz.map((m: any) => (m.plz || "").trim().toLowerCase()),
            ),
          );
          if (unique.length !== 1) {
            setInlineSuggestion(null);
            return;
          }
          setInlineSuggestion({
            type: "plz",
            value: (withPlz[0].plz || "").trim(),
            sourceName: withPlz[0].name,
          });
        } else if (hasPlz && !hasCity) {
          // Suggest city from exact matches
          const withCity = exakt.filter(
            (m: any) => (m.city || "").trim().length > 0,
          );
          if (withCity.length === 0) {
            setInlineSuggestion(null);
            return;
          }
          const unique = Array.from(
            new Set(
              withCity.map((m: any) => (m.city || "").trim().toLowerCase()),
            ),
          );
          if (unique.length !== 1) {
            setInlineSuggestion(null);
            return;
          }
          setInlineSuggestion({
            type: "city",
            value: (withCity[0].city || "").trim(),
            sourceName: withCity[0].name,
          });
        } else {
          setInlineSuggestion(null);
        }
      } catch {
        // Network error — no suggestion
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen, editId, form.customerId, showNewCustomer, customers]);

  const applyInlineSuggestion = async () => {
    if (!inlineSuggestion || !form.customerId) return;
    const cust = customers.find((c: Customer) => c.id === form.customerId);
    if (!cust) return;
    const field = inlineSuggestion.type; // 'plz' or 'city'
    const value = inlineSuggestion.value;
    try {
      const res = await fetch(`/api/customers/${cust.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCustomers((prev) =>
          prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
        );
        toast.success(
          `${field === "plz" ? "PLZ" : "Ort"} übernommen: ${value}`,
        );
        setInlineSuggestion(null);
      } else {
        toast.error("Fehler beim Übernehmen");
      }
    } catch {
      toast.error("Netzwerkfehler");
    }
  };

  const onItemServiceSelect = (
    index: number,
    name: string,
    svcOpt?: ServiceOption,
  ) => {
    const svc = svcOpt;

    setFormItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;

        if (svc) {
          return {
            ...item,
            serviceName: svc.name,
            unitPrice: item.unitPrice || String(svc.defaultPrice ?? 0),
            unit: item.unit || svc.unit || "Stunde",
          };
        }

        if (!name) {
          return {
            ...item,
            serviceName: "",
            unitPrice: "",
            quantity: "",
            unit: "Stunde",
          };
        }

        return {
          ...item,
          serviceName: name,
        };
      }),
    );
  };

  const handleServiceCreated = (newSvc: ServiceOption) => {
    setServices((prev) => {
      const next = prev.filter(
        (service) =>
          service.id !== newSvc.id &&
          normalizeForMatch(service.name) !== normalizeForMatch(newSvc.name),
      );

      return [...next, newSvc as any].sort((a, b) =>
        (a?.name ?? "").localeCompare(b?.name ?? "", "de", {
          sensitivity: "base",
        }),
      );
    });
  };

  const isServiceInCatalog = (name?: string | null) => {
    const key = normalizeForMatch(name);
    if (!key) return false;
    return services.some((service) => normalizeForMatch(service.name) === key);
  };

  const getCatalogResolvedFormItems = (
    sourceItems: FormItem[],
    index: number,
    overrides: Partial<FormItem> = {},
  ) =>
    sourceItems.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            ...overrides,
            aiWarning: "",
          }
        : item,
    );

  const markItemCatalogReviewResolved = (
    index: number,
    overrides: Partial<FormItem> = {},
  ) => {
    setFormItems((prev) => getCatalogResolvedFormItems(prev, index, overrides));
  };

  const saveItemToServices = async (index: number) => {
    const item = formItems[index];
    if (!item?.serviceName?.trim()) return;

    const normalizedName = item.serviceName.trim().replace(/\s+/g, " ");
    const existing = services.find(
      (service) =>
        normalizeForMatch(service.name) === normalizeForMatch(normalizedName),
    );

    const price = Number(item.unitPrice || 0);
    if (!price || price <= 0) {
      toast.error("Preis zuerst prüfen, dann in Leistungen übernehmen");
      return;
    }

    const existingUnit = normalizePriceUnitForCompare(existing?.unit);
    const itemUnit = normalizePriceUnitForCompare(item.unit);
    const existingPrice = Number(existing?.defaultPrice || 0);
    const existingNeedsUpdate = Boolean(
      existing &&
        (existingUnit !== itemUnit || Math.abs(existingPrice - price) >= 0.01),
    );

    if (existing && existingNeedsUpdate) {
      setCatalogDecision({
        index,
        itemKey: item.key,
        normalizedName,
        existing,
        price,
        unit: item.unit,
      });
      setServiceActionMenuKey(null);
      return;
    }

    if (existing && !existingNeedsUpdate) {
      const nextItems = getCatalogResolvedFormItems(formItems, index, {
        serviceName: existing.name,
        catalogReviewConfirmed: false,
      });
      setFormItems(nextItems);

      if (editId) {
        const saved = await saveOrder(
          undefined,
          nextItems,
          new Set([normalizeForMatch(existing.name)]),
        );
        if (saved) {
          setOrders((prev) =>
            prev.map((order) =>
              order.id === saved.id ? { ...order, ...saved } : order,
            ),
          );
          await load();
        }
      }

      setServiceActionMenuKey(null);
      toast.success("Leistung ist im Katalog und wurde im Auftrag gespeichert ✓");
      return;
    }

    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          defaultPrice: price,
          unit: item.unit,
        }),
      });

      if (!res.ok) throw new Error("Fehler beim Speichern");

      const savedService: ServiceOption = await res.json();
      handleServiceCreated(savedService);
      onItemServiceSelect(index, savedService.name, savedService);
      const nextItems = getCatalogResolvedFormItems(formItems, index, {
        serviceName: savedService.name,
        catalogReviewConfirmed: false,
      });
      setFormItems(nextItems);

      if (editId) {
        const saved = await saveOrder(
          undefined,
          nextItems,
          new Set([normalizeForMatch(savedService.name)]),
        );
        if (saved) {
          setOrders((prev) =>
            prev.map((order) =>
              order.id === saved.id ? { ...order, ...saved } : order,
            ),
          );
          await load();
        }
      }

      setServiceActionMenuKey(null);
      toast.success("Leistung wurde in Leistungen übernommen und Auftrag gespeichert ✓");
    } catch {
      toast.error("Leistung konnte nicht übernommen werden");
    }
  };

  const resolveCatalogDecisionForCurrentOrder = async () => {
    if (!catalogDecision) return;

    const index = formItems.findIndex(
      (item) => item.key === catalogDecision.itemKey,
    );
    if (index < 0) {
      setCatalogDecision(null);
      return;
    }

    const nextItems = getCatalogResolvedFormItems(formItems, index, {
      serviceName: catalogDecision.existing.name || catalogDecision.normalizedName,
      catalogReviewConfirmed: true,
    });

    setCatalogDecisionSaving(true);
    try {
      setFormItems(nextItems);

      if (editId) {
        const saved = await saveOrder(undefined, nextItems);
        if (!saved) return;

        setOrders((prev) =>
          prev.map((order) =>
            order.id === saved.id ? { ...order, ...saved } : order,
          ),
        );
        await load();
      }

      setCatalogDecision(null);
      setServiceActionMenuKey(null);
      toast.success("Nur dieser Auftrag wurde dauerhaft als geprüft gespeichert ✓");
    } catch {
      toast.error("Prüfung konnte nicht gespeichert werden");
    } finally {
      setCatalogDecisionSaving(false);
    }
  };

  const updateCatalogPriceFromDecision = async () => {
    if (!catalogDecision) return;

    const index = formItems.findIndex(
      (item) => item.key === catalogDecision.itemKey,
    );
    if (index < 0) {
      setCatalogDecision(null);
      return;
    }

    setCatalogDecisionSaving(true);
    try {
      const res = await fetch("/api/services", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: catalogDecision.existing.id,
          name: catalogDecision.existing.name || catalogDecision.normalizedName,
          defaultPrice: catalogDecision.price,
          unit: catalogDecision.unit,
        }),
      });

      if (!res.ok) throw new Error("Fehler beim Speichern");

      const savedService: ServiceOption = await res.json();
      handleServiceCreated(savedService);
      onItemServiceSelect(index, savedService.name, savedService);
      const nextItems = getCatalogResolvedFormItems(formItems, index, {
        serviceName: savedService.name,
        unit: catalogDecision.unit,
        unitPrice: String(catalogDecision.price),
        catalogReviewConfirmed: false,
      });

      setFormItems(nextItems);

      if (editId) {
        const saved = await saveOrder(
          undefined,
          nextItems,
          new Set([normalizeForMatch(savedService.name)]),
        );
        if (!saved) return;

        setOrders((prev) =>
          prev.map((order) =>
            order.id === saved.id ? { ...order, ...saved } : order,
          ),
        );
        await load();
      }

      setCatalogDecision(null);
      setServiceActionMenuKey(null);
      toast.success("Katalogpreis wurde global aktualisiert und Auftrag gespeichert ✓");
    } catch {
      toast.error("Katalogpreis konnte nicht aktualisiert werden");
    } finally {
      setCatalogDecisionSaving(false);
    }
  };

  const updateItem = (index: number, field: keyof FormItem, value: string) => {
    if (field === "workSiteId") {
      setActiveWorkSiteId(value || null);
    }

    setFormItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const addItem = () => {
    const nextItem = {
      ...createEmptyItem(),
      workSiteId: null,
    };

    setFormItems((prev) => [nextItem, ...prev]);
    setExpandedWorkSiteIds((prev) =>
      prev.includes("__unassigned__") ? prev : ["__unassigned__", ...prev],
    );
    setMovingItemKey(hasMultipleEditWorkSites ? nextItem.key : null);
    setServiceActionMenuKey(null);
  };

  const addItemToWorkSite = (siteId?: string | null) => {
    const nextItem = {
      ...createEmptyItem(),
      workSiteId: siteId || null,
    };

    setFormItems((prev) => [nextItem, ...prev]);

    if (siteId) {
      setActiveWorkSiteId(siteId);
      setExpandedWorkSiteIds((prev) =>
        prev.includes(siteId) ? prev : [siteId, ...prev],
      );
      setMovingItemKey(null);
    } else {
      setExpandedWorkSiteIds((prev) =>
        prev.includes("__unassigned__") ? prev : ["__unassigned__", ...prev],
      );
      setMovingItemKey(hasMultipleEditWorkSites ? nextItem.key : null);
    }

    setServiceActionMenuKey(null);
  };

  const removeItem = (index: number) => {
    setFormItems((prev) => {
      if (prev.length <= 1) return [createEmptyItem()];
      return prev.filter((_, i) => i !== index);
    });
  };

  const itemsTotal = formItems.reduce(
    (sum, item) =>
      sum + Number(item.unitPrice || 0) * Number(item.quantity || 0),
    0,
  );

  const totalWithVat = itemsTotal + (itemsTotal * orderVatRate) / 100;

  const currentEditOrder = editId
    ? orders.find((o: Order) => o.id === editId) || null
    : null;

  const hasWorkSiteContent = (site?: OrderWorkSite | null) =>
    Boolean(
      compactText(site?.siteName) ||
        compactText(site?.siteAddress) ||
        compactText(site?.sitePlz) ||
        compactText(site?.siteCity) ||
        compactText(site?.siteNote),
    );

  const hasItemsAssignedToWorkSite = (siteId?: string | null) =>
    Boolean(siteId) && formItems.some((item) => item.workSiteId === siteId);

  const currentEditWorkSites = formWorkSites
    .filter(
      (site) =>
        hasWorkSiteContent(site) ||
        hasItemsAssignedToWorkSite(site.id) ||
        site.id === editingWorkSiteId ||
        site.id === activeWorkSiteId,
    )
    .slice()
    .sort(
      (a, b) =>
        Number(b.isPrimary ? 1 : 0) - Number(a.isPrimary ? 1 : 0) ||
        Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
    );

  const hasMultipleEditWorkSites = currentEditWorkSites.length > 1;

  const normalizeWorkSiteText = (value?: string | null) =>
    compactText(value).toLowerCase();

  const escapeWorkSiteRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const stripDuplicateAddressFromSiteTitle = (
    titleValue?: string | null,
    addressValue?: string | null,
  ) => {
    let title = compactText(titleValue);
    const address = compactText(addressValue);
    if (!title) return "";
    if (!address) return title;

    const escapedAddress = escapeWorkSiteRegExp(address);
    title = title
      .replace(new RegExp(`\\s*[·,;-]\\s*${escapedAddress}\\s*$`, "i"), "")
      .replace(new RegExp(`\\s+${escapedAddress}\\s*$`, "i"), "")
      .replace(/\s*[·,;-]\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return title;
  };

  const formatWorkSiteTitle = (site?: OrderWorkSite | null) => {
    if (!site) return "Ausführungsort";
    return (
      stripDuplicateAddressFromSiteTitle(site.siteName, site.siteAddress) ||
      compactText(site.siteAddress) ||
      "Ausführungsort"
    );
  };

  const formatWorkSiteAddress = (site?: OrderWorkSite | null) => {
    if (!site) return "";
    const titleKey = normalizeWorkSiteText(site.siteName);
    const address = compactText(site.siteAddress);
    const addressKey = normalizeWorkSiteText(site.siteAddress);
    return [
      address && addressKey !== titleKey ? address : "",
      [site.sitePlz, site.siteCity].map(compactText).filter(Boolean).join(" "),
      compactText(site.siteNote),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const getWorkSiteItems = (siteId?: string | null) =>
    formItems.filter((item) => item.workSiteId && item.workSiteId === siteId);

  const getWorkSiteTotal = (siteId?: string | null) =>
    getWorkSiteItems(siteId).reduce(
      (sum, item) =>
        sum + Number(item.unitPrice || 0) * Number(item.quantity || 0),
      0,
    );

  const updateFormWorkSite = (
    siteId: string,
    field: keyof OrderWorkSite,
    value: string | boolean | number | null,
  ) => {
    setFormWorkSites((prev) =>
      prev.map((site) =>
        site.id === siteId ? { ...site, [field]: value } : site,
      ),
    );
  };

  const addFormWorkSite = () => {
    const openDraft = formWorkSites.find(
      (site) => !hasWorkSiteContent(site) && !hasItemsAssignedToWorkSite(site.id),
    );

    if (openDraft) {
      setEditingWorkSiteId(openDraft.id);
      setActiveWorkSiteId(openDraft.id);
      setExpandedWorkSiteIds((prev) =>
        prev.includes(openDraft.id) ? prev : [openDraft.id, ...prev],
      );
      toast.info("Leeren Arbeitsort zuerst ausfüllen oder löschen.");
      return;
    }

    const newId = `tmp-${Math.random().toString(36).slice(2)}`;
    setFormWorkSites((prev) => [
      ...prev,
      {
        id: newId,
        siteName: "",
        siteAddress: "",
        sitePlz: "",
        siteCity: "",
        siteNote: "",
        isPrimary: false,
        sortOrder: prev.length,
      },
    ]);
    setEditingWorkSiteId(newId);
    setActiveWorkSiteId(newId);
    setExpandedWorkSiteIds((prev) =>
      prev.includes(newId) ? prev : [newId, ...prev],
    );
  };

  const removeFormWorkSite = (siteId: string) => {
    const assignedItems = formItems.filter(
      (item) => item.workSiteId === siteId,
    );
    if (assignedItems.length > 0) {
      toast.error(
        "Arbeitsort kann nicht gelöscht werden: Leistungen sind noch zugeordnet.",
      );
      return;
    }

    setFormWorkSites((prev) => prev.filter((site) => site.id !== siteId));
    setEditingWorkSiteId((prev) => (prev === siteId ? null : prev));
  };

  const getWorkSiteSelectLabel = (site: OrderWorkSite) => {
    const title = formatWorkSiteTitle(site);
    const address = formatWorkSiteAddress(site);
    return [title, address].filter(Boolean).join(" · ") || "Arbeitsort prüfen";
  };

  const getWorkSiteShortLabel = (site?: OrderWorkSite | null) => {
    if (!site) return "Ohne Arbeitsort";
    return formatWorkSiteTitle(site);
  };

  const getWorkSiteGroupKey = (site?: OrderWorkSite | null) =>
    site?.id || "__unassigned__";

  const getWorkSiteGroupItems = (site?: OrderWorkSite | null) =>
    site
      ? getWorkSiteItems(site.id)
      : formItems.filter((item) => !item.workSiteId);

  const isWorkSiteGroupExpanded = (site?: OrderWorkSite | null) =>
    !hasMultipleEditWorkSites ||
    expandedWorkSiteIds.includes(getWorkSiteGroupKey(site)) ||
    (!site && formItems.some((item) => !item.workSiteId));

  const toggleWorkSiteGroup = (site?: OrderWorkSite | null) => {
    const key = getWorkSiteGroupKey(site);
    setExpandedWorkSiteIds((prev) =>
      prev.includes(key)
        ? prev.filter((entry) => entry !== key)
        : [key, ...prev],
    );
  };

  const toggleWorkSiteOverview = () => {
    const allGroupKeys = [
      ...(formItems.some((item) => !item.workSiteId) ? ["__unassigned__"] : []),
      ...currentEditWorkSites.map((site) => site.id),
    ];

    const allOpen =
      allGroupKeys.length > 0 &&
      allGroupKeys.every((key) => expandedWorkSiteIds.includes(key));

    setExpandedWorkSiteIds(allOpen ? [] : allGroupKeys);
    setEditingWorkSiteId(null);
    setMovingItemKey(null);
  };

  const formatWorkSiteItemSummary = (item: FormItem) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const total = quantity > 0 && unitPrice > 0 ? quantity * unitPrice : 0;
    const quantityLabel =
      quantity > 0
        ? `${item.quantity} ${unitShortLabel(item.unit)}`
        : "Menge prüfen";
    const totalLabel = total > 0 ? ` · ${formatCurrency(total, currency)}` : "";
    return `${item.serviceName || "Leistung prüfen"} · ${quantityLabel}${totalLabel}`;
  };

  const formItemDisplayRows = hasMultipleEditWorkSites
    ? [
        ...formItems
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => !item.workSiteId)
          .map(({ item, index }, siteItemIndex) => ({
            item,
            index,
            site: null as OrderWorkSite | null,
            isFirstInSite: siteItemIndex === 0,
            isEmptySitePlaceholder: false,
          })),
        ...currentEditWorkSites.flatMap((site) => {
          const siteRows = formItems
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => item.workSiteId === site.id);

          if (siteRows.length === 0) {
            return [
              {
                item: {
                  ...createEmptyItem(),
                  key: `empty-site-${site.id}`,
                  workSiteId: site.id,
                },
                index: -1,
                site,
                isFirstInSite: true,
                isEmptySitePlaceholder: true,
              },
            ];
          }

          return siteRows.map(({ item, index }, siteItemIndex) => ({
            item,
            index,
            site,
            isFirstInSite: siteItemIndex === 0,
            isEmptySitePlaceholder: false,
          }));
        }),
      ]
    : formItems.map((item, index) => ({
        item,
        index,
        site: null as OrderWorkSite | null,
        isFirstInSite: false,
        isEmptySitePlaceholder: false,
      }));

  const currentEditReviewReasons = currentEditOrder?.reviewReasons ?? [];
  const formHasResolvedCurrencyReview =
    (currency === "CHF" || currency === "EUR") &&
    formItems.length > 0 &&
    formItems.every(
      (item) =>
        item.serviceName.trim().length > 0 &&
        Number(item.unitPrice || 0) > 0 &&
        Number(item.quantity || 0) > 0,
    );
  const hasEditCurrencyReview =
    currentEditReviewReasons.some(
      (reason: string) =>
        reason.startsWith("currency_") ||
        reason.startsWith("item_currency_mismatch"),
    ) && !formHasResolvedCurrencyReview;

  const unitShortLabel = (unit: string) => {
    const normalized = (unit || "").toLowerCase();
    if (normalized === "quadratmeter") return "m²";
    if (normalized === "kubikmeter") return "m³";
    if (normalized === "meter") return "m";
    if (normalized === "stunde") return "Std.";
    if (normalized === "tag") return "Tag";
    if (normalized === "pauschal") return "pauschal";
    if (normalized === "stück") return "Stück";
    if (normalized === "kilogramm") return "kg";
    if (normalized === "tonne") return "t";
    if (normalized === "liter") return "l";
    return unit || "–";
  };

  const liveOverviewRows = formItems
    .filter((item) => item.serviceName.trim())
    .map((item, index) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unitPrice || 0);
      const hasQuantity = quantity > 0;
      const hasPrice = unitPrice > 0;
      const sum = hasQuantity && hasPrice ? quantity * unitPrice : 0;

      return {
        index: index + 1,
        serviceName: item.serviceName.trim(),
        unit: item.unit,
        unitLabel: unitShortLabel(item.unit),
        quantity,
        unitPrice,
        hasQuantity,
        hasPrice,
        workSiteId: item.workSiteId || null,
        sum,
      };
    });

  const liveOverviewGroups = hasMultipleEditWorkSites
    ? [
        {
          key: "__unassigned__",
          title: "Ohne Arbeitsort",
          address: "Bitte zuordnen",
          rows: liveOverviewRows.filter((row) => !row.workSiteId),
        },
        ...currentEditWorkSites.map((site) => ({
          key: site.id,
          title: formatWorkSiteTitle(site),
          address: formatWorkSiteAddress(site),
          rows: liveOverviewRows.filter((row) => row.workSiteId === site.id),
        })),
      ].filter((group) => group.rows.length > 0)
    : [];

  const parsedFormSpecialNotes = splitSpecialNotes(form.specialNotes);
  const dangerNoteLines = parsedFormSpecialNotes.safetyWarnings;
  const normalSpecialNotesText = formatSpecialNotesForDisplay(
    parsedFormSpecialNotes.jobHints,
  );

  const updateNormalSpecialNotes = (value: string) => {
    const nextJobHints = value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && !isSpecialNotesGroupSeparator(line));

    setForm((prev) => {
      const previousNotes = splitSpecialNotes(prev.specialNotes);

      return {
        ...prev,
        specialNotes: buildSpecialNotes({
          safetyWarnings: previousNotes.safetyWarnings,
          jobHints: nextJobHints,
        }),
      };
    });
  };

  const customerMessageText = (
    currentEditOrder?.notes ||
    currentEditOrder?.audioTranscript ||
    form.notes ||
    ""
  ).trim();

  const normalizeCustomerMessageForCompare = (value?: string | null) =>
    String(value || "")
      .replace(/^(whatsapp|telegram):\s*/i, "")
      .replace(/\[\s*(?:transkription|transcription|transkript)\s*\]/gi, "")
      .replace(/\n?\[Titel:.*?\]/gi, "")
      .replace(/\n?\[Priorität:.*?\]/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const customerMessageTranscriptDuplicate = Boolean(
    currentEditOrder?.audioTranscript &&
    customerMessageText &&
    (() => {
      const msg = normalizeCustomerMessageForCompare(customerMessageText);
      const transcript = normalizeCustomerMessageForCompare(
        currentEditOrder.audioTranscript,
      );
      return Boolean(
        msg &&
        transcript &&
        (msg === transcript ||
          msg.includes(transcript) ||
          transcript.includes(msg)),
      );
    })(),
  );

  const visibleCustomerMessageText = customerMessageTranscriptDuplicate
    ? ""
    : customerMessageText;

  const shouldCollapseCustomerMessages = currentEditOrder
    ? shouldCollapseCustomerMessagesForOrder(currentEditOrder)
    : false;
  const customerMessagesVisible =
    !shouldCollapseCustomerMessages || customerMessagesExpanded;

  // Build description from items
  const buildDescription = () => {
    return (
      formItems
        .filter((i) => i.serviceName)
        .map((i) => i.serviceName)
        .join(", ") || form.description
    );
  };

  // Save customer (update or create — no merge logic, merge goes via Sheet)
  const saveCustomer = async () => {
    if (!newCust.name.trim()) {
      toast.error("Name erforderlich");
      return;
    }
    setSavingCust(true);
    try {
      if (editingCustomer && form.customerId) {
        // Phase 2f: compute fieldsToClear = fields where DB had a value but user
        // intentionally emptied them. Only these are allowed to be cleared by the
        // server's opt-in clear-protection guard.
        const dbCust = customers.find(
          (c: Customer) => c.id === form.customerId,
        );
        const fieldsToClear: string[] = [];
        if (dbCust) {
          (
            ["name", "phone", "email", "address", "plz", "city"] as const
          ).forEach((k) => {
            const was = (dbCust as any)[k];
            const now = (newCust as any)[k];
            if (was && String(was).trim() && !String(now || "").trim())
              fieldsToClear.push(k);
          });
        }
        // Update existing customer
        const res = await fetch(`/api/customers/${form.customerId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...newCust, fieldsToClear }),
        });
        if (res.ok) {
          const updated = await res.json();
          setCustomers((prev) =>
            prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
          );
          // Also update nested customer in orders so list/cards refresh immediately
          setOrders((prev) =>
            prev.map((o) =>
              o.customerId === updated.id
                ? { ...o, customer: { ...o.customer, ...updated } }
                : o,
            ),
          );
          setForm((f) => ({ ...f, customerId: updated.id }));
          // Clear needsReview if address is now complete (Straße + PLZ + Ort)
          if (
            editId &&
            updated.name?.trim() &&
            updated.address?.trim() &&
            updated.plz?.trim() &&
            updated.city?.trim()
          ) {
            const curOrder = orders.find((o: Order) => o.id === editId);
            if (curOrder?.needsReview) {
              try {
                await fetch(`/api/orders/${editId}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    needsReview: false,
                    reviewReasons: [],
                  }),
                });
                setOrders((prev) =>
                  prev.map((o) =>
                    o.id === editId ? { ...o, needsReview: false } : o,
                  ),
                );
              } catch {}
            }
          }
          toast.success(`Kunde "${updated.name}" aktualisiert!`);
        } else {
          const err = await res.json().catch(() => ({}) as any);
          if (err?.reason === "would_clear_existing_value")
            toast.error(err?.error || "Feld kann nicht geleert werden.");
          else toast.error("Fehler beim Aktualisieren");
          return;
        }
      } else {
        // Create new customer
        const res = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newCust),
        });
        if (res.ok) {
          const created = await res.json();
          setCustomers((prev) => [...prev, created]);
          setForm((f) => ({ ...f, customerId: created.id }));
          toast.success("Neuer Kunde erstellt – eigene ID wurde vergeben");
        } else toast.error("Fehler beim Anlegen");
      }
      setShowNewCustomer(false);
      setEditingCustomer(false);
      setNewCust({
        name: "",
        phone: "",
        email: "",
        address: "",
        plz: "",
        city: "",
        country: "CH",
      });
    } catch {
      toast.error("Fehler");
    } finally {
      setSavingCust(false);
    }
  };

  // Core save function — returns saved order or null
  const saveOrder = async (
    payloadOverrides?: Partial<typeof form>,
    itemsOverride?: FormItem[],
    resolvedCatalogServiceNamesOverride?: Set<string>,
  ): Promise<Order | null> => {
    if (!form.customerId) {
      toast.error("Bitte Kunde auswählen");
      return null;
    }
    const sourceFormItems = itemsOverride ?? formItems;
    const validItems = mergeEquivalentFormItems(
      sourceFormItems.filter((i) => i.serviceName.trim()),
    );
    if (validItems.length === 0) {
      toast.error("Mindestens eine Leistung auswählen");
      return null;
    }

    const assignedWorkSiteIds = new Set(
      validItems
        .map((item) => item.workSiteId)
        .filter((siteId): siteId is string => Boolean(siteId)),
    );
    const cleanWorkSites = formWorkSites.filter(
      (site) => hasWorkSiteContent(site) || assignedWorkSiteIds.has(site.id),
    );

    if (
      cleanWorkSites.length > 1 &&
      validItems.some((item) => !item.workSiteId)
    ) {
      toast.error("Bitte jeder Leistung einen Arbeitsort zuordnen.");
      return null;
    }
    const desc = form.description?.trim() || buildDescription();
    if (!desc) {
      toast.error("Beschreibung erforderlich");
      return null;
    }

    const url = editId ? `/api/orders/${editId}` : "/api/orders";
    const method = editId ? "PUT" : "POST";
    const validServiceNames = new Set(
      validItems
        .filter(
          (item) =>
            Number(item.quantity || 0) > 0 && Number(item.unitPrice || 0) > 0,
        )
        .map((item) => normalizeForMatch(item.serviceName)),
    );

    const confirmedCatalogReviewServiceNames = new Set(
      validItems
        .filter((item) => Boolean(item.catalogReviewConfirmed))
        .map((item) => normalizeForMatch(item.serviceName)),
    );

    resolvedCatalogServiceNamesOverride?.forEach((serviceName) => {
      if (serviceName) confirmedCatalogReviewServiceNames.add(serviceName);
    });

    const allItemsComplete = validItems.every(
      (item) =>
        item.serviceName.trim().length > 0 &&
        Number(item.quantity || 0) > 0 &&
        Number(item.unitPrice || 0) > 0,
    );

    const allServicesInCatalog = validItems.every((item) =>
      isServiceInCatalog(item.serviceName),
    );

    const cleanedReviewReasons =
      orders
        .find((o) => o.id === editId)
        ?.reviewReasons?.filter((reason) => {
          if (reason.startsWith("unit_mismatch:")) {
            const [, reasonService] = reason.split(":");
            const reasonName = normalizeForMatch(reasonService);
            return !validServiceNames.has(reasonName);
          }

          if (reason.startsWith("price_override:")) {
            const [, reasonService] = reason.split(":");
            const reasonName = normalizeForMatch(reasonService);
            return !confirmedCatalogReviewServiceNames.has(reasonName);
          }

          if (
            allItemsComplete &&
            (reason.startsWith("currency_") ||
              reason.startsWith("item_currency_mismatch") ||
              reason.startsWith("price_unclear:") ||
              reason === "unit_price_review" ||
              reason === "quantity_review" ||
              reason === "manual_flat_service_from_text" ||
              reason === "stunden_arbeitsposition_pruefen")
          ) {
            return false;
          }

          if (
            allServicesInCatalog &&
            reason === "unbekannte_leistung_pruefen"
          ) {
            return false;
          }

          return true;
        }) ?? [];

    const payload = {
      ...form,
      ...payloadOverrides,
      description: desc,
      vatRate: orderVatRate,
      currency,
      reviewReasons: cleanedReviewReasons,
      needsReview: cleanedReviewReasons.length > 0,
      workSites:
        editId && cleanWorkSites.length > 0
          ? cleanWorkSites.map((site, index) => ({
              id: site.id,
              siteName: cleanWorkSiteDisplayName(site.siteName) || null,
              siteAddress: site.siteAddress?.trim() || null,
              sitePlz: site.sitePlz?.trim() || null,
              siteCity: site.siteCity?.trim() || null,
              siteNote: site.siteNote?.trim() || null,
              isPrimary: Boolean(site.isPrimary) || index === 0,
              sortOrder: index,
              sourceOrderId: (site as any).sourceOrderId || null,
            }))
          : undefined,
      items: validItems.map((item) => ({
        serviceName: canonicalServiceNameForOrderItem(item.serviceName),
        description: buildItemDescription(item),
        quantity: Number(item.quantity || 0),
        unit: item.unit,
        unitPrice: Number(item.unitPrice || 0),
        workSiteId: item.workSiteId || null,
      })),
    };
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const saved = await res.json();
      return saved;
    }
    toast.error("Fehler beim Speichern");
    return null;
  };

  const save = async (options?: { closeAfter?: boolean }) => {
    setSaving(true);
    try {
      const saved = await saveOrder();
      if (saved) {
        const successText = editId ? "Auftrag gespeichert" : "Auftrag erstellt";
        toast.success(
          options?.closeAfter
            ? `${successText} und geschlossen`
            : `${successText} ✓`,
        );

        setOrders((prev) => {
          const exists = prev.some((order) => order.id === saved.id);
          if (exists) {
            return prev.map((order) =>
              order.id === saved.id ? { ...order, ...saved } : order,
            );
          }
          return [saved, ...prev];
        });

        if (!editId && saved.id) {
          setEditId(saved.id);
        }

        if (options?.closeAfter) {
          setDialogOpen(false);
        }

        await load();
      }
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  const saveAndClose = async () => {
    await save({ closeAfter: true });
  };

  // Save + Create Offer → navigate to /angebote with edit modal open
  const saveAndCreateOffer = async () => {
    setSaving(true);
    try {
      const saved = await saveOrder();
      if (!saved) return;
      if (blockConversionIfUnsafe(saved, "Angebot")) return;
      toast.success("Auftrag gespeichert");

      // Build items for offer
      const orderItems = mergeEquivalentOrderItems(
        saved.items && saved.items.length > 0
          ? saved.items
          : [
              {
                serviceName: saved.serviceName ?? "",
                description: saved.serviceName ?? saved.description ?? "",
                quantity: saved.quantity ?? 1,
                unit: saved.priceType ?? "Stunde",
                unitPrice: saved.unitPrice ?? 0,
              },
            ],
      );
      const offerItems = orderItems.map((i: any) => ({
        description: i.serviceName || i.description || "",
        quantity: String(i.quantity ?? 1),
        unit: i.unit ?? "Stunde",
        unitPrice: String(i.unitPrice ?? 0),
        siteName: i.workSite?.siteName || null,
        siteAddress: i.workSite?.siteAddress || null,
        sitePlz: i.workSite?.sitePlz || null,
        siteCity: i.workSite?.siteCity || null,
        siteNote: i.workSite?.siteNote || null,
      }));

      // Create offer via API — forward VAT from saved order
      const fwdVatRate =
        saved.vatRate != null ? Number(saved.vatRate) : orderVatRate;
      const offerRes = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: saved.customerId,
          items: offerItems,
          orderIds: [saved.id],
          vatRate: fwdVatRate,
          currency: saved.currency === "EUR" ? "EUR" : "CHF",
        }),
      });
      if (offerRes.ok) {
        const offer = await offerRes.json();
        toast.success(`Angebot ${offer.offerNumber} erstellt`);
        setDialogOpen(false);
        // Paket L: optimistic update — mark the source order as linked so it
        // disappears from the active Orders list immediately (filter uses
        // !offerId && !invoiceId). Backend already set offerId via orderIds
        // link in POST /api/offers. This keeps the list consistent even if
        // the user navigates back before a full reload happens.
        setOrders((prev) =>
          prev.map((o) =>
            o.id === saved.id ? { ...o, offerId: offer.id } : o,
          ),
        );
        window.location.href = "/angebote";
      } else {
        toast.error("Angebot konnte nicht erstellt werden");
      }
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  // Save + Create Invoice → navigate to /rechnungen with edit modal open
  const saveAndCreateInvoice = async () => {
    setSaving(true);
    try {
      const saved = await saveOrder();
      if (!saved) return;
      if (blockConversionIfUnsafe(saved, "Rechnung")) return;
      toast.success("Auftrag gespeichert");

      const orderItems = mergeEquivalentOrderItems(
        saved.items && saved.items.length > 0
          ? saved.items
          : [
              {
                serviceName: saved.serviceName ?? "",
                description: saved.serviceName ?? saved.description ?? "",
                quantity: saved.quantity ?? 1,
                unit: saved.priceType ?? "Stunde",
                unitPrice: saved.unitPrice ?? 0,
              },
            ],
      );
      const invoiceItems = orderItems.map((i: any) => ({
        description: i.serviceName || i.description || "",
        quantity: String(i.quantity ?? 1),
        unit: i.unit ?? "Stunde",
        unitPrice: String(i.unitPrice ?? 0),
        siteName: i.workSite?.siteName || null,
        siteAddress: i.workSite?.siteAddress || null,
        sitePlz: i.workSite?.sitePlz || null,
        siteCity: i.workSite?.siteCity || null,
        siteNote: i.workSite?.siteNote || null,
      }));

      // Forward VAT from saved order
      const fwdVatRate =
        saved.vatRate != null ? Number(saved.vatRate) : orderVatRate;
      const invRes = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: saved.customerId,
          items: invoiceItems,
          orderIds: [saved.id],
          vatRate: fwdVatRate,
          currency: saved.currency === "EUR" ? "EUR" : "CHF",
        }),
      });
      if (invRes.ok) {
        const invoice = await invRes.json();
        toast.success(`Rechnung ${invoice.invoiceNumber} erstellt`);
        setDialogOpen(false);
        // Paket L: optimistic update — see saveAndCreateOffer above.
        setOrders((prev) =>
          prev.map((o) =>
            o.id === saved.id ? { ...o, invoiceId: invoice.id } : o,
          ),
        );
        window.location.href = "/rechnungen";
      } else {
        toast.error("Rechnung konnte nicht erstellt werden");
      }
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const updateOrderStatus = async (
    e: React.ChangeEvent<HTMLSelectElement>,
    id: string,
    status: string,
  ) => {
    e.stopPropagation();
    await fetch(`/api/orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    toast.success("Status aktualisiert");
    load();
  };

  const remove = async (id: string) => {
    setArchiveId(id);
  };

  const handleToggleSelect = (orderId: string) => {
    setSelectedOrderIds((prev) => {
      if (prev.includes(orderId)) return prev.filter((id) => id !== orderId);
      if (prev.length >= 5) {
        toast.error("Maximal 5 Aufträge auswählbar");
        return prev;
      }
      return [...prev, orderId];
    });
  };

  // Reset all merge state
  const resetMerge = () => {
    setMergeStep(0);
    setSelectedOrderIds([]);
    setSelectedMainOrderId(null);
    setSelectedCustomerId(null);
    setTextPreviewOpen({});
    setMerging(false);
    setMergePreviewUrls({});
  };

  const handleDialogClose = (open: boolean) => {
    if (!open && !merging) {
      resetMerge();
    }
  };

  const toggleTextPreview = (orderId: string) => {
    setTextPreviewOpen((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  // Remove order from selection in Step 2
  const handleRemoveFromSelection = (orderId: string) => {
    const newSelection = selectedOrderIds.filter((id) => id !== orderId);

    if (newSelection.length < 2) {
      toast.error("Mindestens 2 Aufträge erforderlich");
      return;
    }

    setSelectedOrderIds(newSelection);

    // If removed order was the main order, clear main selection
    if (selectedMainOrderId === orderId) {
      setSelectedMainOrderId(null);
    }

    // If removed order was the selected customer, reset customer
    const removedOrder = orders.find((o) => o.id === orderId);
    if (removedOrder && selectedCustomerId === removedOrder.customerId) {
      setSelectedCustomerId(null);
    }

    toast.success("Auftrag aus Auswahl entfernt");
  };

  // Count audio orders in selection
  const audioOrdersCount = useMemo(() => {
    const selectedOrders = orders.filter((o) =>
      selectedOrderIds.includes(o.id),
    );
    return selectedOrders.filter((o) => o.mediaUrl && o.mediaType === "audio")
      .length;
  }, [selectedOrderIds, orders]);

  // Step 1 → Step 2: user clicks "Weiter" after selecting 2-5 orders
  const mergeGoToStep2 = async () => {
    if (selectedOrderIds.length < 2) {
      toast.error("Mindestens 2 Aufträge auswählen");
      return;
    }
    const selected = orders.filter((o) => selectedOrderIds.includes(o.id));
    const urlMap: Record<string, string[]> = {};
    await Promise.all(
      selected.map(async (o) => {
        const previewPaths = o.imageUrls?.slice(0, 3) || [];
        if (!previewPaths.length) {
          urlMap[o.id] = [];
          return;
        }
        try {
          const resolved = await Promise.all(
            previewPaths.map((imgPath) => resolveS3Url(imgPath)),
          );
          urlMap[o.id] = resolved;
        } catch {
          urlMap[o.id] = [];
        }
      }),
    );
    setMergePreviewUrls(urlMap);
    // Resolve audio URLs for inline playback
    const audioMap: Record<string, string> = {};
    await Promise.all(
      selected
        .filter((o) => o.mediaUrl && o.mediaType === "audio")
        .map(async (o) => {
          try {
            audioMap[o.id] = await resolveS3Url(o.mediaUrl!);
          } catch {
            /* ignore */
          }
        }),
    );
    setMergeAudioUrls(audioMap);
    const getFullCustomer = (order: Order) => {
      return customers.find((c) => c.id === order.customerId) || order.customer;
    };

    const getBestMainOrder = (ordersToCheck: Order[]) => {
      const scored = ordersToCheck.map((order, index) => {
        const customer = getFullCustomer(order);

        const name = (customer?.name || "").trim();
        const address = (customer?.address || "").trim();
        const plz = (customer?.plz || "").trim();
        const city = (customer?.city || "").trim();
        const phone = (customer?.phone || "").trim();
        const email = (customer?.email || "").trim();
        const customerNumber = (customer?.customerNumber || "").trim();

        const hasRealName = name.length > 0 && !isFallbackCustomerName(name);
        const hasFullName = hasRealName && name.split(/\s+/).length >= 2;
        const hasAddress = address.length > 0;
        const hasPlzCity = plz.length > 0 && city.length > 0;
        const hasContact = phone.length > 0 || email.length > 0;

        let score = 0;

        if (hasRealName) score += 20;
        if (hasFullName) score += 30;
        if (hasAddress) score += 40;
        if (hasPlzCity) score += 40;
        if (hasContact) score += 10;
        if (customerNumber) score += 5;

        return { order, score, index };
      });

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      });

      return scored[0]?.order || ordersToCheck[0];
    };
    const bestMainOrder = getBestMainOrder(selected);

    const defaultMainOrderId = bestMainOrder.id;
    setSelectedMainOrderId(defaultMainOrderId || null);
    const defaultMainOrder = selected.find(
      (o) => o.id === (defaultMainOrderId || selectedOrderIds[0]),
    );
    // Wichtig: keinen alten selectedCustomerId behalten. Der Zielkunde muss
    // immer aus den aktuell ausgewählten Aufträgen stammen.
    setSelectedCustomerId(defaultMainOrder?.customerId || null);
    setMergeStep(2);
  };

  // Step 2 → Step 3

  // Step 3: Execute merge
  const executeMerge = async () => {
    if (merging) return; // GUARD
    if (!selectedMainOrderId) return;

    const selectedForMerge = orders.filter((order) =>
      selectedOrderIds.includes(order.id),
    );
    const mainOrderForMerge = selectedForMerge.find(
      (order) => order.id === selectedMainOrderId,
    );
    const validCustomerIds = new Set(
      selectedForMerge.map((order) => order.customerId).filter(Boolean),
    );
    const safeFinalCustomerId =
      selectedCustomerId && validCustomerIds.has(selectedCustomerId)
        ? selectedCustomerId
        : mainOrderForMerge?.customerId || null;

    if (!safeFinalCustomerId) {
      toast.error("Kunde für Hauptauftrag fehlt");
      return;
    }

    setMerging(true);

    try {
      const response = await fetch("/api/orders/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetOrderId: selectedMainOrderId,
          sourceOrderIds: selectedOrderIds.filter(
            (id) => id !== selectedMainOrderId,
          ),
          finalCustomerId: safeFinalCustomerId || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(`Fehler: ${result.error || "Fehler beim Verbinden"}`);
        return;
      }

      toast.success(`${result.mergedCount} Auftrag/Aufträge wurden verbunden`);
      resetMerge();
      await load();
      router.refresh();
    } catch (error) {
      console.error("[MERGE] Error:", error);
      toast.error("Fehler beim Verbinden");
    } finally {
      setMerging(false);
    }
  };

  // Helper: get selected orders objects
  const getSelectedOrders = () =>
    orders.filter((o) => selectedOrderIds.includes(o.id));
  // Helper: unique customers from selected orders
  const getUniqueCustomersFromSelected = () => {
    const selected = getSelectedOrders();
    const custMap = new Map<
      string,
      { id: string; name: string; customerNumber?: string | null }
    >();
    selected.forEach((o) => {
      if (o.customer && o.customerId) {
        custMap.set(o.customerId, {
          id: o.customerId,
          name: o.customer.name,
          customerNumber: o.customer.customerNumber,
        });
      }
    });
    return Array.from(custMap.values());
  };

  const confirmArchive = async () => {
    if (!archiveId) return;
    try {
      const res = await fetch(`/api/orders/${archiveId}`, { method: "DELETE" });
      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(result?.error || "Auftrag konnte nicht verschoben werden");
        return;
      }

      toast.success(
        result?.removedEmptyCustomer
          ? "Auftrag in Papierkorb verschoben, leerer Kunde entfernt"
          : "Auftrag in Papierkorb verschoben",
      );
      setArchiveId(null);
      load();
    } catch {
      toast.error("Fehler beim Verschieben in den Papierkorb");
    }
  };

  const resolveS3Url = async (path: string): Promise<string> => {
    try {
      const res = await fetch("/api/upload/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cloud_storage_path: path, isPublic: false }),
      });
      const data = await res.json();
      return data.url || path;
    } catch {
      return path;
    }
  };

  const openMedia = async (o: Order) => {
    const hasImageUrls = (o.imageUrls?.length ?? 0) > 0;

    if (!o.mediaUrl && !hasImageUrls) return;

    if (o.mediaUrl && o.mediaType === "audio") {
      const url = await resolveS3Url(o.mediaUrl);
      setMediaUrl(url);
      setMediaType("audio");
      setGalleryUrls([]);
      setMediaDialogOpen(true);
      return;
    }

    const paths =
      hasImageUrls && o.imageUrls
        ? o.imageUrls
        : o.mediaUrl
          ? [o.mediaUrl]
          : [];

    if (paths.length === 0) return;

    const resolved = await Promise.all(paths.map((p) => resolveS3Url(p)));

    setGalleryUrls(resolved);
    setGalleryIdx(0);
    setMediaType("image");
    setMediaUrl(null);
    setMediaDialogOpen(true);
  };

  useEffect(() => {
    if (!dialogOpen || !currentEditOrder) {
      setCustomerMessageImagePreviewUrls([]);
      return;
    }

    const imagePaths =
      currentEditOrder.imageUrls && currentEditOrder.imageUrls.length > 0
        ? currentEditOrder.imageUrls
        : currentEditOrder.mediaType === "image" && currentEditOrder.mediaUrl
          ? [currentEditOrder.mediaUrl]
          : [];

    if (imagePaths.length === 0) {
      setCustomerMessageImagePreviewUrls([]);
      return;
    }

    let cancelled = false;

    (async () => {
      const resolved = await Promise.all(imagePaths.map((path) => resolveS3Url(path)));
      if (!cancelled) {
        setCustomerMessageImagePreviewUrls(resolved);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dialogOpen, currentEditOrder?.id, currentEditOrder?.imageUrls?.join("|"), currentEditOrder?.mediaUrl, currentEditOrder?.mediaType]);

  const createOffer = async (o: Order) => {
    if (blockConversionIfUnsafe(o, "Angebot")) {
      openEdit(o);
      return;
    }
    const sourceOrder = o;

    // Direct API create — no extra dialog
    const orderItems = mergeEquivalentOrderItems(
      sourceOrder.items && sourceOrder.items.length > 0
        ? sourceOrder.items
        : [
            {
              serviceName: sourceOrder.serviceName ?? "",
              description:
                sourceOrder.serviceName ?? sourceOrder.description ?? "",
              quantity: sourceOrder.quantity ?? 1,
              unit: sourceOrder.priceType ?? "Stunde",
              unitPrice: sourceOrder.unitPrice ?? 0,
            },
          ],
    );
    const offerItems = orderItems.map((i: any) => ({
      description: i.serviceName || i.description || "",
      quantity: String(i.quantity ?? 1),
      unit: i.unit ?? "Stunde",
      unitPrice: String(i.unitPrice ?? 0),
    }));
    // Forward the Auftrag's saved VAT rate (falls back to default if legacy order has none)
    const fwdVatRate =
      sourceOrder.vatRate != null
        ? Number(sourceOrder.vatRate)
        : defaultVatRate;
    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: sourceOrder.customerId,
          items: offerItems,
          orderIds: [sourceOrder.id],
          vatRate: fwdVatRate,
          currency: sourceOrder.currency === "EUR" ? "EUR" : "CHF",
        }),
      });
      if (res.ok) {
        const offer = await res.json();
        toast.success(`Angebot ${offer.offerNumber} erstellt`);
        // Paket L: optimistic update — mark the source order as linked so it
        // disappears from the active Orders list immediately.
        setOrders((prev) =>
          prev.map((x) =>
            x.id === sourceOrder.id ? { ...x, offerId: offer.id } : x,
          ),
        );
        window.location.href = "/angebote";
      } else {
        toast.error("Angebot konnte nicht erstellt werden");
      }
    } catch {
      toast.error("Fehler beim Erstellen des Angebots");
    }
  };

  const createInvoice = async (o: Order) => {
    if (blockConversionIfUnsafe(o, "Rechnung")) {
      openEdit(o);
      return;
    }
    const sourceOrder = o;

    // Direct API create — no extra dialog
    const orderItems = mergeEquivalentOrderItems(
      sourceOrder.items && sourceOrder.items.length > 0
        ? sourceOrder.items
        : [
            {
              serviceName: sourceOrder.serviceName ?? "",
              description:
                sourceOrder.serviceName ?? sourceOrder.description ?? "",
              quantity: sourceOrder.quantity ?? 1,
              unit: sourceOrder.priceType ?? "Stunde",
              unitPrice: sourceOrder.unitPrice ?? 0,
            },
          ],
    );
    const invoiceItems = orderItems.map((i: any) => ({
      description: i.serviceName || i.description || "",
      quantity: String(i.quantity ?? 1),
      unit: i.unit ?? "Stunde",
      unitPrice: String(i.unitPrice ?? 0),
    }));
    // Forward the Auftrag's saved VAT rate (falls back to default if legacy order has none)
    const fwdVatRate =
      sourceOrder.vatRate != null
        ? Number(sourceOrder.vatRate)
        : defaultVatRate;
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: sourceOrder.customerId,
          items: invoiceItems,
          orderIds: [sourceOrder.id],
          vatRate: fwdVatRate,
          currency: sourceOrder.currency === "EUR" ? "EUR" : "CHF",
        }),
      });
      if (res.ok) {
        const invoice = await res.json();
        toast.success(`Rechnung ${invoice.invoiceNumber} erstellt`);
        // Paket L: optimistic update — mark the source order as linked so it
        // disappears from the active Orders list immediately.
        setOrders((prev) =>
          prev.map((x) =>
            x.id === sourceOrder.id ? { ...x, invoiceId: invoice.id } : x,
          ),
        );
        window.location.href = "/rechnungen";
      } else {
        toast.error("Rechnung konnte nicht erstellt werden");
      }
    } catch {
      toast.error("Fehler beim Erstellen der Rechnung");
    }
  };

  // Display items summary for list

  const getSafeOrderNetTotal = (o: Order) => {
    if (o.items && o.items.length > 0) {
      return o.items.reduce((sum, item) => {
        const hasUnitReview = hasQuantityReviewForService(
          o.reviewReasons,
          item.serviceName,
        );

        const qty = Number(item.quantity || 0);
        const price = Number(item.unitPrice || 0);

        if (hasUnitReview || qty <= 0 || price <= 0) {
          return sum;
        }

        return sum + qty * price;
      }, 0);
    }

    const qty = Number(o.quantity || 0);
    const price = Number(o.unitPrice || 0);

    if (qty <= 0 || price <= 0) return 0;

    return qty * price;
  };

  const hasOrderVat = (o: Order) => Number(o.vatRate || 0) > 0;

  const getSafeOrderTotal = (o: Order) => {
    const netTotal = getSafeOrderNetTotal(o);
    const vatRate = Number(o.vatRate || 0);

    if (vatRate <= 0) return netTotal;

    return netTotal + (netTotal * vatRate) / 100;
  };

  const itemsSummary = (o: Order) => {
    if (o.items && o.items.length > 1) {
      return o.items.map((i) => i.serviceName).join(", ");
    }
    return o.serviceName ?? "";
  };
  const shortText = (value?: string | null, max = 90) => {
    const text = (value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max).trim()}…` : text;
  };

  const getMergeMessage = (o: Order) => {
    return shortText(o.notes || o.audioTranscript || null, 120);
  };

  const getMergeAiHint = (o: Order) => {
    const text = shortText(o.description || o.serviceName || null, 70);
    if (!text) return "Bild erkannt. Ohne Nachricht bitte prüfen.";
    return text;
  };

  const formatMergeDate = (date?: string) => {
    if (!date) return "–";

    const dt = new Date(date);

    if (Number.isNaN(dt.getTime())) return "–";

    return dt.toLocaleDateString("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError) {
    return <LoadErrorFallback details={loadError} onRetry={load} />;
  }

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-primary" /> Aufträge
          </h1>
          <p className="text-muted-foreground mt-1">
            {unlinked?.length ?? 0} Aufträge
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={isMergeMode ? "secondary" : "outline"}
            onClick={() => {
              if (isMergeMode) {
                resetMerge();
              } else {
                setMergeStep(1);
                setSelectedOrderIds([]);
                setSelectedMainOrderId(null);
                setSelectedCustomerId(null);
                setTextPreviewOpen({});
              }
            }}
          >
            {isMergeMode ? "Verbinden abbrechen" : "Aufträge verbinden"}
          </Button>
          {isMergeMode && selectedOrderIds.length >= 2 && (
            <Button onClick={mergeGoToStep2}>
              Weiter ({selectedOrderIds.length} ausgewählt)
            </Button>
          )}
          {isMergeMode && selectedOrderIds.length === 1 && (
            <span className="text-xs text-muted-foreground self-center">
              Noch mind. 1 weiteren auswählen
            </span>
          )}
          <Button onClick={openNew}>
            <Plus className="w-4 h-4 mr-1" />
            Neuer Auftrag
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Name, Ort, Leistung, Kunden-Nr…"
            className="pl-10 h-9 text-sm"
            value={search}
            onChange={(e: any) => setSearch(e?.target?.value ?? "")}
          />
        </div>
        <select
          className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
          value={statusFilter}
          onChange={(e: any) => setStatusFilter(e?.target?.value ?? "Alle")}
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s === "Alle" ? "Status: Alle" : s}
            </option>
          ))}
        </select>
        <select
          className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
          value={sortBy}
          onChange={(e: any) => setSortBy(e?.target?.value ?? "newest")}
        >
          <option value="newest">Neueste zuerst</option>
          <option value="oldest">Älteste zuerst</option>
          <option value="name">Name A–Z</option>
          <option value="amount">Betrag ↓</option>
          <option value="review">Prüfung zuerst</option>
        </select>
      </div>

      <div className="space-y-1.5">
        {filtered?.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            Keine Aufträge gefunden
          </p>
        ) : (
          filtered.slice(0, visibleCount).map((o: Order, i: number) => {
            const isSonstiges =
              (o.serviceName ?? "").toLowerCase() === "sonstiges" ||
              (o.items &&
                o.items.some(
                  (it) => (it.serviceName ?? "").toLowerCase() === "sonstiges",
                ));
            const serviceLine = getOrderCardServiceSummary(o);
            const mobileServiceLine = getMobileOrderCardServiceSummary(o);
            const parsedCardNotes = splitSpecialNotes(o.specialNotes);
            const systemBadges = getSystemBadges(o, services);
            const amountReviewBadges = buildAmountReviewBadges(
              systemBadges.filter(isAmountReviewBadge),
            );
            const leftSystemBadges = systemBadges.filter(
              (badge) => !isAmountReviewBadge(badge),
            );
            const operationalBadges = getOperationalBadges(o, parsedCardNotes);
            const bottomBadges = getBottomBadges(o, parsedCardNotes);
            const hasMultipleMergedData = hasMergedMultipleContactData(
              o,
              parsedCardNotes,
            );
            const hiddenMergedDataBadgeKeys = [
              "appointment",
              "appointments_multiple",
              "appointment_clarify",
              "callback_request",
              "sms_request",
            ];
            const appointmentBadges = bottomBadges.filter((badge) =>
              hasMultipleMergedData
                ? badge.key === "appointments_multiple"
                : badge.key === "appointment" || badge.key === "appointments_multiple",
            );
            const callbackBadges = hasMultipleMergedData
              ? []
              : bottomBadges.filter((badge) => badge.key === "callback_request");
            const messageBadges = hasMultipleMergedData
              ? []
              : bottomBadges.filter((badge) => badge.key === "sms_request");
            const otherFooterBadges = bottomBadges.filter((badge) =>
              hasMultipleMergedData
                ? !hiddenMergedDataBadgeKeys.includes(badge.key)
                : !["appointment", "appointments_multiple", "callback_request", "sms_request"].includes(
                    badge.key,
                  ),
            );
            const rightSideBadges = amountReviewBadges;
            const mobilePrimaryRightBadges = rightSideBadges.slice(0, 2);
            const mobileRightHiddenCount = Math.max(0, rightSideBadges.length - mobilePrimaryRightBadges.length);
            const mobileFocusBadges = leftSystemBadges.filter(
              (badge) => badge.focusTarget === "specialNotes",
            );
            const mobileSystemBadges = leftSystemBadges.filter(
              (badge) => badge.key !== "site_address" && !badge.focusTarget,
            );
            // Mobile: do not repeat the address pin as a large action icon.
            // The address remains visible on desktop and in the edit dialog; the
            // mobile icon row is reserved for real actions/hints.
            const mobileActionBadges = [
              ...mobileFocusBadges,
              ...callbackBadges,
              ...operationalBadges,
              ...messageBadges,
              ...otherFooterBadges,
            ];
            const mobileVisibleActionBadges = mobileActionBadges.slice(0, 4);
            const mobileHiddenActionCount = Math.max(0, mobileActionBadges.length - mobileVisibleActionBadges.length);

            const openOrderAtSpecialNotes = (event: any) => {
              event.stopPropagation();
              openEdit(o, { focusSection: "specialNotes" });
            };

            const renderInteractiveOrderCardBadge = (
              badge: ReviewBadge,
              tooltipAlign: "left" | "right" = "left",
            ) => {
              if (badge.focusTarget !== "specialNotes") {
                return renderOrderCardBadge(badge, tooltipAlign);
              }

              const isLargeYellowBadge = [
                "price_deviation",
                "catalog_missing",
                "catalog_review_combined",
                "merged_data_review",
              ].includes(badge.key);

              return (
                <button
                  key={badge.key}
                  type="button"
                  title={compactText(badge.tooltip) || badge.label}
                  aria-label={compactText(badge.tooltip) || badge.label}
                  onClick={openOrderAtSpecialNotes}
                  className={`group relative inline-flex items-center gap-1 rounded-full shrink-0 outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${
                    isLargeYellowBadge
                      ? "text-[11px] px-2 py-0.5 font-semibold"
                      : "text-[10px] px-1.5 py-0.5 font-medium"
                  } ${getStrongerCardBadgeClassName(badge.className)}`}
                >
                  {badge.label}
                  {renderBadgeTooltip(badge, tooltipAlign)}
                </button>
              );
            };

            const renderInteractiveMobileActionBadge = (badge: ReviewBadge) => {
              if (badge.focusTarget !== "specialNotes") {
                return renderMobileActionBadge(o, badge);
              }

              const Icon = mobileIconForBadge(badge) || AlertTriangle;
              const title = compactText(badge.tooltip) || badge.label;
              return (
                <button
                  key={badge.key}
                  type="button"
                  title={title}
                  aria-label={title}
                  onClick={openOrderAtSpecialNotes}
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[13px] font-semibold shadow-sm ${mobileIconBadgeClass(badge)}`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                </button>
              );
            };
            const showAudioTooLongBadge =
              o.audioTranscriptionStatus?.startsWith("skipped");
            const showImageOnlyBadge = false;
            const isSelected = selectedOrderIds.includes(o.id);
            return (
              <motion.div
                key={o.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.015 }}
              >
                <Card
                  className={`border-2 border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 hover:shadow-sm transition-shadow cursor-pointer tap-safe max-w-full overflow-visible ${isMergeMode && isSelected ? "ring-2 ring-primary/40" : ""}`}
                  onClick={() => {
                    if (isMergeMode) {
                      handleToggleSelect(o.id);
                      return;
                    }
                    openEdit(o);
                  }}
                >
                  <CardContent className="px-2.5 py-1.5 sm:px-3 sm:py-2 max-w-full overflow-visible">
                    <div className="flex items-start gap-2 min-w-0 max-w-full overflow-visible">
                      {isMergeMode && (
                        <div
                          className="shrink-0 pt-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(o.id)}
                            className="h-4 w-4 rounded border-gray-300"
                            aria-label="Auftrag für Zusammenführung auswählen"
                          />
                        </div>
                      )}
                      {/* Left: 3-dot menu */}
                      <div
                        className="relative shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDropdownOpenId(
                              dropdownOpenId === o.id ? null : o.id,
                            );
                          }}
                          className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                          title="Aktionen"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                        {dropdownOpenId === o.id && (
                          <div className="absolute left-0 top-full mt-1 z-[9999] bg-white dark:bg-gray-900 border rounded-lg shadow-lg py-1 min-w-[180px]">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDropdownOpenId(null);
                                openEdit(o);
                              }}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                            >
                              <ClipboardList className="w-3.5 h-3.5 text-primary" />
                              Bearbeiten
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDropdownOpenId(null);
                                createOffer(o);
                              }}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                            >
                              <FileCheck className="w-3.5 h-3.5 text-orange-600" />
                              Zu Angebot
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDropdownOpenId(null);
                                createInvoice(o);
                              }}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                            >
                              <FileText className="w-3.5 h-3.5 text-blue-600" />
                              Zu Rechnung
                            </button>
                            <div className="border-t my-0.5" />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDropdownOpenId(null);
                                remove(o.id);
                              }}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Papierkorb
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Mobile: compact two-column card like selected mockup */}
                      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_112px] gap-2 md:hidden">
                        <div className="min-w-0 overflow-visible">
                          <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                            <span className="shrink-0">
                              {o.createdAt
                                ? new Date(o.createdAt).toLocaleDateString(
                                    "de-CH",
                                    { day: "2-digit", month: "2-digit" },
                                  ) +
                                  " · " +
                                  new Date(o.createdAt).toLocaleTimeString(
                                    "de-CH",
                                    { hour: "2-digit", minute: "2-digit" },
                                  )
                                : ""}
                            </span>
                          </div>

                          <div className="mt-0.5 flex min-w-0 items-center gap-1">
                            <span
                              className={`min-w-0 truncate text-[13px] font-semibold ${isFallbackCustomerName(o.customer?.name) ? "text-amber-600 dark:text-amber-400 italic" : "text-foreground"}`}
                            >
                              {isFallbackCustomerName(o.customer?.name)
                                ? "Kunde nicht zugeordnet"
                                : o.customer?.name || "–"}
                            </span>
                            {!isFallbackCustomerName(o.customer?.name) &&
                              o.customer?.customerNumber && (
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                  ({o.customer.customerNumber})
                                </span>
                              )}
                          </div>

                          {mobileSystemBadges.length > 0 && (
                            <div className="mt-1 flex max-w-full flex-wrap items-center gap-1">
                              {mobileSystemBadges.slice(0, 1).map((badge) =>
                                renderMobileTextBadge(badge, "left"),
                              )}
                            </div>
                          )}

                          <p
                            className={`mt-1 line-clamp-2 text-[13px] font-medium leading-snug ${
                              isSonstiges
                                ? "text-red-600 dark:text-red-400"
                                : "text-foreground"
                            }`}
                          >
                            {isSonstiges && "⚠ "}
                            {mobileServiceLine}
                          </p>

                          <div className="mt-2 flex flex-wrap items-center gap-1.5 overflow-visible">
                            <select
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 shrink-0 rounded-lg border px-1.5 text-[11px] font-medium"
                              style={getStatusStyle(
                                ORDER_STATUS_STYLES,
                                o?.status ?? "",
                              )}
                              value={o?.status ?? ""}
                              onChange={(e: any) =>
                                updateOrderStatus(
                                  e,
                                  o?.id,
                                  e?.target?.value ?? "",
                                )
                              }
                            >
                              {orderStatuses.map((s) => (
                                <option
                                  key={s}
                                  style={getStatusStyle(ORDER_STATUS_STYLES, s)}
                                >
                                  {s}
                                </option>
                              ))}
                            </select>

                            {!hasMultipleMergedData && (
                              <CommunicationChips
                                compact
                                data={{
                                ...o,
                                specialNotes:
                                  removeCallbackLinesForCommunicationChips(
                                    o.specialNotes,
                                  ),
                                notes: [
                                  removeCallbackLinesForCommunicationChips(
                                    o.notes,
                                  ),
                                  removeCallbackLinesForCommunicationChips(
                                    o.specialNotes,
                                  ),
                                  removeCallbackLinesForCommunicationChips(
                                    o.audioTranscript,
                                  ),
                                ]
                                  .filter(Boolean)
                                  .join("\n"),
                                audioTranscript:
                                  removeCallbackLinesForCommunicationChips(
                                    o.audioTranscript,
                                  ),
                              }}
                                onAudioClick={() => openMedia(o)}
                                onImageClick={() => openMedia(o)}
                              />
                            )}

                            {mobileVisibleActionBadges.map((badge) =>
                              renderInteractiveMobileActionBadge(badge),
                            )}
                            {mobileOverflowBadge(mobileHiddenActionCount)}
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-col items-end justify-between gap-1 border-l border-slate-200 pl-2 dark:border-slate-700">
                          <div className="flex w-full flex-col items-end gap-1">
                            {appointmentBadges.slice(0, 1).map((badge) =>
                              renderMobileTextBadge(badge, "right"),
                            )}
                            {mobilePrimaryRightBadges.map((badge) => (
                              <button
                                key={`mobile_review_${badge.key}`}
                                type="button"
                                title={compactText(badge.tooltip) || badge.label}
                                aria-label={compactText(badge.tooltip) || badge.label}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEdit(o);
                                }}
                                className="max-w-full text-right"
                              >
                                {renderMobileTextBadge(badge, "right")}
                              </button>
                            ))}
                            {mobileRightHiddenCount > 0 && (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                +{mobileRightHiddenCount}
                              </span>
                            )}
                          </div>

                          <div className="whitespace-nowrap text-right leading-tight">
                            <div className="font-mono text-[15px] font-bold tabular-nums">
                              {formatCurrency(
                                getSafeOrderTotal(o),
                                o.currency === "EUR" ? "EUR" : "CHF",
                              )}
                            </div>
                            {hasOrderVat(o) && (
                              <div className="text-[9px] leading-none text-muted-foreground">
                                inkl. MwSt
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Desktop/tablet: existing dense list layout */}
                      <div className="hidden min-w-0 flex-1 items-stretch gap-2 sm:gap-3 md:flex">
                        <div className="flex-1 min-w-0 max-w-full overflow-visible">
                          {/* Row 1: date + customer */}
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs min-w-0 max-w-full overflow-visible">
                            <span className="text-muted-foreground shrink-0">
                              {o.createdAt
                                ? new Date(o.createdAt).toLocaleDateString(
                                    "de-CH",
                                    { day: "2-digit", month: "2-digit" },
                                  ) +
                                  " " +
                                  new Date(o.createdAt).toLocaleTimeString(
                                    "de-CH",
                                    { hour: "2-digit", minute: "2-digit" },
                                  )
                                : ""}
                            </span>
                            <span className="text-muted-foreground shrink-0">
                              ·
                            </span>
                            <span
                              className={`font-medium truncate min-w-0 max-w-[120px] sm:max-w-[170px] md:max-w-[220px] lg:max-w-[280px] xl:max-w-none ${isFallbackCustomerName(o.customer?.name) ? "text-amber-600 dark:text-amber-400 italic" : "text-foreground"}`}
                            >
                              {isFallbackCustomerName(o.customer?.name)
                                ? "Kunde nicht zugeordnet"
                                : o.customer?.name || "–"}
                            </span>

                            {!isFallbackCustomerName(o.customer?.name) &&
                              o.customer?.customerNumber && (
                                <span className="text-muted-foreground shrink-0">
                                  ({o.customer.customerNumber})
                                </span>
                              )}

                            {leftSystemBadges.length > 0 && (
                              <span className="inline-flex max-w-full flex-nowrap items-center gap-1 shrink-0">
                                {leftSystemBadges.map((badge) =>
                                  renderInteractiveOrderCardBadge(badge),
                                )}
                              </span>
                            )}

                            {showAudioTooLongBadge && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 shrink-0">
                                ⚠️ Audio zu lang
                              </span>
                            )}

                          </div>

                          {/* Row 2: compact service-only preview */}
                          <p
                            className={`text-sm font-medium mt-0.5 whitespace-normal break-words max-md:line-clamp-5 max-md:overflow-hidden max-md:leading-snug ${
                              isSonstiges
                                ? "text-red-600 dark:text-red-400"
                                : "text-foreground"
                            }`}
                          >
                            {isSonstiges && "⚠ "}
                            {serviceLine}
                          </p>

                          {/* Row 3: compact footer chips */}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1 max-w-full overflow-visible pr-1 sm:pr-0">
                            <select
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] border rounded px-1.5 py-0.5 font-medium shrink-0"
                              style={getStatusStyle(
                                ORDER_STATUS_STYLES,
                                o?.status ?? "",
                              )}
                              value={o?.status ?? ""}
                              onChange={(e: any) =>
                                updateOrderStatus(
                                  e,
                                  o?.id,
                                  e?.target?.value ?? "",
                                )
                              }
                            >
                              {orderStatuses.map((s) => (
                                <option
                                  key={s}
                                  style={getStatusStyle(ORDER_STATUS_STYLES, s)}
                                >
                                  {s}
                                </option>
                              ))}
                            </select>

                            {!hasMultipleMergedData && (
                              <CommunicationChips
                                data={{
                                ...o,
                                customer: o.customer,
                                specialNotes:
                                  removeCallbackLinesForCommunicationChips(
                                    o.specialNotes,
                                  ),
                                notes: [
                                  removeCallbackLinesForCommunicationChips(
                                    o.notes,
                                  ),
                                  removeCallbackLinesForCommunicationChips(
                                    o.specialNotes,
                                  ),
                                  removeCallbackLinesForCommunicationChips(
                                    o.audioTranscript,
                                  ),
                                ]
                                  .filter(Boolean)
                                  .join("\n"),
                                audioTranscript:
                                  removeCallbackLinesForCommunicationChips(
                                    o.audioTranscript,
                                  ),
                              }}
                                onAudioClick={() => openMedia(o)}
                                onImageClick={() => openMedia(o)}
                              />
                            )}

                            {callbackBadges.map((badge) =>
                              renderCallbackCardBadge(o, badge),
                            )}

                            {messageBadges.map((badge) =>
                              renderInteractiveOrderCardBadge(badge),
                            )}

                            {operationalBadges.map((badge) =>
                              renderInteractiveOrderCardBadge(badge),
                            )}

                            {otherFooterBadges.map((badge) =>
                              renderInteractiveOrderCardBadge(badge),
                            )}
                          </div>
                        </div>

                        <div className="ml-auto flex w-[120px] shrink-0 flex-col items-end justify-between self-stretch gap-1 pt-0.5 sm:w-[220px] xl:w-[280px]">
                          <div className="flex flex-wrap justify-end gap-1 min-h-[22px]">
                            {rightSideBadges.map((badge) =>
                              renderInteractiveOrderCardBadge(badge, "right"),
                            )}
                          </div>

                          <div className="flex w-full flex-wrap items-end justify-end gap-3">
                            <div className="flex flex-wrap justify-end gap-1">
                              {appointmentBadges.map((badge) =>
                                renderInteractiveOrderCardBadge(badge, "right"),
                              )}
                            </div>

                            <div className="whitespace-nowrap text-right leading-tight">
                              <div className="font-mono font-bold tabular-nums text-[13px] sm:text-sm">
                                {formatCurrency(
                                  getSafeOrderTotal(o),
                                  o.currency === "EUR" ? "EUR" : "CHF",
                                )}
                              </div>
                              {hasOrderVat(o) && (
                                <div className="text-[9px] leading-none text-muted-foreground">
                                  inkl. MwSt
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })
        )}

        {filtered.length > visibleCount && (
          <div className="text-center pt-4">
            <Button
              variant="outline"
              onClick={() => setVisibleCount((v) => v + 30)}
            >
              Mehr laden ({filtered.length - visibleCount} weitere)
            </Button>
          </div>
        )}
      </div>
      {/* Mobile-only navigation shortcut → Angebote.
          NOT a conversion. NOT a "new offer" action. Pure navigation.
          Hidden on md+ (desktop has the sidebar). */}
      <MobileListShortcut
        href="/angebote"
        label="Angebote"
        ariaLabel="Zu Angebote"
      />
      <MergeOrdersDialog
        open={mergeStep === 2}
        onOpenChange={(open) => {
          if (!open) handleDialogClose(false);
        }}
        selectedOrders={getSelectedOrders()}
        selectedMainOrderId={selectedMainOrderId}
        onSelectMainOrder={(orderId) => {
          setSelectedMainOrderId(orderId);
          const selectedOrder = orders.find((order) => order.id === orderId);
          setSelectedCustomerId(selectedOrder?.customerId || null);
        }}
        selectedCustomerId={selectedCustomerId}
        onSelectCustomerId={setSelectedCustomerId}
        customers={getUniqueCustomersFromSelected()}
        previewUrls={mergePreviewUrls}
        audioUrls={mergeAudioUrls}
        onRemoveOrder={handleRemoveFromSelection}
        onBack={() => setMergeStep(1)}
        onNext={executeMerge}
        currency={currency}
      />

      {/* Order Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className={`${dupCheckOpen ? "max-w-4xl w-[95vw]" : "max-w-2xl"} max-h-[90vh] overflow-y-auto overflow-x-hidden transition-all`}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {editId ? "Auftrag bearbeiten" : "Neuer Auftrag"}
            </DialogTitle>
          </DialogHeader>
          <div
            className={
              dupCheckOpen
                ? "grid grid-cols-1 sm:grid-cols-2 gap-4 dupcheck-split min-w-0"
                : "min-w-0 overflow-hidden"
            }
          >
            <div
              className={`space-y-4 min-w-0${dupCheckOpen ? " max-h-[35vh] sm:max-h-none overflow-y-auto dupcheck-form-col" : ""}`}
            >
              {/* Phase 2d: auto-reuse banner (exact / near-exact) */}
              {editId &&
                (() => {
                  const cur = orders.find((o: Order) => o.id === editId);
                  if (!cur) return null;
                  const cust = customers.find(
                    (c: Customer) => c.id === cur.customerId,
                  );
                  const snapshot = cust
                    ? {
                        address: cust.address ?? null,
                        plz: cust.plz ?? null,
                        city: cust.city ?? null,
                      }
                    : null;
                  return (
                    <AutoReuseBanner
                      order={{
                        id: cur.id,
                        reviewReasons: cur.reviewReasons,
                        invoiceId: (cur as any).invoiceId ?? null,
                        offerId: (cur as any).offerId ?? null,
                      }}
                      previousCustomerSnapshot={snapshot}
                      onUndone={async (result) => {
                        // Block A fix: server now restores the pre-suggestion
                        // (intake) address state onto the new split customer
                        // (name + street + city for plz_completed; name + street
                        // + plz for city_completed; all 4 fields for exact reuse).
                        // So the old "Vorherige Adresse" amber hint is no longer
                        // needed — the data is right there in the new customer.
                        setUndoPreviousAddress(null);
                        setForm((f: any) => ({
                          ...f,
                          customerId: result.newCustomerId,
                        }));
                        await load();
                      }}
                    />
                  );
                })()}
              {/* Top header: customer-data warnings — shown near customer area.
                The chip itself is the only click target — clicking it opens
                the customer-edit section. No duplicate buttons here; the
                existing "✏️ Bearbeiten" link inside the customer card and the
                "Kunde aktualisieren" save button inside the edit section
                handle all other actions. */}
              {editId &&
                (() => {
                  const cur = orders.find((o: Order) => o.id === editId);
                  const cust = cur
                    ? customers.find((c: Customer) => c.id === cur.customerId)
                    : null;
                  // Canonical rule — name/address/plz/city required; phone/email optional.

                  const missingData = !!cust && isCustomerDataIncomplete(cust);
                  const hasCustomerReview = !!cur && missingData;
                  const hasImageOnly =
                    cur?.reviewReasons?.includes("image_only_no_text");
                  if (!missingData && !hasImageOnly) return null;

                  return (
                    <div className="flex items-center gap-2 flex-wrap">
                      {(hasCustomerReview || missingData) && (
                        <button
                          type="button"
                          onClick={() => openCustomerEditor()}
                          className="tap-safe inline-flex items-center gap-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
                          aria-label="Kundendaten ergänzen — öffnet den Kunde-bearbeiten-Bereich"
                        >
                          {hasCustomerReview && (
                            <Badge
                              variant="secondary"
                              className="text-[11px] px-2 py-0.5 bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200 border border-orange-300"
                            >
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Kundendaten prüfen
                            </Badge>
                          )}
                          {!cur?.needsReview && missingData && (
                            <MissingCustomerDataBadge variant="standard" />
                          )}
                        </button>
                      )}
                      {/* Image-only badge in edit dialog */}
                      {hasImageOnly && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300">
                          ⚠️ Bild ohne Text prüfen
                        </span>
                      )}
                      {/* Unit mismatch badge in edit dialog */}
                      {cur?.reviewReasons?.some((r: string) =>
                        r.startsWith("unit_mismatch:"),
                      ) && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300">
                          Einheit prüfen
                        </span>
                      )}
                    </div>
                  );
                })()}
              {/* Customer Info / Select / Edit */}
              <div>
                <div className="mb-1">
                  <Label>Rechnungsadresse *</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Kunde, der die Rechnung bekommt und bezahlt.
                  </p>
                </div>
                {!showNewCustomer ? (
                  <>
                    {/* If editing and customer assigned → show static info, no dropdown */}
                    {editId && form.customerId ? (
                      (() => {
                        const cust = customers.find(
                          (c: Customer) => c.id === form.customerId,
                        );
                        if (!cust) return null;
                        // Required fields: name/address/plz/city — painted red when missing.
                        // Optional fields: phone/email — always neutral (black), never red.
                        const reqMiss = isRequiredCustomerFieldMissing;
                        const visibleCustomerAddress = cust.address;
                        const visibleCustomerPlz = cust.plz;
                        const visibleCustomerCity = cust.city;
                        const visibleCustomerPhone = cust.phone;
                        const visibleCustomerEmail = cust.email;
                        // Block D: the whole customer card is a shortcut to
                        // "Kunde bearbeiten" (only in edit mode where the card is
                        // static). Keyboard-accessible via Enter/Space. The existing
                        // small "✏️ Bearbeiten" link above still works.
                        return (
                          <>
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => openCustomerEditor()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openCustomerEditor();
                                }
                              }}
                              title="Kunde bearbeiten"
                              aria-label="Kunde bearbeiten"
                              className="border border-sky-200 rounded-lg p-2 sm:p-3 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-950/20 space-y-1.5 min-w-0 cursor-pointer hover:bg-sky-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
                            >
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  {/* ISSUE 4 — Show neutral label for fallback customers */}
                                  {isFallbackCustomerName(cust.name) ? (
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                      <span className="text-sm font-semibold truncate text-amber-600 dark:text-amber-400">
                                        ⚠️ Kunde noch nicht zugeordnet
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">
                                        (bitte echten Kunden zuweisen)
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                      <span className="text-sm font-semibold truncate">
                                        👤 {cust.customerNumber || ""}
                                        {cust.customerNumber ? " · " : ""}
                                      </span>
                                      <span
                                        className={`text-sm font-semibold truncate ${reqMiss(cust.name) ? "text-red-500 border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                      >
                                        {cust.name || "Name fehlt"}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 sm:justify-end">
                                  <button
                                    type="button"
                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 whitespace-nowrap"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openCustomerEditor();
                                    }}
                                  >
                                    ✏️ Bearbeiten
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs text-amber-600 hover:underline flex items-center gap-1 whitespace-nowrap"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setDupCheckOpen(true);
                                    }}
                                  >
                                    🔍 Duplikate prüfen
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 gap-1 text-xs min-w-0">
                                <div
                                  className={`flex items-center gap-1 min-w-0 ${reqMiss(visibleCustomerAddress) ? "text-red-500" : "text-foreground/70"}`}
                                >
                                  <span className="font-medium w-12 sm:w-16 shrink-0">
                                    Strasse:
                                  </span>
                                  <span
                                    className={`truncate ${reqMiss(visibleCustomerAddress) ? "border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                  >
                                    {visibleCustomerAddress || "fehlt"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                  <div
                                    className={`flex items-center gap-1 ${reqMiss(visibleCustomerPlz) ? "text-red-500" : "text-foreground/70"}`}
                                  >
                                    <span className="font-medium w-12 sm:w-16 shrink-0">
                                      PLZ:
                                    </span>
                                    <span
                                      className={
                                        reqMiss(visibleCustomerPlz)
                                          ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                          : ""
                                      }
                                    >
                                      {visibleCustomerPlz || "fehlt"}
                                    </span>
                                  </div>
                                  <div
                                    className={`flex items-center gap-1 ${reqMiss(visibleCustomerCity) ? "text-red-500" : "text-foreground/70"}`}
                                  >
                                    <span className="font-medium shrink-0">
                                      Ort:
                                    </span>
                                    <span
                                      className={
                                        reqMiss(visibleCustomerCity)
                                          ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                          : ""
                                      }
                                    >
                                      {visibleCustomerCity || "fehlt"}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-foreground/70">
                                  <span className="font-medium w-12 sm:w-16 shrink-0">
                                    Tel:
                                  </span>
                                  <span className="truncate">
                                    {visibleCustomerPhone || "—"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 text-foreground/70">
                                  <span className="font-medium w-12 sm:w-16 shrink-0">
                                    E-Mail:
                                  </span>
                                  <span className="truncate">
                                    {visibleCustomerEmail || "—"}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {/* PLZ/Ort suggestions are now shown exclusively inside the duplicate panel (§3 UX cleanup) */}
                          </>
                        );
                      })()
                    ) : (
                      /* New order or no customer yet → show dropdown to assign */
                      <>
                        <div className="flex gap-2 min-w-0">
                          <CustomerSearchCombobox
                            customers={customers}
                            value={form.customerId}
                            onChange={(id) =>
                              setForm({ ...form, customerId: id })
                            }
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 text-xs h-[38px]"
                            onClick={() => {
                              setEditingCustomer(false);
                              setNewCust({
                                name: "",
                                phone: "",
                                email: "",
                                address: "",
                                plz: "",
                                city: "",
                                country: "CH",
                              });
                              setShowNewCustomer(true);
                            }}
                          >
                            + Neuer Kunde
                          </Button>
                        </div>
                        {form.customerId &&
                          (() => {
                            const cust = customers.find(
                              (c: Customer) => c.id === form.customerId,
                            );
                            if (!cust) return null;
                            const reqMiss = isRequiredCustomerFieldMissing;
                            const visibleCustomerAddress = cust.address;
                            const visibleCustomerPlz = cust.plz;
                            const visibleCustomerCity = cust.city;
                            const visibleCustomerPhone = cust.phone;
                            const visibleCustomerEmail = cust.email;
                            return (
                              <div className="mt-2 border border-sky-200 rounded-lg p-2 sm:p-3 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-950/20 space-y-1.5 min-w-0">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    {/* ISSUE 4 — Neutral display for fallback customers */}
                                    {isFallbackCustomerName(cust.name) ? (
                                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                        <span className="text-sm font-semibold truncate text-amber-600 dark:text-amber-400">
                                          ⚠️ Kunde noch nicht zugeordnet
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                          (bitte echten Kunden zuweisen)
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                        <span className="text-sm font-semibold truncate">
                                          👤 {cust.customerNumber || ""}
                                          {cust.customerNumber ? " · " : ""}
                                        </span>
                                        <span
                                          className={`text-sm font-semibold truncate ${reqMiss(cust.name) ? "text-red-500 border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                        >
                                          {cust.name || "Name fehlt"}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 sm:justify-end">
                                    <button
                                      type="button"
                                      className="text-xs text-blue-600 hover:underline flex items-center gap-1 whitespace-nowrap"
                                      onClick={() => openCustomerEditor()}
                                    >
                                      ✏️ Bearbeiten
                                    </button>
                                    <button
                                      type="button"
                                      className="text-xs text-amber-600 hover:underline flex items-center gap-1 whitespace-nowrap"
                                      onClick={() => setDupCheckOpen(true)}
                                    >
                                      🔍 Duplikate prüfen
                                    </button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 gap-1 text-xs min-w-0">
                                  <div
                                    className={`flex items-center gap-1 min-w-0 ${reqMiss(visibleCustomerAddress) ? "text-red-500" : "text-foreground/70"}`}
                                  >
                                    <span className="font-medium w-12 sm:w-16 shrink-0">
                                      Strasse:
                                    </span>
                                    <span
                                      className={`truncate ${reqMiss(visibleCustomerAddress) ? "border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                    >
                                      {visibleCustomerAddress || "fehlt"}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                    <div
                                      className={`flex items-center gap-1 ${reqMiss(visibleCustomerPlz) ? "text-red-500" : "text-foreground/70"}`}
                                    >
                                      <span className="font-medium w-12 sm:w-16 shrink-0">
                                        PLZ:
                                      </span>
                                      <span
                                        className={
                                          reqMiss(visibleCustomerPlz)
                                            ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                            : ""
                                        }
                                      >
                                        {visibleCustomerPlz || "fehlt"}
                                      </span>
                                    </div>
                                    <div
                                      className={`flex items-center gap-1 ${reqMiss(visibleCustomerCity) ? "text-red-500" : "text-foreground/70"}`}
                                    >
                                      <span className="font-medium shrink-0">
                                        Ort:
                                      </span>
                                      <span
                                        className={
                                          reqMiss(visibleCustomerCity)
                                            ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                            : ""
                                        }
                                      >
                                        {visibleCustomerCity || "fehlt"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 text-foreground/70">
                                    <span className="font-medium w-12 sm:w-16 shrink-0">
                                      Tel:
                                    </span>
                                    <span className="truncate">
                                      {visibleCustomerPhone || "—"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 text-foreground/70">
                                    <span className="font-medium w-12 sm:w-16 shrink-0">
                                      E-Mail:
                                    </span>
                                    <span className="truncate">
                                      {visibleCustomerEmail || "—"}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                      </>
                    )}
                  </>
                ) : (
                  <div
                    ref={customerEditorRef}
                    className="border rounded-lg p-3 space-y-2 bg-blue-50/50 dark:bg-blue-900/10 border-blue-300 dark:border-blue-800"
                  >
                    <p className="text-xs font-semibold text-muted-foreground">
                      {editingCustomer
                        ? "✏️ Kunde bearbeiten"
                        : "➕ Neuer Kunde erstellen"}
                    </p>
                    {/* Phase 2d (Stage 3): read-only hint line shown after Undo. Lives inside the customer-editor (only when editing) so the Rückgängig context stays close to the address fields. */}
                    {editingCustomer &&
                      editId &&
                      undoPreviousAddress &&
                      (undoPreviousAddress.address ||
                        undoPreviousAddress.plz ||
                        undoPreviousAddress.city) &&
                      (() => {
                        const parts = [
                          undoPreviousAddress.address,
                          [undoPreviousAddress.plz, undoPreviousAddress.city]
                            .filter(Boolean)
                            .join(" "),
                        ]
                          .filter(Boolean)
                          .join(", ");
                        return (
                          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 flex items-start justify-between gap-2">
                            <span>
                              Vorherige Adresse (nur Hinweis, nicht übernommen):{" "}
                              <span className="font-medium">{parts}</span>
                            </span>
                            <button
                              type="button"
                              className="text-amber-700 dark:text-amber-300 hover:underline shrink-0"
                              onClick={() => setUndoPreviousAddress(null)}
                            >
                              schliessen
                            </button>
                          </div>
                        );
                      })()}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Name *</Label>
                        <Input
                          placeholder="Name"
                          value={newCust.name}
                          onChange={(e) =>
                            setNewCust({ ...newCust, name: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Telefon</Label>
                        <Input
                          placeholder="Telefon"
                          value={newCust.phone}
                          onChange={(e) =>
                            setNewCust({ ...newCust, phone: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Strasse + Hausnr. *</Label>
                      <Input
                        placeholder="Strasse + Hausnr."
                        value={newCust.address}
                        onChange={(e) =>
                          setNewCust({ ...newCust, address: e.target.value })
                        }
                      />
                    </div>
                    {/* Paket N + O: shared Land/PLZ/Ort input with country-aware autocomplete. */}
                    <PlzOrtInput
                      country={newCust.country}
                      onCountryChange={(country) =>
                        setNewCust({ ...newCust, country })
                      }
                      plzValue={newCust.plz}
                      ortValue={newCust.city}
                      onPlzChange={(plz) => setNewCust({ ...newCust, plz })}
                      onOrtChange={(city) => setNewCust({ ...newCust, city })}
                      onBothChange={(plz, city) =>
                        setNewCust({ ...newCust, plz, city })
                      }
                      required
                      compact
                    />
                    <div>
                      <Label className="text-xs">E-Mail</Label>
                      <Input
                        placeholder="E-Mail"
                        value={newCust.email}
                        onChange={(e) =>
                          setNewCust({ ...newCust, email: e.target.value })
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={saveCustomer}
                        disabled={savingCust}
                      >
                        {savingCust
                          ? "Speichern..."
                          : editingCustomer
                            ? "Kunde aktualisieren"
                            : "Kunde erstellen"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDupCheckOpen(true)}
                      >
                        🔍 Duplikate prüfen
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowNewCustomer(false);
                          setEditingCustomer(false);
                        }}
                      >
                        Zurück zum Auftrag
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Ausführungsadresse / Baustellenadresse.
                  Bei mehreren Arbeitsorten ist der bearbeitbare Block darunter die einzige Wahrheit. */}
              {!hasMultipleEditWorkSites && (
                <div className="rounded-lg border bg-slate-50/70 dark:bg-slate-900/30 p-3 space-y-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(form.siteAddressDifferent)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSiteAddressEditing(checked);
                        setForm((prev) => ({
                          ...prev,
                          siteAddressDifferent: checked,
                          ...(checked
                            ? {}
                            : {
                                siteName: "",
                                siteAddress: "",
                                sitePlz: "",
                                siteCity: "",
                                siteNote: "",
                              }),
                        }));
                      }}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        Ausführungsadresse abweichend von Rechnungsadresse
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Nur aktivieren, wenn die Arbeit an einem anderen Ort
                        ausgeführt wird.
                      </span>
                    </span>
                  </label>

                  {form.siteAddressDifferent && !siteAddressEditing && (
                    <button
                      type="button"
                      onClick={() => setSiteAddressEditing(true)}
                      className="w-full rounded-lg border bg-background p-3 text-left hover:bg-muted/40 transition-colors"
                      title="Ausführungsadresse bearbeiten"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">
                            📍 {form.siteName?.trim() || "Ausführungsadresse"}
                          </div>
                          <div className="mt-1 grid grid-cols-[74px_1fr] gap-x-2 gap-y-0.5 text-sm">
                            <span className="text-muted-foreground">
                              Strasse:
                            </span>
                            <span className="truncate">
                              {form.siteAddress?.trim() || "–"}
                            </span>
                            <span className="text-muted-foreground">
                              PLZ / Ort:
                            </span>
                            <span className="truncate">
                              {[form.sitePlz, form.siteCity]
                                .filter(Boolean)
                                .join(" ") || "–"}
                            </span>
                            {form.siteNote?.trim() && (
                              <>
                                <span className="text-muted-foreground">
                                  Hinweis:
                                </span>
                                <span className="truncate">
                                  {form.siteNote}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-primary">
                          Bearbeiten
                        </span>
                      </div>
                    </button>
                  )}

                  {form.siteAddressDifferent && siteAddressEditing && (
                    <div className="rounded-lg border bg-background p-3 space-y-3">
                      <div>
                        <div className="text-sm font-semibold">
                          Ausführungsadresse / Baustellenadresse
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Gilt nur für diesen Auftrag. Wird später in Angebot,
                          Rechnung und PDF separat angezeigt.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Objekt / Name</Label>
                          <Input
                            placeholder="z. B. Baustelle Tiefgarage"
                            value={form.siteName}
                            onChange={(e) =>
                              setForm({ ...form, siteName: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Strasse + Hausnr.</Label>
                          <Input
                            placeholder="Strasse + Hausnr."
                            value={form.siteAddress}
                            onChange={(e) =>
                              setForm({ ...form, siteAddress: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-[130px_1fr] gap-2">
                        <div>
                          <Label className="text-xs">PLZ</Label>
                          <Input
                            placeholder="PLZ"
                            value={form.sitePlz}
                            onChange={(e) =>
                              setForm({ ...form, sitePlz: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Ort</Label>
                          <Input
                            placeholder="Ort"
                            value={form.siteCity}
                            onChange={(e) =>
                              setForm({ ...form, siteCity: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs">Zusatz / Hinweis</Label>
                        <Input
                          placeholder="z. B. Eingang hinten, Tor 2, Hauswart vor Ort"
                          value={form.siteNote}
                          onChange={(e) =>
                            setForm({ ...form, siteNote: e.target.value })
                          }
                        />
                      </div>

                      <div className="flex justify-end">
                        <div className="flex items-center gap-2 sm:justify-end">
                          <span className="hidden sm:inline text-xs text-muted-foreground">
                            Wird mit dem Auftrag gespeichert.
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => setSiteAddressEditing(false)}
                          >
                            Adresse übernehmen
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Service Items + rest of form — collapsed when dupCheck open */}
              {dupCheckOpen ? (
                <div className="p-2 bg-muted/40 rounded border border-dashed text-xs text-muted-foreground flex items-center justify-between">
                  <span>
                    {formItems.filter((i) => i.serviceName).length} Leistung(en)
                    · {formatCurrency(itemsTotal, currency)} ·{" "}
                    {form.date || "–"} · {form.status}
                  </span>
                  <span className="text-[10px] italic">
                    Duplikat-Prüfung aktiv — Form eingeklappt
                  </span>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border bg-background p-2.5 sm:p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Label className="text-base font-semibold">
                          {hasMultipleEditWorkSites
                            ? "Arbeitsorte & Leistungen *"
                            : "Leistungen *"}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {hasMultipleEditWorkSites
                            ? `${currentEditWorkSites.length} Arbeitsorte · ${formItems.filter((item) => item.serviceName.trim()).length} Leistungen · ${formatCurrency(itemsTotal, currency)}`
                            : "Klein, kompakt: Leistung, Prüfung, Preis und Menge pro Position."}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="flex flex-wrap justify-end gap-2">
                          {hasMultipleEditWorkSites && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={toggleWorkSiteOverview}
                                className="h-7 px-2 text-xs"
                              >
                                {expandedWorkSiteIds.length > 0 ? "Übersicht" : "Alle öffnen"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={addFormWorkSite}
                                className="h-7 px-2 text-xs"
                              >
                                + Arbeitsort
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={addItem}
                            className="h-7 px-2 text-xs"
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Leistung hinzufügen
                          </Button>
                        </div>
                        {hasMultipleEditWorkSites && (
                          <span className="text-[10px] text-muted-foreground">
                            Ein Block: Arbeitsort aufklappen, dort Leistungen bearbeiten.
                          </span>
                        )}
                      </div>
                    </div>

                    {hasEditCurrencyReview && (
                      <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200">
                        <div className="font-semibold">⚠ Währung prüfen</div>
                        <div>
                          Im Kundentext wurden unterschiedliche Währungen
                          erkannt. Total nicht berechenbar. Erst bereinigen,
                          dann Angebot oder Rechnung erstellen.
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      {formItemDisplayRows.map(
                        ({
                          item,
                          index,
                          site,
                          isFirstInSite,
                          isEmptySitePlaceholder,
                        }) => {
                          const curOrder = editId
                            ? orders.find((o: Order) => o.id === editId)
                            : null;

                          const unitMismatchReason = curOrder?.reviewReasons
                            ?.filter((r: string) =>
                              r.startsWith("unit_mismatch:"),
                            )
                            .find((r: string) => {
                              const [, serviceName] = r.split(":");
                              return (
                                (serviceName || "").trim().toLowerCase() ===
                                (item.serviceName || "").trim().toLowerCase()
                              );
                            });

                          const priceOverrideReason = curOrder?.reviewReasons
                            ?.filter((r: string) =>
                              r.startsWith("price_override:"),
                            )
                            .find((r: string) => {
                              const [, serviceName] = r.split(":");
                              return (
                                normalizeForMatch(serviceName) ===
                                normalizeForMatch(item.serviceName)
                              );
                            });

                          const priceUnclearReason = curOrder?.reviewReasons
                            ?.filter((r: string) =>
                              r.startsWith("price_unclear:"),
                            )
                            .find((r: string) => {
                              const [, serviceName] = r.split(":");
                              return (
                                !serviceName ||
                                normalizeForMatch(serviceName) ===
                                  normalizeForMatch(item.serviceName)
                              );
                            });

                          const catalogService = findCatalogServiceForName(
                            services,
                            item.serviceName,
                          );
                          const catalogPrice = Number(
                            catalogService?.defaultPrice || 0,
                          );
                          const itemPriceNumber = Number(item.unitPrice || 0);
                          const hasFrontendCatalogPriceDeviation =
                            Boolean(catalogService) &&
                            !item.catalogReviewConfirmed &&
                            !unitMismatchReason &&
                            normalizePriceUnitForCompare(
                              catalogService?.unit,
                            ) === normalizePriceUnitForCompare(item.unit) &&
                            Number.isFinite(catalogPrice) &&
                            Number.isFinite(itemPriceNumber) &&
                            catalogPrice > 0 &&
                            itemPriceNumber > 0 &&
                            Math.abs(catalogPrice - itemPriceNumber) >= 0.01;
                          const hasFrontendCatalogTextFlatOverride =
                            Boolean(catalogService) &&
                            !item.catalogReviewConfirmed &&
                            !unitMismatchReason &&
                            normalizePriceUnitForCompare(
                              catalogService?.unit,
                            ) !== normalizePriceUnitForCompare(item.unit) &&
                            normalizePriceUnitForCompare(item.unit) ===
                              "flat" &&
                            Number.isFinite(itemPriceNumber) &&
                            itemPriceNumber > 0 &&
                            Number(item.quantity || 0) === 1;

                          const hasCurrencyConflict = hasEditCurrencyReview;
                          const priceInputReview =
                            Number(item.unitPrice || 0) === 0;
                          const quantityInputReview =
                            Number(item.quantity || 0) === 0;
                          const showUnitConflict =
                            !hasCurrencyConflict &&
                            Boolean(
                              item.aiWarning?.trim() || unitMismatchReason,
                            );
                          const showPriceOverride =
                            !hasCurrencyConflict &&
                            !showUnitConflict &&
                            Boolean(
                              (!item.catalogReviewConfirmed && priceOverrideReason) ||
                              hasFrontendCatalogPriceDeviation ||
                              hasFrontendCatalogTextFlatOverride,
                            );
                          const showPriceReferenceReview =
                            !hasCurrencyConflict &&
                            !priceInputReview &&
                            Boolean(
                              priceUnclearReason ||
                              curOrder?.reviewReasons?.includes(
                                "unit_price_review",
                              ),
                            );

                          const itemTotal =
                            Number(item.unitPrice || 0) *
                            Number(item.quantity || 0);
                          const isCompleteItemForCatalogAction = Boolean(
                            item.serviceName?.trim() &&
                            item.unit?.trim() &&
                            Number(item.unitPrice || 0) > 0 &&
                            Number(item.quantity || 0) > 0,
                          );

                          const isManualService =
                            Boolean(item.serviceName?.trim()) &&
                            !isServiceInCatalog(item.serviceName);
                          const showManualServiceReview =
                            !hasCurrencyConflict && isManualService;
                          const sourceLineForItem =
                            findCustomerTextLineForService(
                              visibleCustomerMessageText || customerMessageText,
                              item.serviceName,
                              {
                                quantity: item.quantity,
                                unit: item.unit,
                                unitPrice: item.unitPrice,
                              },
                            );
                          const catalogSummary = catalogService
                            ? `${catalogService.unit}${
                                catalogPrice > 0
                                  ? ` · ${formatCurrency(catalogPrice, currency)}`
                                  : ""
                              }`
                            : "";
                          const orderSummaryParts = [
                            Number(item.quantity || 0) > 0
                              ? `${item.quantity} ${unitShortLabel(item.unit)}`
                              : unitShortLabel(item.unit),
                            itemPriceNumber > 0
                              ? `à ${formatCurrency(itemPriceNumber, currency)}`
                              : "Preis prüfen",
                          ].filter(Boolean);
                          const orderSummary = orderSummaryParts.join(" ");
                          const showItemReviewBlock =
                            !hasCurrencyConflict &&
                            (showUnitConflict ||
                              showPriceOverride ||
                              showPriceReferenceReview ||
                              priceInputReview ||
                              quantityInputReview ||
                              showManualServiceReview);
                          const hasMissingItemInput =
                            priceInputReview || quantityInputReview;
                          const isBlockingItemReview =
                            hasMissingItemInput ||
                            (showPriceReferenceReview &&
                              !isCompleteItemForCatalogAction) ||
                            (showUnitConflict &&
                              !isCompleteItemForCatalogAction);
                          const isMenuOpen = serviceActionMenuKey === item.key;
                          const hasCriticalItemReview = isBlockingItemReview;
                          const hasResolvedReviewCatalogAction =
                            isCompleteItemForCatalogAction &&
                            Boolean(
                              hasCurrencyConflict ||
                              unitMismatchReason ||
                              item.aiWarning?.trim() ||
                              priceUnclearReason ||
                              curOrder?.reviewReasons?.includes(
                                "unit_price_review",
                              ),
                            );
                          const existingCatalogUnitMismatch = Boolean(
                            catalogService &&
                            normalizePriceUnitForCompare(
                              catalogService.unit,
                            ) !== normalizePriceUnitForCompare(item.unit),
                          );
                          const existingCatalogPriceMismatch = Boolean(
                            catalogService &&
                            Number.isFinite(catalogPrice) &&
                            Number.isFinite(itemPriceNumber) &&
                            catalogPrice > 0 &&
                            itemPriceNumber > 0 &&
                            Math.abs(catalogPrice - itemPriceNumber) >= 0.01,
                          );
                          const hasCatalogActionMenu =
                            isCompleteItemForCatalogAction &&
                            !priceInputReview &&
                            !quantityInputReview &&
                            (showManualServiceReview ||
                              showPriceOverride ||
                              existingCatalogUnitMismatch ||
                              existingCatalogPriceMismatch ||
                              hasResolvedReviewCatalogAction);
                          const hasAnyItemReview =
                            hasCriticalItemReview ||
                            showPriceOverride ||
                            showManualServiceReview ||
                            hasResolvedReviewCatalogAction;
                          const siteIndex = site
                            ? currentEditWorkSites.findIndex(
                                (option) => option.id === site.id,
                              )
                            : -1;
                          const isActiveSite = Boolean(
                            site && activeWorkSiteId === site.id,
                          );
                          const groupItems = getWorkSiteGroupItems(site);
                          const groupItemCount = groupItems.length;
                          const groupReviewBadges = (() => {
                            const badges: ReviewBadge[] = [];
                            const addBadge = (
                              key: string,
                              label: string,
                              className: string,
                              tooltip?: string,
                            ) => {
                              if (!badges.some((badge) => badge.key === key)) {
                                badges.push({ key, label, className, tooltip });
                              }
                            };

                            for (const groupItem of groupItems) {
                              const itemName = groupItem.serviceName || "";
                              const itemKey = normalizeForMatch(itemName);
                              const groupCatalogService = findCatalogServiceForName(
                                services,
                                itemName,
                              );
                              const groupCatalogPrice = Number(
                                groupCatalogService?.defaultPrice || 0,
                              );
                              const groupItemPrice = Number(
                                groupItem.unitPrice || 0,
                              );
                              const groupItemQuantity = Number(
                                groupItem.quantity || 0,
                              );
                              const groupUnitMismatchReason = curOrder?.reviewReasons
                                ?.filter((reason: string) =>
                                  reason.startsWith("unit_mismatch:"),
                                )
                                .find((reason: string) => {
                                  const [, serviceName] = reason.split(":");
                                  return (
                                    normalizeForMatch(serviceName) === itemKey
                                  );
                                });
                              const groupPriceOverrideReason = curOrder?.reviewReasons
                                ?.filter((reason: string) =>
                                  reason.startsWith("price_override:"),
                                )
                                .find((reason: string) => {
                                  const [, serviceName] = reason.split(":");
                                  return (
                                    normalizeForMatch(serviceName) === itemKey
                                  );
                                });
                              const groupPriceUnclearReason = curOrder?.reviewReasons
                                ?.filter((reason: string) =>
                                  reason.startsWith("price_unclear:"),
                                )
                                .find((reason: string) => {
                                  const [, serviceName] = reason.split(":");
                                  return (
                                    !serviceName ||
                                    normalizeForMatch(serviceName) === itemKey
                                  );
                                });
                              const groupCatalogPriceDeviation = Boolean(
                                groupCatalogService &&
                                  !groupItem.catalogReviewConfirmed &&
                                  !groupUnitMismatchReason &&
                                  normalizePriceUnitForCompare(
                                    groupCatalogService.unit,
                                  ) === normalizePriceUnitForCompare(groupItem.unit) &&
                                  Number.isFinite(groupCatalogPrice) &&
                                  Number.isFinite(groupItemPrice) &&
                                  groupCatalogPrice > 0 &&
                                  groupItemPrice > 0 &&
                                  Math.abs(groupCatalogPrice - groupItemPrice) >= 0.01,
                              );
                              const groupTextFlatOverride = Boolean(
                                groupCatalogService &&
                                  !groupItem.catalogReviewConfirmed &&
                                  !groupUnitMismatchReason &&
                                  normalizePriceUnitForCompare(
                                    groupCatalogService.unit,
                                  ) !== normalizePriceUnitForCompare(groupItem.unit) &&
                                  normalizePriceUnitForCompare(groupItem.unit) ===
                                    "flat" &&
                                  groupItemPrice > 0 &&
                                  groupItemQuantity === 1,
                              );
                              const groupCatalogMissing = Boolean(
                                itemName.trim() &&
                                  !groupItem.catalogReviewConfirmed &&
                                  !groupCatalogService,
                              );

                              if (groupItemPrice <= 0 || groupItemQuantity <= 0) {
                                addBadge(
                                  "amount",
                                  "Preis/Menge prüfen",
                                  "bg-red-100 text-red-700 ring-1 ring-red-200",
                                  `${itemName || "Leistung"}: Preis oder Menge fehlt/ist unsicher.`,
                                );
                                continue;
                              }
                              if (groupUnitMismatchReason || groupItem.aiWarning?.trim()) {
                                addBadge(
                                  "unit",
                                  "Einheit prüfen",
                                  "bg-orange-100 text-orange-800 ring-1 ring-orange-200",
                                  `${itemName || "Leistung"}: Einheit, Menge oder Preis prüfen.`,
                                );
                              }
                              if (groupPriceUnclearReason) {
                                addBadge(
                                  "price_unclear",
                                  "Betrag prüfen",
                                  "bg-red-100 text-red-700 ring-1 ring-red-200",
                                  `${itemName || "Leistung"}: Preis im Text unklar.`,
                                );
                              }
                              if (
                                (!groupItem.catalogReviewConfirmed && groupPriceOverrideReason) ||
                                groupCatalogPriceDeviation ||
                                groupTextFlatOverride
                              ) {
                                addBadge(
                                  "price_deviation",
                                  "Preis abweichend",
                                  "bg-yellow-100 text-yellow-900 ring-1 ring-yellow-300",
                                  formatCatalogReviewTooltip({
                                    title: "Preis weicht vom Katalog ab.",
                                    item: groupItem as any,
                                    catalog: groupCatalogService,
                                    currency,
                                  }),
                                );
                              }
                              if (groupCatalogMissing) {
                                addBadge(
                                  "catalog_missing",
                                  "Nicht im Katalog",
                                  "bg-yellow-100 text-yellow-900 ring-1 ring-yellow-300",
                                  formatCatalogReviewTooltip({
                                    title: "Nicht im Katalog.",
                                    item: groupItem as any,
                                    currency,
                                  }),
                                );
                              }
                            }

                            return combineCatalogReviewBadges(badges);
                          })();
                          const siteHasRequiredInfo = site
                            ? hasWorkSiteContent(site)
                            : false;
                          const siteNeedsReview = Boolean(
                            !site || (site && !siteHasRequiredInfo),
                          );
                          const siteHasNoItems = Boolean(
                            site && groupItemCount === 0,
                          );
                          const siteAccentClass = siteNeedsReview
                            ? "border-red-300 bg-red-50/80 text-red-900 dark:border-red-800/70 dark:bg-red-950/20 dark:text-red-100"
                            : siteHasNoItems
                              ? "border-amber-300 bg-amber-50/80 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/20 dark:text-amber-100"
                              : "border-slate-300 bg-slate-50/80 text-slate-900 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-50";
                          const itemAccentClass = siteNeedsReview
                            ? "border-l-red-400"
                            : siteHasNoItems
                              ? "border-l-amber-400"
                              : "border-l-slate-300";
                          const groupExpanded = isWorkSiteGroupExpanded(site);
                          const isEditingSite = Boolean(
                            site && editingWorkSiteId === site.id,
                          );

                          if (
                            hasMultipleEditWorkSites &&
                            !isFirstInSite &&
                            !groupExpanded
                          ) {
                            return null;
                          }

                          return (
                            <div
                              key={item.key}
                              className={
                                hasMultipleEditWorkSites ? "space-y-1.5" : ""
                              }
                            >
                              {hasMultipleEditWorkSites && isFirstInSite && (
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => {
                                    if (site) setActiveWorkSiteId(site.id);
                                    toggleWorkSiteGroup(site);
                                  }}
                                  onKeyDown={(event) => {
                                    if (
                                      event.key === "Enter" ||
                                      event.key === " "
                                    ) {
                                      event.preventDefault();
                                      if (site) setActiveWorkSiteId(site.id);
                                      toggleWorkSiteGroup(site);
                                    }
                                  }}
                                  className={`rounded-xl border-2 px-3 py-2 shadow-sm ${groupExpanded ? "rounded-b-none border-b-0" : ""} ${
                                    site
                                      ? siteAccentClass
                                      : "border-red-200 bg-red-50/80 text-red-900 dark:border-red-800/70 dark:bg-red-950/20 dark:text-red-100"
                                  } ${isActiveSite ? "ring-2 ring-offset-1 ring-cyan-300" : ""}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-tight">
                                        <span className="shrink-0 text-base leading-none">
                                          {groupExpanded ? "▾" : "▸"}
                                        </span>
                                        <span>
                                          📍{" "}
                                          {site
                                            ? `${siteIndex + 1}. ${formatWorkSiteTitle(site)}`
                                            : "Neue Leistung: Arbeitsort wählen"}
                                        </span>
                                        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200">
                                          {groupItemCount} Leistung
                                          {groupItemCount === 1 ? "" : "en"}
                                        </span>
                                        {isActiveSite && (
                                          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-cyan-700 ring-1 ring-cyan-200">
                                            aktiv
                                          </span>
                                        )}
                                        {siteNeedsReview && (
                                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">
                                            Arbeitsort prüfen
                                          </span>
                                        )}
                                        {siteHasNoItems && !siteNeedsReview && (
                                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                                            Keine Leistungen
                                          </span>
                                        )}
                                      </div>
                                      {groupReviewBadges.length > 0 && (
                                        <div className="mt-1 flex flex-wrap justify-start gap-1">
                                          {groupReviewBadges.map((badge) =>
                                            renderReviewBadge(
                                              badge,
                                              "px-2 py-0.5 text-[10px] font-semibold",
                                            ),
                                          )}
                                        </div>
                                      )}
                                      <div className="mt-0.5 text-xs text-muted-foreground">
                                        {site
                                          ? formatWorkSiteAddress(site) ||
                                            "Adresse prüfen"
                                          : "Bitte Arbeitsort auswählen, dann Leistung prüfen"}
                                      </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                      <div className="text-[10px] text-muted-foreground">
                                        Zwischensumme
                                      </div>
                                      <div className="font-mono text-sm font-semibold">
                                        {formatCurrency(
                                          site ? getWorkSiteTotal(site.id) : 0,
                                          currency,
                                        )}
                                      </div>
                                      {site && (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setActiveWorkSiteId(site.id);
                                            setEditingWorkSiteId((prev) =>
                                              prev === site.id ? null : site.id,
                                            );
                                            if (!groupExpanded) {
                                              setExpandedWorkSiteIds((prev) =>
                                                prev.includes(site.id)
                                                  ? prev
                                                  : [site.id, ...prev],
                                              );
                                            }
                                          }}
                                          className="mt-1 text-xs text-primary hover:underline"
                                        >
                                          {isEditingSite
                                            ? "Arbeitsort schließen"
                                            : "Arbeitsort bearbeiten"}
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {site && isEditingSite && (
                                    <div
                                      onClick={(event) => event.stopPropagation()}
                                      className="mt-2 rounded-md border bg-background/80 p-2 space-y-2"
                                    >
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <div>
                                          <Label className="text-[10px]">
                                            Bezeichnung
                                          </Label>
                                          <Input
                                            className="h-8 text-xs"
                                            value={site.siteName || ""}
                                            onChange={(e) =>
                                              updateFormWorkSite(
                                                site.id,
                                                "siteName",
                                                e.target.value,
                                              )
                                            }
                                            placeholder="z. B. Haus A, EG rechts"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-[10px]">
                                            Strasse
                                          </Label>
                                          <Input
                                            className="h-8 text-xs"
                                            value={site.siteAddress || ""}
                                            onChange={(e) =>
                                              updateFormWorkSite(
                                                site.id,
                                                "siteAddress",
                                                e.target.value,
                                              )
                                            }
                                            placeholder="Strasse + Hausnr."
                                          />
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-2">
                                        <div>
                                          <Label className="text-[10px]">PLZ</Label>
                                          <Input
                                            className="h-8 text-xs"
                                            value={site.sitePlz || ""}
                                            onChange={(e) =>
                                              updateFormWorkSite(
                                                site.id,
                                                "sitePlz",
                                                e.target.value,
                                              )
                                            }
                                            placeholder="PLZ"
                                          />
                                        </div>
                                        <div>
                                          <Label className="text-[10px]">Ort</Label>
                                          <Input
                                            className="h-8 text-xs"
                                            value={site.siteCity || ""}
                                            onChange={(e) =>
                                              updateFormWorkSite(
                                                site.id,
                                                "siteCity",
                                                e.target.value,
                                              )
                                            }
                                            placeholder="Ort"
                                          />
                                        </div>
                                      </div>
                                      <div>
                                        <Label className="text-[10px]">Hinweis</Label>
                                        <Input
                                          className="h-8 text-xs"
                                          value={site.siteNote || ""}
                                          onChange={(e) =>
                                            updateFormWorkSite(
                                              site.id,
                                              "siteNote",
                                              e.target.value,
                                            )
                                          }
                                          placeholder="z. B. Eingang hinten, Rampe 2"
                                        />
                                      </div>
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-[11px] text-muted-foreground">
                                          Zugeordnet: {groupItemCount} Leistung(en)
                                        </div>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          className="text-red-600 hover:text-red-700"
                                          onClick={() => removeFormWorkSite(site.id)}
                                        >
                                          Löschen
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {groupExpanded && isEmptySitePlaceholder ? (
                                <div
                                  className={`ml-2 rounded-lg border-2 border-dashed p-3 text-xs shadow-sm ${
                                    siteNeedsReview
                                      ? "border-red-300 bg-red-50/50 text-red-800 dark:border-red-800 dark:bg-red-950/10 dark:text-red-200"
                                      : "border-amber-300 bg-amber-50/40 text-amber-800 dark:border-amber-800 dark:bg-amber-950/10 dark:text-amber-200"
                                  }`}
                                >
                                  <div className="font-semibold">
                                    {siteNeedsReview
                                      ? "Arbeitsort bitte ausfüllen."
                                      : "Noch keine Leistungen in diesem Arbeitsort."}
                                  </div>
                                  <div className="mt-0.5 text-muted-foreground">
                                    Arbeitsort bearbeiten oder löschen. Leistung erst hinzufügen, wenn der Ort stimmt.
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {site && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => {
                                          setActiveWorkSiteId(site.id);
                                          setEditingWorkSiteId(site.id);
                                        }}
                                      >
                                        Arbeitsort bearbeiten
                                      </Button>
                                    )}
                                    {site && !siteNeedsReview && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => addItemToWorkSite(site.id)}
                                      >
                                        + Leistung hier hinzufügen
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              ) : groupExpanded && (
                                <div
                                  className={`relative border-2 p-2 space-y-1.5 min-w-0 shadow-sm ${
                                    hasMultipleEditWorkSites
                                      ? `ml-2 rounded-lg border-l-4 ${itemAccentClass}`
                                      : "rounded-lg"
                                  } ${
                                    hasCriticalItemReview
                                      ? "border-red-300 bg-red-50/30 dark:border-red-800/70 dark:bg-red-950/10"
                                      : hasAnyItemReview
                                        ? "border-amber-300 bg-amber-50/30 dark:border-amber-800/70 dark:bg-amber-950/10"
                                        : "border-slate-300 bg-slate-50/40 dark:border-slate-700 dark:bg-slate-900/20"
                                  }`}
                                  onClick={() =>
                                    site && setActiveWorkSiteId(site.id)
                                  }
                                >
                                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-start">
                                    <div className="min-w-0 space-y-1">
                                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 items-center">
                                        <div className="group min-w-0">
                                          <ServiceCombobox
                                            value={item.serviceName}
                                            services={
                                              services as ServiceOption[]
                                            }
                                            onChange={(name, svc) =>
                                              onItemServiceSelect(
                                                index,
                                                name,
                                                svc,
                                              )
                                            }
                                            onServiceCreated={
                                              handleServiceCreated
                                            }
                                            currentPrice={item.unitPrice}
                                            currentUnit={item.unit}
                                            showManualHint={false}
                                            saveButtonPlacement="none"
                                          />
                                          {item.serviceName.trim().length >
                                            28 && (
                                            <p className="mt-1 hidden rounded-md border border-slate-200 bg-muted/40 px-2 py-1 text-[11px] leading-snug text-muted-foreground break-words group-focus-within:block">
                                              {item.serviceName.trim()}
                                            </p>
                                          )}
                                        </div>

                                        <div
                                          className="h-1"
                                          aria-hidden="true"
                                        />
                                      </div>
                                    </div>

                                    <div className="pt-1 text-right text-[11px] text-muted-foreground leading-tight shrink-0">
                                      <div>Total</div>
                                      <div className="font-mono text-xs font-semibold text-foreground whitespace-nowrap">
                                        {formatCurrency(itemTotal, currency)}
                                      </div>
                                    </div>

                                    <div className="relative shrink-0">
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setServiceActionMenuKey((prev) =>
                                            prev === item.key ? null : item.key,
                                          );
                                        }}
                                        className="mt-0.5 rounded-md border border-slate-200 bg-background p-1.5 text-slate-600 hover:bg-muted"
                                        title="Aktionen"
                                      >
                                        <MoreVertical className="w-3.5 h-3.5" />
                                      </button>

                                      {isMenuOpen && (
                                        <div
                                          onClick={(event) =>
                                            event.stopPropagation()
                                          }
                                          className="absolute right-0 top-8 z-50 w-56 rounded-md border bg-background py-1 text-sm shadow-lg"
                                        >
                                          {hasMultipleEditWorkSites && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setMovingItemKey(item.key);
                                                setActiveWorkSiteId(
                                                  item.workSiteId ||
                                                    activeWorkSiteId,
                                                );
                                                setServiceActionMenuKey(null);
                                              }}
                                              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                                            >
                                              📍 Arbeitsort ändern
                                            </button>
                                          )}

                                          {hasCatalogActionMenu && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                saveItemToServices(index);
                                                setServiceActionMenuKey(null);
                                              }}
                                              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                                            >
                                              <Plus className="h-3.5 w-3.5" />
                                              In Leistungskatalog übernehmen
                                            </button>
                                          )}

                                          <button
                                            type="button"
                                            onClick={() => {
                                              removeItem(index);
                                              setServiceActionMenuKey(null);
                                            }}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Löschen
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-3 gap-1.5">
                                    <div>
                                      <Label className="text-[10px] leading-none">
                                        Einheit
                                      </Label>
                                      <select
                                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                        value={item.unit}
                                        onChange={(e: any) =>
                                          updateItem(
                                            index,
                                            "unit",
                                            e?.target?.value ?? "Stunde",
                                          )
                                        }
                                      >
                                        {priceTypes.map((pt) => (
                                          <option key={pt} value={pt}>
                                            {pt}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    <div>
                                      <Label className="text-[10px] leading-none">
                                        Preis ({currency})
                                      </Label>
                                      <Input
                                        type="number"
                                        step="0.05"
                                        className={`h-8 text-xs ${
                                          priceInputReview
                                            ? "border-red-400 bg-red-50 dark:bg-red-950/20"
                                            : ""
                                        }`}
                                        value={
                                          priceInputReview ? "" : item.unitPrice
                                        }
                                        placeholder={
                                          priceInputReview ? "prüfen" : "0"
                                        }
                                        onFocus={(e) =>
                                          e.currentTarget.select()
                                        }
                                        onChange={(e: any) =>
                                          updateItem(
                                            index,
                                            "unitPrice",
                                            e?.target?.value ?? "",
                                          )
                                        }
                                      />
                                    </div>

                                    <div>
                                      <Label className="text-[10px] leading-none">
                                        Menge
                                      </Label>
                                      <Input
                                        type="number"
                                        step="0.25"
                                        className={`h-8 text-xs ${
                                          quantityInputReview
                                            ? "border-red-400 bg-red-50 dark:bg-red-950/20"
                                            : ""
                                        }`}
                                        value={
                                          quantityInputReview
                                            ? ""
                                            : item.quantity
                                        }
                                        placeholder={
                                          quantityInputReview ? "prüfen" : "0"
                                        }
                                        onFocus={(e) =>
                                          e.currentTarget.select()
                                        }
                                        onChange={(e: any) =>
                                          updateItem(
                                            index,
                                            "quantity",
                                            e?.target?.value ?? "",
                                          )
                                        }
                                      />
                                    </div>
                                  </div>

                                  {hasMultipleEditWorkSites &&
                                    (movingItemKey === item.key ||
                                      !item.workSiteId) && (
                                      <div className="flex justify-end">
                                        <div className="flex w-full items-end gap-2 sm:w-auto">
                                          <div className="min-w-0 flex-1 sm:w-72">
                                            <Label className="text-[10px] leading-none">
                                              Arbeitsort ändern
                                            </Label>
                                            <select
                                              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                              value={item.workSiteId || ""}
                                              onChange={(e: any) => {
                                                updateItem(
                                                  index,
                                                  "workSiteId",
                                                  e?.target?.value ?? "",
                                                );
                                                setMovingItemKey(null);
                                              }}
                                            >
                                              <option value="">
                                                Arbeitsort wählen
                                              </option>
                                              {currentEditWorkSites.map(
                                                (siteOption) => (
                                                  <option
                                                    key={siteOption.id}
                                                    value={siteOption.id}
                                                  >
                                                    {getWorkSiteSelectLabel(
                                                      siteOption,
                                                    )}
                                                  </option>
                                                ),
                                              )}
                                            </select>
                                          </div>
                                          {item.workSiteId && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setMovingItemKey(null)
                                              }
                                              className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted"
                                            >
                                              Fertig
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                  {showItemReviewBlock && (
                                    <div
                                      className={`rounded-md border px-2 py-1.5 text-[10.5px] leading-tight ${
                                        isBlockingItemReview
                                          ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200"
                                          : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200"
                                      }`}
                                    >
                                      <div className="mb-0.5 flex items-center gap-1 font-semibold">
                                        <AlertTriangle className="h-3 w-3 shrink-0" />
                                        Manuell prüfen
                                      </div>

                                      <div className="space-y-0.5">
                                        {showUnitConflict && catalogService && (
                                          <div className="space-y-0.5">
                                            <div>
                                              Text:{" "}
                                              <span className="font-medium">
                                                {orderSummary}
                                              </span>
                                            </div>
                                            {catalogSummary && (
                                              <div>
                                                Katalog:{" "}
                                                <span className="font-medium">
                                                  {catalogSummary}
                                                </span>
                                              </div>
                                            )}
                                            <div>
                                              Einheit passt nicht. Menge,
                                              Einheit und Preis prüfen.
                                            </div>
                                          </div>
                                        )}

                                        {!showUnitConflict &&
                                          showPriceOverride &&
                                          catalogService && (
                                            <div className="space-y-0.5">
                                              {sourceLineForItem ? (
                                                <div>
                                                  Text:{" "}
                                                  <span className="font-medium">
                                                    {sourceLineForItem}
                                                  </span>
                                                  <span className="font-semibold">
                                                    {" "}
                                                    — Textpreis übernommen.
                                                  </span>
                                                </div>
                                              ) : (
                                                <div>
                                                  Textpreis übernommen: Preis
                                                  stammt aus dem Kundentext.
                                                  Genaue Textzeile bitte bei
                                                  Bedarf unten prüfen.
                                                </div>
                                              )}
                                              <div className="text-amber-700/75 dark:text-amber-200/75">
                                                Katalog: {catalogService.unit} ·{" "}
                                                {formatCurrency(
                                                  catalogPrice,
                                                  currency,
                                                )}
                                              </div>
                                            </div>
                                          )}

                                        {!showUnitConflict &&
                                          showPriceReferenceReview && (
                                            <div className="space-y-0.5">
                                              <div>Preis im Text unklar.</div>
                                              {sourceLineForItem && (
                                                <div>
                                                  Text:{" "}
                                                  <span className="font-medium">
                                                    {sourceLineForItem}
                                                  </span>
                                                </div>
                                              )}
                                              <div>Bitte Preis bestätigen.</div>
                                            </div>
                                          )}

                                        {!showUnitConflict &&
                                          (priceInputReview ||
                                            quantityInputReview) && (
                                            <div className="space-y-0.5">
                                              {priceInputReview && (
                                                <div>
                                                  Preis fehlt oder ist unsicher.
                                                </div>
                                              )}
                                              {quantityInputReview && (
                                                <div>
                                                  Menge fehlt oder ist unsicher.
                                                </div>
                                              )}
                                              <div>
                                                Vor Angebot/Rechnung ergänzen.
                                              </div>
                                            </div>
                                          )}

                                        {showManualServiceReview && (
                                          <div>
                                            Nicht im Leistungskatalog. Optional
                                            über Menü übernehmen.
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <Label>Datum</Label>
                      <Input
                        type="date"
                        value={form.date}
                        onChange={(e: any) =>
                          setForm({ ...form, date: e?.target?.value ?? "" })
                        }
                      />
                    </div>

                    <div>
                      <Label>Status</Label>
                      <select
                        className="flex w-full rounded-md border border-input px-3 py-2 text-sm"
                        style={getStatusStyle(ORDER_STATUS_STYLES, form.status)}
                        value={form.status}
                        onChange={(e: any) =>
                          setForm({
                            ...form,
                            status: e?.target?.value ?? "Offen",
                          })
                        }
                      >
                        {orderStatuses.map((s) => (
                          <option
                            key={s}
                            style={getStatusStyle(ORDER_STATUS_STYLES, s)}
                          >
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <Label>Währung</Label>
                      <select
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={currency}
                        onChange={(e: any) =>
                          setCurrency(
                            e?.target?.value === "EUR" ? "EUR" : "CHF",
                          )
                        }
                      >
                        <option value="CHF">CHF</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </div>
                  </div>

                  {/* MwSt block — mirrors the UI used in Angebot/Rechnung bearbeiten.
                Order itself persists only the net total in `totalPrice`. VAT is
                a display-only preview here so the user sees the same breakdown
                they would see after converting the order to an offer/invoice.
                `orderVatRate` is local-only state and is NOT sent to the API. */}
                  <div className="p-1.5 sm:p-4 bg-muted rounded-lg space-y-3 min-w-0">
                    <MwStControl
                      vatRate={orderVatRate}
                      onChange={setOrderVatRate}
                    />
                    <div className="space-y-1 border-t pt-2 min-w-0 text-xs sm:text-sm">
                      <div className="flex justify-between min-w-0">
                        <span className="shrink-0">Netto</span>
                        <span className="font-mono">
                          {formatCurrency(itemsTotal, currency)}
                        </span>
                      </div>
                      {orderVatRate > 0 && (
                        <div className="flex justify-between min-w-0">
                          <span className="shrink-0">
                            MwSt. {orderVatRate}%
                          </span>
                          <span className="font-mono">
                            {formatCurrency(
                              (itemsTotal * orderVatRate) / 100,
                              currency,
                            )}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold border-t pt-2 min-w-0 text-sm sm:text-base">
                        <span className="shrink-0">Total</span>
                        <span className="font-mono text-primary">
                          {formatCurrency(totalWithVat, currency)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Order action buttons — high position directly below Total */}
                  {!showNewCustomer && (
                    <div className="rounded-xl border bg-background p-2 sm:p-3">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setDialogOpen(false)}
                          disabled={saving}
                          className="order-5 w-full lg:order-1 lg:w-auto"
                        >
                          Abbrechen
                        </Button>

                        <div className="order-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:order-2 lg:min-w-[310px]">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={saveAndCreateOffer}
                            disabled={saving}
                            className="w-full border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          >
                            <FileCheck className="mr-1.5 h-4 w-4" />
                            Angebot erstellen
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={saveAndCreateInvoice}
                            disabled={saving}
                            className="w-full border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                          >
                            <FileText className="mr-1.5 h-4 w-4" />
                            Rechnung erstellen
                          </Button>
                        </div>

                        <div className="order-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:order-3 lg:min-w-[340px]">
                          <Button
                            type="button"
                            onClick={() => save()}
                            disabled={saving}
                            className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            {saving ? "Speichere..." : "Speichern"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={saveAndClose}
                            disabled={saving}
                            className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          >
                            Speichern & schließen
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Besonderheiten — always visible, important warnings highlighted */}
                  <div
                    ref={specialNotesRef}
                    tabIndex={-1}
                    className="scroll-mt-24 space-y-2 outline-none focus:ring-2 focus:ring-amber-300/60"
                  >
                    <div className="flex items-center gap-2">
                      <Label className="font-semibold">Besonderheiten</Label>
                      {dangerNoteLines.length > 0 && (
                        <Badge className="bg-red-100 text-red-700 border border-red-300">
                          Gefahr / Achtung
                        </Badge>
                      )}
                    </div>

                    {dangerNoteLines.length > 0 && (
                      <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 space-y-1">
                        <div className="font-semibold flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Wichtige Gefahren / Warnhinweise
                        </div>
                        <ul className="list-disc pl-5">
                          {dangerNoteLines.map((line, index) => (
                            <li key={`${line}-${index}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <textarea
                      className="w-full resize-none overflow-hidden rounded-md border border-yellow-300 bg-yellow-50/40 px-3 py-2 text-sm leading-7 text-slate-900 outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-200 dark:border-yellow-800/70 dark:bg-yellow-950/15 dark:text-slate-100"
                      rows={Math.max(
                        4,
                        normalSpecialNotesText
                          .split(/\n/g)
                          .reduce(
                            (sum, line) =>
                              sum + Math.max(1, Math.ceil(line.length / 70)),
                            0,
                          ),
                      )}
                      style={{ fieldSizing: "content", overflow: "hidden" } as any}
                      placeholder="z.B. Rückruf, Zugang, Parkplatz, Leiter nötig, Terminwunsch..."
                      value={normalSpecialNotesText}
                      onChange={(e) => updateNormalSpecialNotes(e.target.value)}
                    />
                  </div>

                  {/* Leistungsübersicht — live from the editable items above */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <Label className="font-semibold">
                          Leistungsübersicht
                        </Label>
                        <div className="text-xs text-muted-foreground">
                          Live aus den Leistungen oben
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          setServiceOverviewExpanded((prev) => !prev)
                        }
                      >
                        {serviceOverviewExpanded ? "Einklappen" : "Anzeigen"}
                      </Button>
                    </div>

                    {!serviceOverviewExpanded ? (
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-left text-sm hover:bg-muted/40"
                        onClick={() => setServiceOverviewExpanded(true)}
                      >
                        <span className="min-w-0 truncate text-muted-foreground">
                          {hasMultipleEditWorkSites
                            ? `${liveOverviewGroups.length} Arbeitsort${
                                liveOverviewGroups.length === 1 ? "" : "e"
                              } · ${liveOverviewRows.length} Leistung${
                                liveOverviewRows.length === 1 ? "" : "en"
                              }`
                            : `${liveOverviewRows.length} Leistung${
                                liveOverviewRows.length === 1 ? "" : "en"
                              }`}
                        </span>
                        <span className="shrink-0 font-mono font-semibold text-primary">
                          {formatCurrency(itemsTotal, currency)}
                        </span>
                      </button>
                    ) : hasMultipleEditWorkSites ? (
                      <div className="space-y-2 rounded-lg border-2 border-slate-300 bg-muted/20 p-2 dark:border-slate-700">
                        {liveOverviewGroups.length === 0 ? (
                          <div className="rounded-md border bg-background p-3 text-center text-sm text-muted-foreground">
                            Keine Leistung erfasst.
                          </div>
                        ) : (
                          liveOverviewGroups.map((group) => {
                            const groupTotal = group.rows.reduce(
                              (sum, row) => sum + row.sum,
                              0,
                            );

                            return (
                              <div
                                key={group.key}
                                className="overflow-hidden rounded-md border-2 border-slate-300 bg-background shadow-sm dark:border-slate-700"
                              >
                                <div className="flex items-start justify-between gap-2 border-b-2 border-slate-200 bg-muted/40 px-2 py-1.5 dark:border-slate-700">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold leading-tight">
                                      📍 {group.title}
                                    </div>
                                    {group.address && (
                                      <div className="text-xs text-muted-foreground">
                                        {group.address}
                                      </div>
                                    )}
                                  </div>
                                  <div className="shrink-0 rounded-md border border-slate-300 bg-background px-2 py-1 text-right font-mono text-sm font-bold text-primary dark:border-slate-700">
                                    {formatCurrency(groupTotal, currency)}
                                  </div>
                                </div>
                                <div className="divide-y divide-slate-200 px-2 text-sm dark:divide-slate-700">
                                  {group.rows.map((row) => (
                                    <div
                                      key={`${group.key}-${row.index}-${row.serviceName}`}
                                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-1.5"
                                    >
                                      <div className="min-w-0">
                                        <div className="font-medium">
                                          {row.serviceName}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          {row.hasQuantity
                                            ? `${row.quantity} ${row.unitLabel}`
                                            : "Menge prüfen"}
                                          {" · "}
                                          {row.hasPrice
                                            ? formatCurrency(
                                                row.unitPrice,
                                                currency,
                                              )
                                            : "Preis prüfen"}
                                        </div>
                                      </div>
                                      <div className="text-right font-mono text-sm font-medium">
                                        {formatCurrency(row.sum, currency)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })
                        )}
                        <div className="flex justify-between rounded-md border border-slate-300 bg-muted/70 px-3 py-2 text-sm font-semibold dark:border-slate-700">
                          <span>Gesamt netto</span>
                          <span className="font-mono text-primary">
                            {formatCurrency(itemsTotal, currency)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border-2 border-slate-300 overflow-x-auto dark:border-slate-700">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/60">
                            <tr className="text-left">
                              <th className="px-2 py-2 font-medium w-10">
                                Nr.
                              </th>
                              <th className="px-2 py-2 font-medium">
                                Leistung
                              </th>
                              <th className="px-2 py-2 font-medium">Einheit</th>
                              <th className="px-2 py-2 font-medium text-right">
                                Menge
                              </th>
                              <th className="px-2 py-2 font-medium text-right">
                                Einzelpreis
                              </th>
                              <th className="px-2 py-2 font-medium text-right">
                                Summe
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {liveOverviewRows.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={6}
                                  className="px-2 py-4 text-center text-muted-foreground"
                                >
                                  Keine Leistung erfasst.
                                </td>
                              </tr>
                            ) : (
                              liveOverviewRows.map((row) => (
                                <tr
                                  key={`${row.index}-${row.serviceName}`}
                                  className="border-t"
                                >
                                  <td className="px-2 py-2">{row.index}</td>
                                  <td className="px-2 py-2 font-medium">
                                    {row.serviceName}
                                  </td>
                                  <td className="px-2 py-2">{row.unitLabel}</td>
                                  <td className="px-2 py-2 text-right">
                                    {row.hasQuantity
                                      ? row.quantity
                                      : "Menge prüfen"}
                                  </td>
                                  <td className="px-2 py-2 text-right">
                                    {row.hasPrice ? (
                                      formatCurrency(row.unitPrice, currency)
                                    ) : (
                                      <span className="text-red-700 font-medium">
                                        Preis prüfen
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-2 py-2 text-right font-medium">
                                    {formatCurrency(row.sum, currency)}
                                  </td>
                                </tr>
                              ))
                            )}
                            <tr className="border-t-2 bg-muted/40 font-semibold">
                              <td className="px-2 py-2" colSpan={5}>
                                Gesamt
                              </td>
                              <td className="px-2 py-2 text-right text-primary">
                                {formatCurrency(itemsTotal, currency)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Kundennachrichten — offen bei Einzelauftrag, kompakt bei Zusammenführung */}
                  <div className="space-y-2 mb-20 md:mb-0">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="font-semibold">Kundennachrichten</Label>
                      {shouldCollapseCustomerMessages && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            setCustomerMessagesExpanded((prev) => !prev)
                          }
                        >
                          {customerMessagesExpanded
                            ? "Nachrichten einklappen"
                            : "Nachrichten anzeigen"}
                        </Button>
                      )}
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                      {!customerMessagesVisible ? (
                        <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                          <span>
                            {visibleCustomerMessageText
                              ? `${visibleCustomerMessageText.length.toLocaleString("de-CH")} Zeichen Kundentext vorhanden`
                              : currentEditOrder?.audioTranscript
                                ? "Transkription vorhanden"
                                : currentEditOrder?.mediaUrl
                                  ? "Mediendatei vorhanden"
                                  : "Keine Kundennachricht gespeichert"}
                          </span>
                          <span>Zusammenführung: bei Bedarf Original öffnen und prüfen.</span>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {currentEditOrder?.mediaUrl &&
                            currentEditOrder.mediaType === "audio" && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openMedia(currentEditOrder)}
                              >
                                <Volume2 className="w-4 h-4 mr-1" />
                                Sprachnachricht abspielen
                              </Button>
                            )}

                          {customerMessageImagePreviewUrls.length > 0 &&
                            currentEditOrder && (
                              <div className="rounded-lg border bg-background p-2">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-medium">
                                      Bildvorschau
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {customerMessageImagePreviewUrls.length} Bild{customerMessageImagePreviewUrls.length === 1 ? "" : "er"} · Miniatur anklicken
                                    </div>
                                  </div>
                                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {customerMessageImagePreviewUrls.map((url, index) => (
                                    <button
                                      key={`${url}-${index}`}
                                      type="button"
                                      className="group flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted hover:ring-2 hover:ring-primary"
                                      onClick={() => {
                                        setGalleryUrls(customerMessageImagePreviewUrls);
                                        setGalleryIdx(index);
                                        setMediaType("image");
                                        setMediaUrl(null);
                                        setMediaDialogOpen(true);
                                      }}
                                    >
                                      <img
                                        src={url}
                                        alt={`Kundenbild ${index + 1}`}
                                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                      />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                          {currentEditOrder?.audioTranscript && (
                            <div className="rounded-md border bg-background p-2">
                              <div className="text-xs font-medium text-muted-foreground mb-1">
                                Transkription
                              </div>
                              <div className="whitespace-pre-wrap">
                                {currentEditOrder.audioTranscript}
                              </div>
                            </div>
                          )}

                          {visibleCustomerMessageText ? (
                            <div className="max-h-[420px] overflow-auto rounded-md border bg-background p-2 whitespace-pre-wrap">
                              {visibleCustomerMessageText}
                            </div>
                          ) : !currentEditOrder?.audioTranscript &&
                            !currentEditOrder?.mediaUrl &&
                            customerMessageImagePreviewUrls.length === 0 ? (
                            <div className="rounded-md border bg-background p-2 whitespace-pre-wrap">
                              Keine Kundennachricht gespeichert.
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>

                </>
              )}
            </div>
            {/* Duplicate Check Panel (right column) */}
            {dupCheckOpen &&
              form.customerId &&
              (() => {
                const cust = customers.find(
                  (c: Customer) => c.id === form.customerId,
                );
                if (!cust) return null;
                return (
                  <DuplicateCheckPanel
                    customer={{
                      id: cust.id,
                      customerNumber: cust.customerNumber,
                      name: cust.name,
                      address: cust.address,
                      plz: cust.plz,
                      city: cust.city,
                      phone: cust.phone,
                      email: cust.email,
                      country: cust.country,
                    }}
                    onClose={() => setDupCheckOpen(false)}
                    activeFormName={newCust.name}
                    activeFormAddress={newCust.address}
                    activeFormCity={newCust.city}
                    activeFormPlz={newCust.plz}
                    onApplyPlzSuggestion={(plz) =>
                      setNewCust((p: any) => ({ ...p, plz: plz ?? "" }))
                    }
                    onTakeoverCustomer={async (match: DuplicateMatch) => {
                      // "Diesen Kunden übernehmen" — full customer replacement:
                      // 1. Persist customerId change on the order via API
                      // 2. Update local form + customer display
                      // 3. Cleanup: soft-delete old customer if it has no more active docs
                      // 4. Show toast + close panel
                      if (!editId) return;
                      const oldCustomerId = form.customerId; // capture before overwrite
                      const res = await fetch(`/api/orders/${editId}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ customerId: match.id }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        toast.error(err?.error || "Fehler beim Kunden-Wechsel");
                        return;
                      }
                      // Update local form state
                      setForm((f: any) => ({ ...f, customerId: match.id }));
                      // Update newCust with the selected customer's full data
                      setNewCust({
                        name: (match.name ?? "") as string,
                        address: (match.address ?? "") as string,
                        plz: (match.plz ?? "") as string,
                        city: (match.city ?? "") as string,
                        phone: (match.phone ?? "") as string,
                        email: (match.email ?? "") as string,
                        country: "CH",
                      });
                      // Ensure selected customer exists in local customers list
                      setCustomers((prev: Customer[]) => {
                        const exists = prev.some((c) => c.id === match.id);
                        if (exists) return prev;
                        return [
                          ...prev,
                          {
                            id: match.id,
                            name: match.name,
                            customerNumber: match.customerNumber ?? null,
                            address: match.address ?? null,
                            plz: match.plz ?? null,
                            city: match.city ?? null,
                            phone: match.phone ?? null,
                            email: match.email ?? null,
                          } as Customer,
                        ];
                      });
                      // Update nested customer in orders list
                      setOrders((prev: Order[]) =>
                        prev.map((o) =>
                          o.id === editId
                            ? {
                                ...o,
                                customerId: match.id,
                                customer: {
                                  name: match.name,
                                  customerNumber: match.customerNumber,
                                  address: match.address,
                                  plz: match.plz,
                                  city: match.city,
                                  phone: match.phone,
                                  email: match.email,
                                },
                              }
                            : o,
                        ),
                      );
                      // Close customer editor + dup panel
                      setShowNewCustomer(false);
                      setEditingCustomer(false);
                      setDupCheckOpen(false);
                      toast.success(
                        `Kunde übernommen: ${match.customerNumber ? match.customerNumber + " · " : ""}${match.name}`,
                      );
                      // Fire-and-forget: cleanup old customer if it has no remaining active docs
                      if (oldCustomerId && oldCustomerId !== match.id) {
                        fetch(
                          `/api/customers/${oldCustomerId}/cleanup-after-takeover`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ keptCustomerId: match.id }),
                          },
                        )
                          .then((r) => r.json())
                          .then((res) => {
                            if (res?.cleaned) {
                              setCustomers((prev: Customer[]) =>
                                prev.filter((c) => c.id !== oldCustomerId),
                              );
                            }
                          })
                          .catch(() => {
                            /* silent — non-critical */
                          });
                      }
                    }}
                    onMergeComplete={async (r) => {
                      // After merge the backend may have kept the OTHER record
                      // (lower customerNumber wins). Rebind form.customerId to the
                      // surviving record BEFORE reloading the list so the edit
                      // dialog keeps showing a valid customer.
                      setForm((f: any) => ({
                        ...f,
                        customerId: r.survivingCustomerId,
                      }));
                      // Stage F – Critical bug fix:
                      // The merge persists user-selected values to the surviving
                      // record. We MUST replace local `newCust` form state with
                      // those values, otherwise the visible "Kunde bearbeiten"
                      // form keeps showing stale pre-merge values and a
                      // subsequent "Kunde aktualisieren" wipes the merge.
                      if (r.mergedCustomer) {
                        const m = r.mergedCustomer;
                        setNewCust({
                          name: (m.name ?? "") as string,
                          phone: (m.phone ?? "") as string,
                          email: (m.email ?? "") as string,
                          address: (m.address ?? "") as string,
                          plz: (m.plz ?? "") as string,
                          city: (m.city ?? "") as string,
                          country: (m.country ?? "CH") as string,
                        });
                        // Reflect in customers list so dbCust diff in saveCustomer
                        // matches the new state and fieldsToClear stays empty.
                        setCustomers((prev) => {
                          const exists = prev.some(
                            (c: Customer) => c.id === m.id,
                          );
                          const merged = { ...m } as any;
                          if (exists)
                            return prev.map((c: Customer) =>
                              c.id === m.id ? { ...c, ...merged } : c,
                            );
                          return [...prev, merged as Customer];
                        });
                        // Reflect in nested customer in orders list
                        setOrders((prev) =>
                          prev.map((o: any) =>
                            o.customerId === m.id
                              ? { ...o, customer: { ...o.customer, ...m } }
                              : o,
                          ),
                        );
                        // Keep customer editor open so user can verify values.
                        setEditingCustomer(true);
                        setShowNewCustomer(true);
                      }
                      // Background reload to refresh aggregations / nested data.
                      await load();
                    }}
                  />
                );
              })()}
          </div>
          {/* Mobile hotfix: the old sticky "Weiter zu Angebot" bottom-bar
              inside this edit dialog was removed. The dialog already has
              the regular action buttons ("Angebot erstellen", "Rechnung erstellen",
              "Speichern", "Speichern & schließen"). Navigation between main lists now happens via
              the small mobile-only shortcut rendered at the END of the
              list page (see <MobileListShortcut /> below). */}
        </DialogContent>
      </Dialog>

      {/* Catalog decision dialog */}
      <Dialog
        open={!!catalogDecision}
        onOpenChange={(open) => {
          if (!open && !catalogDecisionSaving) setCatalogDecision(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Leistung im Katalog vorhanden</DialogTitle>
          </DialogHeader>
          {catalogDecision && (
            <div className="space-y-4">
              <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-950">
                <div className="font-semibold">
                  {catalogDecision.existing.name} existiert bereits im
                  Leistungskatalog.
                </div>
                <div className="mt-1">
                  Wähle bewusst, ob nur dieser Auftrag geprüft werden soll oder
                  ob der Standardpreis im Katalog global geändert wird.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-muted-foreground font-medium">
                    Katalog aktuell
                  </div>
                  <div className="mt-1 font-semibold">
                    {catalogDecision.existing.unit}
                  </div>
                  <div className="font-mono text-lg font-bold">
                    {formatCurrency(
                      Number(catalogDecision.existing.defaultPrice || 0),
                      currency,
                    )}
                  </div>
                </div>

                <div className="rounded-lg border bg-background p-3">
                  <div className="text-muted-foreground font-medium">
                    Dieser Auftrag
                  </div>
                  <div className="mt-1 font-semibold">
                    {catalogDecision.unit}
                  </div>
                  <div className="font-mono text-lg font-bold">
                    {formatCurrency(catalogDecision.price, currency)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  type="button"
                  className="w-full"
                  disabled={catalogDecisionSaving}
                  onClick={resolveCatalogDecisionForCurrentOrder}
                >
                  Nur diesen Auftrag als geprüft übernehmen
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={catalogDecisionSaving}
                  onClick={updateCatalogPriceFromDecision}
                >
                  {catalogDecisionSaving ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Aktualisiere ...
                    </span>
                  ) : (
                    "Katalogpreis global aktualisieren"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={catalogDecisionSaving}
                  onClick={() => setCatalogDecision(null)}
                >
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Media Playback Dialog */}
      {/* Audio dialog */}
      <Dialog
        open={mediaDialogOpen && mediaType === "audio"}
        onOpenChange={setMediaDialogOpen}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sprachnachricht</DialogTitle>
          </DialogHeader>
          {mediaUrl && (
            <audio controls className="w-full" src={mediaUrl}>
              <track kind="captions" />
            </audio>
          )}
        </DialogContent>
      </Dialog>
      {/* Image viewer with touch zoom/pan */}
      <TouchImageViewer
        open={mediaDialogOpen && mediaType === "image"}
        onOpenChange={setMediaDialogOpen}
        urls={galleryUrls}
        initialIndex={galleryIdx}
      />

      {/* Archive confirmation dialog */}
      <Dialog
        open={!!archiveId}
        onOpenChange={(open) => {
          if (!open) setArchiveId(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>In Papierkorb verschieben?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Der Auftrag wird in den Papierkorb verschoben und kann dort
            wiederhergestellt werden. Wenn der Auftrag nur an einem leeren
            Dummy-Kunden hängt, wird dieser automatisch mit entfernt.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchiveId(null)}
            >
              Abbrechen
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmArchive}>
              In Papierkorb
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
