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
  X,
  Mail,
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
import { buildSpecialNotes, splitSpecialNotes } from "@/lib/special-notes-utils";
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

interface OrderItem {
  id?: string;
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
}

const createEmptyItem = (): FormItem => ({
  key: Math.random().toString(36).slice(2),
  serviceName: "",
  unit: "Stunde",
  unitPrice: "",
  quantity: "",
});

const AI_WARNING_PREFIX = "[AI_WARNING]";

const getAiWarningFromItemDescription = (description?: string | null) => {
  if (!description) return "";
  return description.startsWith(AI_WARNING_PREFIX)
    ? description.replace(AI_WARNING_PREFIX, "").trim()
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
  return item.aiWarning?.trim()
    ? `${AI_WARNING_PREFIX} ${item.aiWarning.trim()}`
    : item.serviceName;
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

const findCustomerTextLineForService = (
  sourceText?: string | null,
  serviceName?: string | null,
) => {
  const source = String(sourceText || "").trim();
  const serviceKey = normalizeForMatch(serviceName);
  if (!source || !serviceKey) return "";

  const serviceTokens = serviceKey
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  const lines = source
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const matchingLine = lines.find((line) => {
    const lineKey = normalizeForMatch(line);
    if (!lineKey) return false;
    if (lineKey.includes(serviceKey)) return true;
    return serviceTokens.length > 0 && serviceTokens.some((token) => lineKey.includes(token));
  });

  return matchingLine || "";
};

const canonicalServiceNameForOrderItem = (value?: string | null) => {
  const name = compactText(value);
  const key = normalizeForMatch(name);

  // Keep travel costs consistent when orders are merged or saved.
  // The service catalog uses "Anfahrt" as service name; "pauschal" is the unit,
  // not part of the service name.
  if (key === "anfahrt" || key === "anfahrt pauschal") {
    return "Anfahrt";
  }

  return name;
};

const formatMergedNumberString = (value: number) => {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
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
    const mergeKey = [
      normalizeForMatch(serviceName),
      unitKey,
      unitPriceKey,
      warningKey,
    ].join("|");

    const existingIndex = indexByKey.get(mergeKey);
    const quantityNumber = Number(normalizedItem.quantity || 0);

    if (existingIndex !== undefined && Number.isFinite(quantityNumber)) {
      const existing = merged[existingIndex];
      const existingQuantity = Number(existing.quantity || 0);
      if (Number.isFinite(existingQuantity)) {
        existing.quantity = formatMergedNumberString(existingQuantity + quantityNumber);
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
    })),
  ).map((item) => ({
    serviceName: item.serviceName,
    description: buildItemDescription(item),
    quantity: Number(item.quantity || 0),
    unit: item.unit,
    unitPrice: Number(item.unitPrice || 0),
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

  if (/oel|öl|rutsch|strom|kabel|gas|rauch|scherb|asbest|schimmel|chem|feuer|brand|sturz|absturz/.test(text)) {
    return "warning";
  }

  if (/hund/.test(text)) return "dog";
  if (/leiter/.test(text)) return "ladder";
  if (/park|zufahrt|innenhof|reserviert/.test(text)) return "parking";
  if (/schluessel|schlussel|schlüssel/.test(text)) return "key";
  if (/zugang|eingang|tor|lift|seiteneingang|hintereingang/.test(text)) return "access";
  if (/termin|datum|uhr|morgen|vormittag|nachmittag/.test(text)) return "appointment";
  if (/schubkarre/.test(text)) return "wheelbarrow";
  if (/absperrband/.test(text)) return "barrier_tape";
  if (/geruest|gerüst/.test(text)) return "scaffold";
  if (/hanglage|hang|steigung/.test(text)) return "slope";

  return null;
};

const isNonActionableSemanticHint = (value?: string | null, context?: string | null) => {
  const text = normalizeForMatch(value);
  const contextText = normalizeForMatch(context);
  if (!text) return true;

  // Negative access/parking information is actionable: no parking / no lift
  // must still create an orange chip. Other negated hints stay inside only.
  if (/kein parkplatz|keine parkplaetze|keine parkplätze|kein parken|parkverbot|kein lift|ohne lift/.test(text)) {
    return false;
  }

  const hasRealAccessConstraint =
    /seiteneingang|hintereingang|nebeneingang|rampe|schmal|enger?\s+zugang|schwieriger\s+zugang|kein lift|ohne lift|back entrance|side entrance|rear entrance|access difficult|difficult access|acces difficile/.test(text);

  const isOnlyNormalDoorInstruction =
    /klingeln|warten|haustuer|haustür|haupteingang|eingangstuer|eingangstür|kunde ist vor ort|kundin ist vor ort|oeffnet die tuer|öffnet die tür|sonner|attendre|ouvre la porte|main entrance|ring the bell|doorbell/.test(text) &&
    !hasRealAccessConstraint;

  return (
    /kein|keine|keinen|nicht benoetigt|nicht benötigt|muss nicht|kein thema|ohne/.test(text) ||
    /termin flexibel|kein fester termin|kein terminwunsch|irgendwann/.test(text) ||
    /leiter eventuell|eventuell leiter|vielleicht leiter|leiter vielleicht/.test(text) ||
    /zugang.*(frei|offen|unproblematisch)|tuer.*offen|tür.*offen|kunde ist vor ort|kundin ist vor ort/.test(text) ||
    isOnlyNormalDoorInstruction ||
    /parkplatz.*(kein thema|nicht wichtig)|direkt halten|genug platz/.test(text) ||
    (
      /parkplatz.*(vorhanden|reserviert|frei|innenhof|vor ort)|parkplatz/.test(text) &&
      /parkplatz.*kein thema|direkt halten|genug platz|parkplatz.*nicht wichtig/.test(contextText)
    )
  );
};

const isPositiveSemanticHint = (value?: string | null) => {
  const text = normalizeForMatch(value);
  if (!text) return false;

  return /parkplatz.*(reserviert|innenhof|vorhanden)|parkplatz im innenhof|parkplatz vor ort|parken moeglich|parken möglich|parking available/.test(text);
};

const PARKING_NO_PATTERN =
  /kein parkplatz|keine parkplaetze|keine parkplätze|kein parken|parkverbot|kein stellplatz|keine stellplaetze|keine stellplätze|no parking|sans parking|sin parking/;

const PARKING_DIFFICULT_PATTERN =
  /parkplatz schwierig|parken schwierig|parkieren schwierig|nur kurz(?:zeitig)? halten|kurzhalten|an der strasse|an der straße|strasse abgestellt|straße abgestellt|fahrzeug muss .*strasse|fahrzeug muss .*straße|ausladen.*strasse|ausladen.*straße/;

const hasParkingReference = (value?: string | null) =>
  /park|parking|parkplatz|parken|zufahrt|innenhof/.test(normalizeForMatch(value));

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

const getParkingBadge = (value?: string | null, context?: string | null): { label: string; className: string } | null => {
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
      className: "bg-emerald-100 text-emerald-700 border border-emerald-200",
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
  if (/bg-orange-|text-orange-|border-orange-|bg-amber-|text-amber-|border-amber-|bg-yellow-|text-yellow-|border-yellow-/.test(className)) return 1;
  if (/bg-emerald-|text-emerald-|border-emerald-|bg-green-|text-green-|border-green-/.test(className)) return 2;
  return 3;
};

const sortReviewBadges = (badges: ReviewBadge[]) =>
  badges
    .map((badge, index) => ({ badge, index }))
    .sort((a, b) => badgeSortRank(a.badge) - badgeSortRank(b.badge) || a.index - b.index)
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

const splitAppointmentSources = (...values: Array<string | null | undefined>) => {
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
  const normalClass = "bg-violet-100 text-violet-700 border border-violet-200";
  const tomorrowClass = "bg-violet-200 text-violet-800 border border-violet-300";
  const todayClass = "bg-orange-100 text-orange-800 border border-orange-300";
  const overdueClass = "bg-orange-100 text-orange-800 border border-orange-300";
  const doneClass = "bg-slate-100 text-slate-600 border border-slate-200";

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
  if (!text || isNonActionableSemanticHint(raw) || isNonActionableAppointmentHint(raw)) {
    return null;
  }

  const weekdayMap: Array<[RegExp, number]> = [
    [/\b(montag|monday|lundi|lunes|lunedi)(?:morgen|vormittag|nachmittag|abend)?\b/i, 1],
    [/\b(dienstag|tuesday|mardi|martes|martedi)(?:morgen|vormittag|nachmittag|abend)?\b/i, 2],
    [/\b(mittwoch|wednesday|mercredi|miercoles|mercoledi)(?:morgen|vormittag|nachmittag|abend)?\b/i, 3],
    [/\b(donnerstag|thursday|jeudi|jueves|giovedi)(?:morgen|vormittag|nachmittag|abend)?\b/i, 4],
    [/\b(freitag|friday|vendredi|viernes|venerdi)(?:morgen|vormittag|nachmittag|abend)?\b/i, 5],
    [/\b(samstag|saturday|samedi|sabado|sabato)(?:morgen|vormittag|nachmittag|abend)?\b/i, 6],
    [/\b(sonntag|sunday|dimanche|domingo|domenica)(?:morgen|vormittag|nachmittag|abend)?\b/i, 7],
  ];

  const weekdayIndex = weekdayMap.find(([pattern]) => pattern.test(text))?.[1] || null;
  const hasNextWeek = /\b(naechste woche|nächste woche|next week|semaine prochaine|proxima semana|settimana prossima)\b/i.test(text);
  const hasToday = /\b(heute|today|aujourd'hui|hoy|oggi)\b/i.test(text);
  const hasTomorrow = /\b(morgen|tomorrow|demain|mañana|manana|domani)\b/i.test(text) && !weekdayIndex;

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
  const time = timeMatch ? formatAppointmentTime(timeMatch[1], timeMatch[2]) : "";

  const dateMatch = raw.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  const baseDate = parseAppointmentBaseDate(baseDateInput);
  const explicitDateObject = dateMatch
    ? new Date(
        dateMatch[3]
          ? Number(dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3])
          : baseDate.getFullYear(),
        Number(dateMatch[2]) - 1,
        Number(dateMatch[1]),
      )
    : null;

  const computedAppointmentDate = explicitDateObject
    || (hasToday ? baseDate : null)
    || (hasTomorrow ? addDays(baseDate, 1) : null)
    || (!dateMatch && weekdayIndex
      ? resolveWeekdayAppointmentDate(weekdayIndex, baseDateInput, hasNextWeek)
      : null);

  const shouldShowGenericAppointmentOnly =
    computedAppointmentDate &&
    !hasNextWeek &&
    !hasToday &&
    !hasTomorrow &&
    !explicitDateObject &&
    isAmbiguousElapsedSameDayAppointment(computedAppointmentDate, baseDateInput, time, dayPart);

  if (shouldShowGenericAppointmentOnly) {
    return {
      label: "Termin",
      className: "bg-violet-100 text-violet-700 border border-violet-200",
    };
  }

  const date = computedAppointmentDate ? formatAppointmentDate(computedAppointmentDate) : "";

  // Only show an outside appointment chip when there is a concrete day/date,
  // a relative date such as heute/morgen, or a concrete time.
  if (!date && !time) return null;

  const appointmentMoment = computedAppointmentDate
    ? buildAppointmentMoment(computedAppointmentDate, time, dayPart)
    : null;
  const parts = [date, time || dayPart].filter(Boolean);

  return getAppointmentBadgeVisual(appointmentMoment, parts, orderStatus);
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

  const redWarningClass = "bg-red-100 text-red-700 border border-red-200";
  const amberHintClass = "bg-amber-100 text-amber-700 border border-amber-200";
  const greenInfoClass = "bg-emerald-100 text-emerald-700 border border-emerald-200";

  const addDanger = (key: string, label: string) =>
    pushUniqueBadge(badges, {
      key,
      label,
      className: redWarningClass,
      icon: true,
    });

  const addHint = (key: string, label: string, className = amberHintClass) =>
    pushUniqueBadge(badges, {
      key,
      label,
      className,
    });

  parsedNotes.safetyWarnings.forEach((line) => {
    const label = dangerBadgeLabel(line);
    addDanger(`danger_${normalizeForMatch(label)}`, label);
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
      addHint(`hint_parking_${normalizeForMatch(parkingBadge.label)}`, parkingBadge.label, parkingBadge.className);
      return;
    }

    const label = badgeLabelByKind[kind];
    if (!label) return;

    // If a safety warning already created a red danger chip, do not add the
    // same semantic hint again in yellow. Example: "Achtung Hund" must show
    // one Hund chip, not red Hund + yellow Hund.
    if (badges.some((badge) => normalizeForMatch(badge.label) === normalizeForMatch(label))) {
      return;
    }

    addHint(
      `hint_${kind}`,
      label,
      isPositiveSemanticHint(line) ? greenInfoClass : amberHintClass,
    );
  });

  if (parkingConflictBadge) {
    addHint("hint_parking_review", parkingConflictBadge.label, parkingConflictBadge.className);
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
        normalizeForMatch(canonicalServiceNameForOrderItem(service.name)) === key,
    ) || null
  );
};

const normalizePriceUnitForCompare = (value?: string | null) => {
  const unit = normalizeForMatch(value);
  if (!unit) return "";
  if (["stueck", "stück", "stk", "piece", "pieces"].includes(unit)) return "piece";
  if (["quadratmeter", "qm", "m2", "m²", "sqm"].includes(unit)) return "square_meter";
  if (["kubikmeter", "cbm", "m3", "m³"].includes(unit)) return "cubic_meter";
  if (["stunde", "stunden", "std", "h", "hour", "hours"].includes(unit)) return "hour";
  if (["tag", "tage", "day", "days"].includes(unit)) return "day";
  if (["meter", "laufmeter", "lfm", "m"].includes(unit)) return "meter";
  if (["kilogramm", "kg"].includes(unit)) return "kilogram";
  if (["tonne", "tonnen"].includes(unit)) return "ton";
  if (["liter", "ltr", "l"].includes(unit)) return "liter";
  if (["pauschal", "pauschale", "fixpreis", "festpreis", "flat"].includes(unit)) return "flat";
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
  item: Pick<OrderItem, "serviceName" | "unit" | "unitPrice">,
  services: ServiceDef[],
  reviewReasons?: string[] | null,
) => {
  if (!item?.serviceName?.trim()) return false;
  if (hasUnitMismatchReviewForService(reviewReasons, item.serviceName)) return false;

  const catalog = findCatalogServiceForName(services, item.serviceName);
  if (!catalog) return false;

  const catalogUnit = normalizePriceUnitForCompare(catalog.unit);
  const itemUnit = normalizePriceUnitForCompare(item.unit);
  if (catalogUnit && itemUnit && catalogUnit !== itemUnit) return false;

  const catalogPrice = Number(catalog.defaultPrice || 0);
  const itemPrice = Number(item.unitPrice || 0);
  if (!Number.isFinite(catalogPrice) || !Number.isFinite(itemPrice)) return false;
  if (catalogPrice <= 0 || itemPrice <= 0) return false;

  return Math.abs(catalogPrice - itemPrice) >= 0.01;
};

const getCatalogPriceDeviationItems = (
  order: Order,
  services: ServiceDef[],
) => {
  const items = order.items && order.items.length > 0
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

const buildAmountReviewBadges = (badges: ReviewBadge[]): ReviewBadge[] => {
  const currencyBadges = badges.filter((badge) => badge.key === "currency_review");
  const priceBadges = badges.filter((badge) =>
    PRICE_AMOUNT_REVIEW_BADGE_KEYS.has(badge.key),
  );

  if (priceBadges.length > 1 || (currencyBadges.length > 0 && priceBadges.length > 0)) {
    return [
      ...currencyBadges,
      {
        key: "price_inputs_review",
        label: "Preisangaben prüfen",
        className: "bg-red-100 text-red-700 border border-red-200",
        icon: true,
      },
    ];
  }

  return [...currencyBadges, ...priceBadges];
};

const getSystemBadges = (order: Order, services: ServiceDef[] = []): ReviewBadge[] => {
  const badges: ReviewBadge[] = [];

  if (order.siteAddressDifferent) {
    pushUniqueBadge(badges, {
      key: "site_address",
      label: "Ausführungsadresse",
      className: "bg-cyan-100 text-cyan-700 border border-cyan-200",
    });
  }

  const hasPriceQuantityReview =
    order.items && order.items.length > 0
      ? order.items.some(
          (it) =>
            Number(it.unitPrice || 0) <= 0 ||
            Number(it.quantity || 0) <= 0,
        )
      : Number(order.unitPrice || 0) <= 0 || Number(order.quantity || 0) <= 0;

  const hasPriceReferenceReview =
    order.reviewReasons?.some(
      (reason) =>
        reason === "unit_price_review" ||
        reason === "quantity_review" ||
        reason.startsWith("price_unclear:"),
    ) ?? false;

  if (hasPriceQuantityReview || hasPriceReferenceReview) {
    pushUniqueBadge(badges, {
      key: "price_quantity",
      label: "Betrag prüfen",
      className: "bg-red-100 text-red-700 border border-red-200",
      icon: true,
    });
  }

  const hasUnitConflict =
    order.reviewReasons?.some((r) => r.startsWith("unit_mismatch:")) ?? false;

  if (hasUnitConflict) {
    pushUniqueBadge(badges, {
      key: "unit_conflict",
      label: "Einheit prüfen",
      className: "bg-red-100 text-red-700 border border-red-200",
    });
  }

  const hasCurrencyReview =
    order.reviewReasons?.some((reason) => reason.startsWith("currency_")) ?? false;

  if (hasCurrencyReview) {
    pushUniqueBadge(badges, {
      key: "currency_review",
      label: "Währung prüfen",
      className: "bg-red-100 text-red-700 border border-red-200",
      icon: true,
    });
  }

  const hasPriceDeviationReview =
    (order.reviewReasons?.some((reason) => reason.startsWith("price_override:")) ?? false) ||
    getCatalogPriceDeviationItems(order, services).length > 0;

  if (hasPriceDeviationReview) {
    pushUniqueBadge(badges, {
      key: "price_deviation",
      label: "Katalogpreis prüfen",
      className: "bg-red-100 text-red-700 border border-red-200",
      icon: true,
    });
  }

  const hasCustomerReview =
    hasRealCustomerReviewReason(order) ||
    isCustomerDataIncomplete(order.customer);

  if (hasCustomerReview) {
    pushUniqueBadge(badges, {
      key: "customer_review",
      label: "Kunde prüfen",
      className: "bg-yellow-100 text-yellow-700 border border-yellow-200",
    });
  }

  return badges;
};

const getBottomBadges = (
  order: Order,
  parsedNotes: ReturnType<typeof splitSpecialNotes>,
): ReviewBadge[] => {
  const badges: ReviewBadge[] = [];
  const blueClass = "bg-blue-100 text-blue-700 border border-blue-200";
  // RUECKRUF_VIA_COMMUNICATION_CHIPS_V8: callback is rendered once by CommunicationChips.

  const isMergedOrder =
    order.reviewReasons?.includes("manual_order_merge") ||
    order.reviewReasons?.includes("double_merge");

  if (isMergedOrder) {
    pushUniqueBadge(badges, {
      key: "merged",
      label: "Zusammengeführt",
      className: blueClass,
    });
  }

  const appointmentBaseDate = order.createdAt || order.date;
  const appointmentBadge = splitAppointmentSources(
    ...parsedNotes.jobHints,
    order.specialNotes,
    order.notes,
    order.audioTranscript,
  )
    .map((line) => extractAppointmentBadge(line, appointmentBaseDate, order.status))
    .find(Boolean);

  if (appointmentBadge) {
    pushUniqueBadge(badges, {
      key: "appointment",
      label: appointmentBadge.label,
      className: appointmentBadge.className,
      icon: appointmentBadge.icon,
    });
  }

  return badges;
};

const cleanServiceLabel = (value?: string | null) => {
  let text = compactText(value);
  if (!text) return "";

  text = text
    .replace(/^[-–—•\d.)\s]+/, "")
    .replace(/\s+[–—]\s+.*$/, "")
    .replace(/\s+-\s+.*$/, "")
    // Einheit-/Preiswörter gehören nicht in den sichtbaren Kartentitel.
    .replace(/\b(?:pauschal|pauschale|fixpreis|festpreis|forfait|flat)\b/gi, " ")
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
    .replace(/der kunde moechte|der kunde möchte|kunde moechte|kunde möchte/gi, "")
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

  const structuredLabels = itemLabels.length > 0 ? itemLabels : [order.serviceName || ""];
  const usableStructuredLabels = structuredLabels.filter(
    (label) => normalizeForMatch(label) !== "sonstiges",
  );

  const structuredSummary = formatServiceSummary(usableStructuredLabels);
  if (structuredSummary) return structuredSummary;

  const fallbackSummary = formatServiceSummary(extractFallbackServiceLabels(order));
  return fallbackSummary || "Leistung prüfen";
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
  /^price_override:/,
  /^unbekannte_leistung_pruefen$/,
  /^stunden_arbeitsposition_pruefen$/,
  /^total_unrealistic_check$/,
  /^currency_unsupported$/,
  /^manual_flat_service_from_text$/,
];

const getOrderConversionBlockers = (order: Order | any): string[] => {
  const blockers: string[] = [];
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
        Number(item?.totalPrice ?? Number(item?.unitPrice || 0) * Number(item?.quantity || 0)) <= 0,
    )
  ) {
    blockers.push("Preis/Menge prüfen");
  }

  if (
    reviewReasons.some((reason) =>
      CRITICAL_CONVERSION_REVIEW_PATTERNS.some((pattern) => pattern.test(reason)),
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

const blockConversionIfUnsafe = (order: Order | any, targetLabel: "Angebot" | "Rechnung") => {
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
      const canUseOrderNotesForCustomer =
        !hasMissingOrFallbackCustomerName(freshCust.name);
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
  const [customerMessageImagePreviewUrl, setCustomerMessageImagePreviewUrl] =
    useState<string | null>(null);

  // Dropdown menu for create offer/invoice
  const [dropdownOpenId, setDropdownOpenId] = useState<string | null>(null);
  const [serviceActionMenuKey, setServiceActionMenuKey] = useState<string | null>(null);

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
  const openEdit = (o: Order, opts?: { openCustomerSection?: boolean }) => {
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
    setSiteAddressEditing(Boolean(o.siteAddressDifferent) && ![o.siteName, o.siteAddress, o.sitePlz, o.siteCity, o.siteNote].some((value) => String(value || "").trim()));
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
              serviceName: item.serviceName ?? "",
              unit: item.unit ?? "Stunde",
              unitPrice:
                Number(item.unitPrice || 0) === 0 ? "" : String(item.unitPrice),
              quantity: hasQuantityReview
                ? ""
                : Number(item.quantity || 0) === 0
                  ? ""
                  : String(item.quantity),
              aiWarning: getAiWarningFromItemDescription(item.description),
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
            unitPrice: Number(o.unitPrice || 0) === 0 ? "" : String(o.unitPrice),
            quantity: Number(o.quantity || 0) === 0 ? "" : String(o.quantity),
            aiWarning: "",
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
            : currentOrder?.notes ?? null;
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
    if (!dialogOpen) setPendingOpenCustomerEditor(null);
  }, [dialogOpen]);

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
    setServices((prev) =>
      [...prev, newSvc as any].sort((a, b) =>
        (a?.name ?? "").localeCompare(b?.name ?? "", "de", {
          sensitivity: "base",
        }),
      ),
    );
  };

  const isServiceInCatalog = (name?: string | null) => {
    const key = normalizeForMatch(name);
    if (!key) return false;
    return services.some((service) => normalizeForMatch(service.name) === key);
  };

  const saveItemToServices = async (index: number) => {
    const item = formItems[index];
    if (!item?.serviceName?.trim()) return;

    const normalizedName = item.serviceName.trim().replace(/\s+/g, " ");
    const existing = services.find(
      (service) => normalizeForMatch(service.name) === normalizeForMatch(normalizedName),
    );

    if (existing) {
      toast.info(`Leistung "${existing.name}" existiert bereits`);
      onItemServiceSelect(index, existing.name, existing as ServiceOption);
      setServiceActionMenuKey(null);
      return;
    }

    const price = Number(item.unitPrice || 0);
    if (!price || price <= 0) {
      toast.error("Preis zuerst prüfen, dann in Leistungen übernehmen");
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

      const newService: ServiceOption = await res.json();
      handleServiceCreated(newService);
      onItemServiceSelect(index, newService.name, newService);
      setServiceActionMenuKey(null);
      toast.success("Leistung wurde in Leistungen übernommen ✓");
    } catch {
      toast.error("Leistung konnte nicht übernommen werden");
    }
  };

  const updateItem = (index: number, field: keyof FormItem, value: string) => {
    setFormItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const addItem = () => setFormItems((prev) => [...prev, createEmptyItem()]);

  const removeItem = (index: number) => {
    if (formItems.length <= 1) return; // keep at least one
    setFormItems((prev) => prev.filter((_, i) => i !== index));
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

  const currentEditReviewReasons = currentEditOrder?.reviewReasons ?? [];
  const hasEditCurrencyReview = currentEditReviewReasons.some(
    (reason: string) =>
      reason.startsWith("currency_") ||
      reason.startsWith("item_currency_mismatch"),
  );

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
        sum,
      };
    });

  const parsedFormSpecialNotes = splitSpecialNotes(form.specialNotes);
  const dangerNoteLines = parsedFormSpecialNotes.safetyWarnings;
  const normalSpecialNotesText = parsedFormSpecialNotes.jobHints.join("\n");

  const updateNormalSpecialNotes = (value: string) => {
    const nextJobHints = value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

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
        const transcript = normalizeCustomerMessageForCompare(currentEditOrder.audioTranscript);
        return Boolean(
          msg &&
            transcript &&
            (msg === transcript || msg.includes(transcript) || transcript.includes(msg)),
        );
      })(),
  );

  const visibleCustomerMessageText = customerMessageTranscriptDuplicate
    ? ""
    : customerMessageText;

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
  const saveOrder = async (payloadOverrides?: Partial<typeof form>): Promise<Order | null> => {
    if (!form.customerId) {
      toast.error("Bitte Kunde auswählen");
      return null;
    }
    const validItems = mergeEquivalentFormItems(
      formItems.filter((i) => i.serviceName.trim()),
    );
    if (validItems.length === 0) {
      toast.error("Mindestens eine Leistung auswählen");
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
    .filter((item) => Number(item.quantity || 0) > 0 && Number(item.unitPrice || 0) > 0)
    .map((item) => item.serviceName.trim().toLowerCase()),
);

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
        const reasonName = (reasonService || "").trim().toLowerCase();
        return !validServiceNames.has(reasonName);
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

      if (allServicesInCatalog && reason === "unbekannte_leistung_pruefen") {
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
  items: validItems.map((item) => ({
    serviceName: item.serviceName,
    description: buildItemDescription(item),
    quantity: Number(item.quantity || 0),
    unit: item.unit,
    unitPrice: Number(item.unitPrice || 0),
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

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveOrder();
      if (saved) {
        toast.success(editId ? "Auftrag aktualisiert" : "Auftrag erstellt");
        setDialogOpen(false);
        load();
      }
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  // Save + Create Offer → navigate to /angebote with edit modal open
  const saveAndCreateOffer = async () => {
    setSaving(true);
    try {
      const saved = await saveOrder({ status: "Erledigt" });
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
      const saved = await saveOrder({ status: "Erledigt" });
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
    ;
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
    const defaultMainOrder = orders.find(
      (o) => o.id === (defaultMainOrderId || selectedOrderIds[0]),
    );
    setSelectedCustomerId(
      (prev) => prev || defaultMainOrder?.customerId || null,
    );
    setMergeStep(2);
  };

  // Step 2 → Step 3
 

  // Step 3: Execute merge
  const executeMerge = async () => {
    if (merging) return; // GUARD
    if (!selectedMainOrderId) return;

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
          finalCustomerId: selectedCustomerId || undefined,
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
      setCustomerMessageImagePreviewUrl(null);
      return;
    }

    const firstImagePath =
      currentEditOrder.imageUrls?.[0] ||
      (currentEditOrder.mediaType === "image" ? currentEditOrder.mediaUrl : null);

    if (!firstImagePath) {
      setCustomerMessageImagePreviewUrl(null);
      return;
    }

    let cancelled = false;

    (async () => {
      const resolved = await resolveS3Url(firstImagePath);
      if (!cancelled) {
        setCustomerMessageImagePreviewUrl(resolved);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dialogOpen, currentEditOrder?.id]);

  const markOrderDoneForConversion = async (order: Order): Promise<Order | null> => {
    if (order.status === "Erledigt") return order;

    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Erledigt" }),
      });

      if (!res.ok) {
        toast.error("Status konnte nicht automatisch aktualisiert werden");
        return null;
      }

      const updated = await res.json().catch(() => null);
      const doneOrder = { ...order, ...(updated || {}), status: "Erledigt" } as Order;

      setOrders((prev) =>
        prev.map((x) =>
          x.id === order.id ? { ...x, ...doneOrder, status: "Erledigt" } : x,
        ),
      );

      return doneOrder;
    } catch {
      toast.error("Status konnte nicht automatisch aktualisiert werden");
      return null;
    }
  };

  const createOffer = async (o: Order) => {
    if (blockConversionIfUnsafe(o, "Angebot")) {
      openEdit(o);
      return;
    }
    const sourceOrder = await markOrderDoneForConversion(o);
    if (!sourceOrder) return;

    // Direct API create — no extra dialog
    const orderItems = mergeEquivalentOrderItems(
      sourceOrder.items && sourceOrder.items.length > 0
        ? sourceOrder.items
        : [
            {
              serviceName: sourceOrder.serviceName ?? "",
              description: sourceOrder.serviceName ?? sourceOrder.description ?? "",
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
    const fwdVatRate = sourceOrder.vatRate != null ? Number(sourceOrder.vatRate) : defaultVatRate;
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
          prev.map((x) => (x.id === sourceOrder.id ? { ...x, offerId: offer.id, status: "Erledigt" } : x)),
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
    const sourceOrder = await markOrderDoneForConversion(o);
    if (!sourceOrder) return;

    // Direct API create — no extra dialog
    const orderItems = mergeEquivalentOrderItems(
      sourceOrder.items && sourceOrder.items.length > 0
        ? sourceOrder.items
        : [
            {
              serviceName: sourceOrder.serviceName ?? "",
              description: sourceOrder.serviceName ?? sourceOrder.description ?? "",
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
    const fwdVatRate = sourceOrder.vatRate != null ? Number(sourceOrder.vatRate) : defaultVatRate;
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
            x.id === sourceOrder.id ? { ...x, invoiceId: invoice.id, status: "Erledigt" } : x,
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
            const appointmentBadges = bottomBadges.filter(
              (badge) => badge.key === "appointment",
            );
            const footerBadges = bottomBadges.filter(
              (badge) => badge.key !== "appointment",
            );
            const rightSideBadges = [
              ...amountReviewBadges,
              ...appointmentBadges,
            ];
            const showAudioTooLongBadge = o.audioTranscriptionStatus?.startsWith(
              "skipped",
            );
            const showImageOnlyBadge = o.reviewReasons?.includes(
              "image_only_no_text",
            );
            const isSelected = selectedOrderIds.includes(o.id);
            return (
              <motion.div
                key={o.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.015 }}
              >
               <Card
                  className={`hover:shadow-sm transition-shadow cursor-pointer tap-safe max-w-full overflow-visible ${isMergeMode && isSelected ? "ring-2 ring-primary/40" : ""}`}
                  onClick={() => {
                    if (isMergeMode) {
                      handleToggleSelect(o.id);
                      return;
                    }
                    openEdit(o);
                  }}
                >
                  <CardContent className="px-2.5 py-2 sm:px-3 max-w-full overflow-visible">
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

                      {/* Center: Main info */}
                      <div className="flex-1 min-w-0 max-w-full overflow-hidden">
                        {/* Row 1: date + customer */}
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs min-w-0 max-w-full overflow-hidden">
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
                          <span className="text-muted-foreground shrink-0">·</span>
                          <span
                            className={`font-medium truncate min-w-0 max-w-[150px] sm:max-w-none ${isFallbackCustomerName(o.customer?.name) ? "text-amber-600 dark:text-amber-400 italic" : "text-foreground"}`}
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

                          {leftSystemBadges.map((badge) => (
                            <span
                              key={badge.key}
                              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${badge.className}`}
                            >
                              {badge.icon && (
                                <AlertTriangle className="w-3 h-3" />
                              )}
                              {badge.label}
                            </span>
                          ))}

                          {showAudioTooLongBadge && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 shrink-0">
                              ⚠️ Audio zu lang
                            </span>
                          )}

                          {showImageOnlyBadge && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 shrink-0">
                              ⚠️ Bild prüfen
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

                        {operationalBadges.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-1 max-w-full overflow-hidden">
                            {operationalBadges.map((badge) => (
                              <span
                                key={badge.key}
                                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${badge.className}`}
                              >
                                {badge.icon && (
                                  <AlertTriangle className="w-3 h-3" />
                                )}
                                {badge.label}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Row 3: [status] [media] ... [price] */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 max-w-full overflow-hidden">
                          <select
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] border rounded px-1.5 py-0.5 font-medium"
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

                          <CommunicationChips
                            data={{
                              ...o,
                              notes: [o.notes, o.specialNotes, o.audioTranscript]
                                .filter(Boolean)
                                .join("\n"),
                            }}
                            onAudioClick={() => openMedia(o)}
                            onImageClick={() => openMedia(o)}
                          />

                          {footerBadges.map((badge) => (
                            <span
                              key={badge.key}
                              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${badge.className}`}
                            >
                              {badge.icon && (
                                <AlertTriangle className="w-3 h-3" />
                              )}
                              {badge.label}
                            </span>
                          ))}

                          <div className="ml-auto flex max-w-[190px] shrink-0 flex-col items-end gap-1 sm:max-w-[260px]">
                            {rightSideBadges.length > 0 && (
                              <div className="flex flex-wrap justify-end gap-1">
                                {rightSideBadges.map((badge) => (
                                  <span
                                    key={badge.key}
                                    className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${badge.className}`}
                                  >
                                    {badge.icon && (
                                      <AlertTriangle className="w-3 h-3" />
                                    )}
                                    {badge.label}
                                  </span>
                                ))}
                              </div>
                            )}

                            <div className="whitespace-nowrap text-right">
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
        onSelectMainOrder={setSelectedMainOrderId}
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
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-y-0.5 mb-1">
                  <div>
                    <Label>Rechnungsadresse *</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Kunde, der die Rechnung bekommt und bezahlt.
                    </p>
                  </div>
                  {!showNewCustomer && form.customerId && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
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
                  )}
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
                              className="border rounded-lg p-2 sm:p-3 bg-muted/30 space-y-1.5 min-w-0 cursor-pointer hover:bg-muted/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                            >
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
                              <div className="mt-2 border rounded-lg p-2 sm:p-3 bg-muted/30 space-y-1.5 min-w-0">
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
                    className="border rounded-lg p-3 space-y-2 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800"
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
                          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 flex items-start justify-between gap-2">
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


              {/* Ausführungsadresse / Baustellenadresse */}
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
                      Nur aktivieren, wenn die Arbeit an einem anderen Ort ausgeführt wird.
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
                          <span className="text-muted-foreground">Strasse:</span>
                          <span className="truncate">{form.siteAddress?.trim() || "–"}</span>
                          <span className="text-muted-foreground">PLZ / Ort:</span>
                          <span className="truncate">
                            {[form.sitePlz, form.siteCity].filter(Boolean).join(" ") || "–"}
                          </span>
                          {form.siteNote?.trim() && (
                            <>
                              <span className="text-muted-foreground">Hinweis:</span>
                              <span className="truncate">{form.siteNote}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-primary">Bearbeiten</span>
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
                        Gilt nur für diesen Auftrag. Wird später in Angebot, Rechnung und PDF separat angezeigt.
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
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <Label className="text-base font-semibold">Leistungen *</Label>
                        <p className="text-xs text-muted-foreground">
                          Klein, kompakt: Leistung, Prüfung, Preis und Menge pro Position.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0"
                        onClick={addItem}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Leistung hinzufügen
                      </Button>
                    </div>

                    {hasEditCurrencyReview && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200">
                        <div className="font-semibold">⚠ Währung prüfen</div>
                        <div>
                          Im Kundentext wurden unterschiedliche Währungen erkannt. Erst bereinigen,
                          dann Angebot oder Rechnung erstellen.
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      {formItems.map((item, index) => {
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
                          ?.filter((r: string) => r.startsWith("price_override:"))
                          .find((r: string) => {
                            const [, serviceName] = r.split(":");
                            return (
                              normalizeForMatch(serviceName) ===
                              normalizeForMatch(item.serviceName)
                            );
                          });

                        const priceUnclearReason = curOrder?.reviewReasons
                          ?.filter((r: string) => r.startsWith("price_unclear:"))
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
                        const catalogPrice = Number(catalogService?.defaultPrice || 0);
                        const itemPriceNumber = Number(item.unitPrice || 0);
                        const hasFrontendCatalogPriceDeviation =
                          Boolean(catalogService) &&
                          !unitMismatchReason &&
                          normalizePriceUnitForCompare(catalogService?.unit) ===
                            normalizePriceUnitForCompare(item.unit) &&
                          Number.isFinite(catalogPrice) &&
                          Number.isFinite(itemPriceNumber) &&
                          catalogPrice > 0 &&
                          itemPriceNumber > 0 &&
                          Math.abs(catalogPrice - itemPriceNumber) >= 0.01;

                        const hasCurrencyConflict = currentEditReviewReasons.some(
                          (reason: string) =>
                            reason.startsWith("currency_") ||
                            reason.startsWith("item_currency_mismatch"),
                        );
                        const priceInputReview = Number(item.unitPrice || 0) === 0;
                        const quantityInputReview = Number(item.quantity || 0) === 0;
                        const showUnitConflict =
                          !hasCurrencyConflict &&
                          Boolean(item.aiWarning?.trim() || unitMismatchReason);
                        const showPriceOverride =
                          !hasCurrencyConflict &&
                          !showUnitConflict &&
                          Boolean(priceOverrideReason || hasFrontendCatalogPriceDeviation);
                        const showPriceReferenceReview =
                          !hasCurrencyConflict &&
                          !priceInputReview &&
                          Boolean(priceUnclearReason || curOrder?.reviewReasons?.includes("unit_price_review"));

                        const itemTotal =
                          Number(item.unitPrice || 0) * Number(item.quantity || 0);

                        const isManualService = Boolean(item.serviceName?.trim()) && !isServiceInCatalog(item.serviceName);
                        const showManualServiceReview = !hasCurrencyConflict && isManualService;
                        const sourceLineForItem = findCustomerTextLineForService(
                          visibleCustomerMessageText || customerMessageText,
                          item.serviceName,
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
                        const isBlockingItemReview =
                          priceInputReview ||
                          quantityInputReview ||
                          showPriceReferenceReview ||
                          showUnitConflict;
                        const isMenuOpen = serviceActionMenuKey === item.key;
                        const hasCriticalItemReview = isBlockingItemReview;
                        const hasAnyItemReview =
                          hasCriticalItemReview || showPriceOverride || showManualServiceReview;

                        return (
                          <div
                            key={item.key}
                            className={`relative rounded-lg border-2 p-2 space-y-1.5 min-w-0 shadow-sm ${
                              hasCriticalItemReview
                                ? "border-red-300 bg-red-50/30 dark:border-red-800/70 dark:bg-red-950/10"
                                : hasAnyItemReview
                                  ? "border-amber-300 bg-amber-50/30 dark:border-amber-800/70 dark:bg-amber-950/10"
                                  : "border-slate-300 bg-slate-50/40 dark:border-slate-700 dark:bg-slate-900/20"
                            }`}
                          >
                            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-start">
                              <div className="min-w-0 space-y-1">
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 items-center">
                                  <div className="group min-w-0">
                                    <ServiceCombobox
                                      value={item.serviceName}
                                      services={services as ServiceOption[]}
                                      onChange={(name, svc) =>
                                        onItemServiceSelect(index, name, svc)
                                      }
                                      onServiceCreated={handleServiceCreated}
                                      currentPrice={item.unitPrice}
                                      currentUnit={item.unit}
                                      showManualHint={false}
                                      saveButtonPlacement="none"
                                    />
                                    {item.serviceName.trim().length > 28 && (
                                      <p className="mt-1 hidden rounded-md border border-slate-200 bg-muted/40 px-2 py-1 text-[11px] leading-snug text-muted-foreground break-words group-focus-within:block">
                                        {item.serviceName.trim()}
                                      </p>
                                    )}
                                  </div>

                                  <div className="h-1" aria-hidden="true" />
                                </div>
                              </div>

                              <div className="pt-1 text-right text-[11px] text-muted-foreground leading-tight shrink-0">
                                <div>Total</div>
                                <div className="font-mono text-xs font-semibold text-foreground whitespace-nowrap">
                                  {formatCurrency(itemTotal, currency)}
                                </div>
                              </div>

                              {formItems.length > 1 && (
                                isManualService ? (
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
                                        onClick={(event) => event.stopPropagation()}
                                        className="absolute right-0 top-8 z-50 w-48 rounded-md border bg-background py-1 text-sm shadow-lg"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => saveItemToServices(index)}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                                        >
                                          <Plus className="h-3.5 w-3.5" />
                                          In Leistungen übernehmen
                                        </button>
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
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => removeItem(index)}
                                    className="mt-0.5 rounded-md border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100 shrink-0"
                                    title="Leistung entfernen"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )
                              )}
                            </div>

                            <div className="grid grid-cols-3 gap-1.5">
                              <div>
                                <Label className="text-[10px] leading-none">Einheit</Label>
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
                                  value={priceInputReview ? "" : item.unitPrice}
                                  placeholder={priceInputReview ? "prüfen" : "0"}
                                  onFocus={(e) => e.currentTarget.select()}
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
                                <Label className="text-[10px] leading-none">Menge</Label>
                                <Input
                                  type="number"
                                  step="0.25"
                                  className={`h-8 text-xs ${
                                    quantityInputReview
                                      ? "border-red-400 bg-red-50 dark:bg-red-950/20"
                                      : ""
                                  }`}
                                  value={quantityInputReview ? "" : item.quantity}
                                  placeholder={quantityInputReview ? "prüfen" : "0"}
                                  onFocus={(e) => e.currentTarget.select()}
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

                            {showItemReviewBlock && (
                              <div
                                className={`rounded-md border px-2.5 py-2 text-[11px] leading-snug ${
                                  isBlockingItemReview
                                    ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200"
                                    : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200"
                                }`}
                              >
                                <div className="mb-1 flex items-center gap-1 font-semibold">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                  Manuell prüfen
                                </div>

                                <div className="space-y-1">
                                  {showUnitConflict && catalogService && (
                                    <div className="space-y-0.5">
                                      <div>Die Einheit aus dem Kundentext passt nicht zum Leistungskatalog.</div>
                                      {sourceLineForItem && (
                                        <div>
                                          Kundentext: <span className="font-medium">{sourceLineForItem}</span>
                                        </div>
                                      )}
                                      <div>
                                        Erkannt: <span className="font-medium">{orderSummary}</span>
                                      </div>
                                      {catalogSummary && (
                                        <div>
                                          Leistungskatalog: <span className="font-medium">{catalogSummary}</span>
                                        </div>
                                      )}
                                      <div>Bitte Einheit, Menge und Preis manuell bestätigen.</div>
                                    </div>
                                  )}

                                  {!showUnitConflict && showPriceOverride && catalogService && (
                                    <div className="space-y-0.5">
                                      <div>Kundentext und Katalog haben dieselbe Einheit, aber unterschiedliche Preise.</div>
                                      {sourceLineForItem && (
                                        <div>
                                          Kundentext: <span className="font-medium">{sourceLineForItem}</span>
                                        </div>
                                      )}
                                      <div>
                                        Katalog: {formatCurrency(catalogPrice, currency)} · Auftrag: {formatCurrency(itemPriceNumber, currency)}
                                      </div>
                                      <div>Textpreis wurde übernommen. Bitte kurz kontrollieren.</div>
                                    </div>
                                  )}

                                  {!showUnitConflict && showPriceReferenceReview && (
                                    <div className="space-y-0.5">
                                      <div>Preisangabe unsicher: Der Text verweist auf einen früheren oder normalen Preis.</div>
                                      {sourceLineForItem && (
                                        <div>
                                          Kundentext: <span className="font-medium">{sourceLineForItem}</span>
                                        </div>
                                      )}
                                      <div>Bitte Preis manuell bestätigen.</div>
                                    </div>
                                  )}

                                  {!showUnitConflict && (priceInputReview || quantityInputReview) && (
                                    <div className="space-y-0.5">
                                      {priceInputReview && <div>Preis fehlt oder muss geprüft werden.</div>}
                                      {quantityInputReview && <div>Menge fehlt oder muss geprüft werden.</div>}
                                      <div>Bitte fehlende Werte ergänzen, bevor Angebot oder Rechnung erstellt wird.</div>
                                    </div>
                                  )}

                                  {showManualServiceReview && (
                                    <div className="space-y-0.5">
                                      <div>Diese Leistung ist nicht im Leistungskatalog hinterlegt.</div>
                                      <div>Bitte prüfen oder über das Menü in den Leistungskatalog übernehmen.</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
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
                    <div className="rounded-lg border bg-background p-2 sm:p-3">
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <Button onClick={save} disabled={saving} className="w-full">
                          {saving ? "Speichern..." : "Speichern"}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={saveAndCreateOffer}
                          disabled={saving}
                          className="w-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 text-xs sm:text-sm"
                        >
                          <FileCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
                          Angebot
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={saveAndCreateInvoice}
                          disabled={saving}
                          className="w-full bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 text-xs sm:text-sm"
                        >
                          <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
                          Rechnung
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setDialogOpen(false)}
                          className="w-full"
                        >
                          Abbrechen
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Besonderheiten — always visible, important warnings highlighted */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label className="font-semibold">Besonderheiten</Label>
                      {dangerNoteLines.length > 0 && (
                        <Badge className="bg-red-100 text-red-700 border border-red-200">
                          Gefahr / Achtung
                        </Badge>
                      )}
                    </div>

                    {dangerNoteLines.length > 0 && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-1">
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
                      className="w-full min-h-[84px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="z.B. Rückruf, Zugang, Parkplatz, Leiter nötig, Terminwunsch..."
                      value={normalSpecialNotesText}
                      onChange={(e) => updateNormalSpecialNotes(e.target.value)}
                    />
                  </div>

                  {/* Leistungsübersicht — live from the editable items above */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="font-semibold">Leistungsübersicht</Label>
                      <span className="text-xs text-muted-foreground">
                        Live aus den Leistungen oben
                      </span>
                    </div>

                    <div className="rounded-lg border overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/60">
                          <tr className="text-left">
                            <th className="px-2 py-2 font-medium w-10">Nr.</th>
                            <th className="px-2 py-2 font-medium">Leistung</th>
                            <th className="px-2 py-2 font-medium">Einheit</th>
                            <th className="px-2 py-2 font-medium text-right">Menge</th>
                            <th className="px-2 py-2 font-medium text-right">Einzelpreis</th>
                            <th className="px-2 py-2 font-medium text-right">Summe</th>
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
                              <tr key={`${row.index}-${row.serviceName}`} className="border-t">
                                <td className="px-2 py-2">{row.index}</td>
                                <td className="px-2 py-2 font-medium">
                                  {row.serviceName}
                                </td>
                                <td className="px-2 py-2">{row.unitLabel}</td>
                                <td className="px-2 py-2 text-right">
                                  {row.hasQuantity ? row.quantity : "Menge prüfen"}
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
                          <tr className="border-t bg-muted/40 font-semibold">
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
                  </div>

                  {/* Kundennachrichten — always visible for faster review */}
                  <div className="space-y-2 mb-20 md:mb-0">
                    <Label className="font-semibold">Kundennachrichten</Label>

                    <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
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

                      {customerMessageImagePreviewUrl && currentEditOrder && (
                        <button
                          type="button"
                          className="group flex w-full items-center gap-3 rounded-lg border bg-background p-2 text-left hover:bg-muted/60"
                          onClick={() => openMedia(currentEditOrder)}
                        >
                          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                            <img
                              src={customerMessageImagePreviewUrl}
                              alt="Kundenbild"
                              className="h-full w-full object-cover transition-transform group-hover:scale-105"
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">
                              Bildvorschau
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Miniatur anklicken für Großansicht
                            </div>
                          </div>

                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </button>
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
                        <div className="rounded-md border bg-background p-2 whitespace-pre-wrap">
                          {visibleCustomerMessageText}
                        </div>
                      ) : !currentEditOrder?.audioTranscript &&
                        !currentEditOrder?.mediaUrl &&
                        !customerMessageImagePreviewUrl ? (
                        <div className="rounded-md border bg-background p-2 whitespace-pre-wrap">
                          Keine Kundennachricht gespeichert.
                        </div>
                      ) : null}
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
              the regular desktop action buttons ("→ Angebot", "→ Rechnung",
              "Speichern"). Navigation between main lists now happens via
              the small mobile-only shortcut rendered at the END of the
              list page (see <MobileListShortcut /> below). */}
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
