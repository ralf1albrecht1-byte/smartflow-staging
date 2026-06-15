"use client";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  FileText,
  Plus,
  Download,
  Trash2,
  Loader2,
  Volume2,
  ImageIcon,
  AlertTriangle,
  Search,
  MoreVertical,
  Archive,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarDays,
  Undo2,
  MessageCircle,
  MapPin,
  Pencil,
  X,
} from "lucide-react";
import { sendPdfToBusinessWhatsApp } from "@/lib/whatsapp-share";
import {
  CommunicationBlock,
  CommunicationChips,
  buildMergedContactReviewEntries,
  resolveCommunicationData,
  stripForwardedMessage,
} from "@/components/communication-block";
import { MergedContactReviewChip } from "@/components/merged-contact-review-chip";
import {
  collectMergedAppointmentEntries,
  formatMergedAppointmentTooltip,
} from "@/lib/merged-appointment-utils";
import { ServiceCombobox, ServiceOption } from "@/components/service-combobox";
import { autoFillCustomerFromNotes } from "@/lib/extract-from-notes";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  DuplicateCheckPanel,
  type DuplicateMatch,
} from "@/components/customer-duplicate-check";
import { TouchImageViewer } from "@/components/touch-image-viewer";
import { MwStControl } from "@/components/mwst-control";
import { formatCurrency } from "@/lib/currency";
import { splitSpecialNotes } from "@/lib/special-notes-utils";
import { fetchAllJSON } from "@/lib/fetch-utils";
import { LoadErrorFallback } from "@/components/load-error-fallback";
import { INVOICE_STATUS_STYLES, getStatusStyle } from "@/lib/status-colors";
import { useDialogBackGuard } from "@/lib/use-dialog-back-guard";
import {
  isCustomerDataIncomplete,
  isRequiredCustomerFieldMissing,
} from "@/lib/customer-links";
import { PlzOrtInput } from "@/components/plz-ort-input";
import { CustomerSearchCombobox } from "@/components/customer-search-combobox";
import { MissingCustomerDataBadge } from "@/components/missing-customer-data-badge";

const SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227 = "smartflow:close-card-popovers-v17-90l227";

interface InvoiceItem {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  sourceOrderId?: string | null;
}
interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customer?: any;
  items: any[];
  orders?: {
    id: string;
    originOrderIds?: string[] | null;
    reviewReasons?: string[] | null;
    createdAt?: string | null;
    date?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
    imageUrls?: string[];
    thumbnailUrls?: string[];
    audioTranscript?: string | null;
    audioDurationSec?: number | null;
    audioTranscriptionStatus?: string | null;
    notes?: string | null;
    specialNotes?: string | null;
    needsReview?: boolean;
    hinweisLevel?: string;
    description?: string | null;
    siteAddressDifferent?: boolean;
    siteName?: string | null;
    siteAddress?: string | null;
    sitePlz?: string | null;
    siteCity?: string | null;
    siteNote?: string | null;
    customer?: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
    } | null;
    workSites?: Array<{
      id?: string | null;
      siteName?: string | null;
      siteAddress?: string | null;
      sitePlz?: string | null;
      siteCity?: string | null;
      siteNote?: string | null;
      sourceOrderId?: string | null;
      isPrimary?: boolean | null;
      sortOrder?: number | null;
    }> | null;
  }[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  currency?: "CHF" | "EUR" | string | null;
  status: string;
  invoiceDate: string;
  createdAt?: string;
  dueDate: string | null;
  notes: string | null;
  sourceOfferId?: string | null;
  sourceOfferNumber?: string | null;
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

const INVOICE_HISTORICAL_STATUSES = new Set([
  "Gesendet",
  "Überfällig",
  "Bezahlt",
  "Erledigt",
]);

const isHistoricalInvoiceStatus = (status: unknown) =>
  INVOICE_HISTORICAL_STATUSES.has(String(status ?? "").trim());

type InvoiceExecutionSite = {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  sourceOrderId?: string | null;
};

const getEmptyInvoiceExecutionSite = (): InvoiceExecutionSite => ({
  siteName: "",
  siteAddress: "",
  sitePlz: "",
  siteCity: "",
  siteNote: "",
});

const compactInvoiceValue = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
type InvoiceCurrencyReviewDetailV17_90L227 = {
  serviceName: string;
  sourceCurrency: string;
  documentCurrency: string;
  originalAmount: number | null;
};

function collectInvoiceCurrencyReviewDetailsV17_90L227(
  document: Invoice,
): InvoiceCurrencyReviewDetailV17_90L227[] {
  const documentCurrency =
    String(document.currency || "CHF").trim().toUpperCase() || "CHF";
  const sourceText = (document.orders || [])
    .flatMap((order: any) => [order?.notes, order?.description, order?.audioTranscript])
    .filter(Boolean)
    .join("\n");
  const seen = new Set<string>();
  const details: InvoiceCurrencyReviewDetailV17_90L227[] = [];

  for (const order of document.orders || []) {
    for (const rawReason of order?.reviewReasons || []) {
      const parts = String(rawReason || "")
        .split(":")
        .map((part) => compactInvoiceValue(part));
      if (!["item_currency_mismatch", "currency_conflict_item"].includes(parts[0])) {
        continue;
      }
      const serviceName = parts[1] || "Leistung";
      const sourceCurrency = String(parts[2] || "").toUpperCase();
      const targetCurrency = String(parts[3] || documentCurrency).toUpperCase();
      const key = `${serviceName.toLowerCase()}|${sourceCurrency}|${targetCurrency}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const escapedCurrency = sourceCurrency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const amountPatterns = escapedCurrency
        ? [
            new RegExp(`\\b${escapedCurrency}\\s*(\\d+(?:[.,]\\d{1,2})?)`, "i"),
            new RegExp(`\\b(\\d+(?:[.,]\\d{1,2})?)\\s*${escapedCurrency}\\b`, "i"),
          ]
        : [];
      let originalAmount: number | null = null;
      for (const pattern of amountPatterns) {
        const match = sourceText.match(pattern);
        const parsed = Number(String(match?.[1] || "").replace(",", "."));
        if (Number.isFinite(parsed) && parsed > 0) {
          originalAmount = parsed;
          break;
        }
      }

      details.push({
        serviceName,
        sourceCurrency: sourceCurrency || "prüfen",
        documentCurrency: targetCurrency || documentCurrency,
        originalAmount,
      });
    }
  }
  return details;
}

function formatInvoiceCurrencyReviewTooltipV17_90L227(
  details: InvoiceCurrencyReviewDetailV17_90L227[],
): string {
  return [
    "Währung prüfen",
    ...details.map((detail) => {
      const original =
        detail.originalAmount && detail.originalAmount > 0
          ? `${detail.sourceCurrency} ${detail.originalAmount.toFixed(2)}`
          : detail.sourceCurrency;
      return `• ${detail.serviceName} — Original ${original}, Dokumentwährung ${detail.documentCurrency} · nicht berechnet`;
    }),
  ].join("\n");
}


function InvoiceWhatsAppIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5.2 19.1 6 15.9a7.4 7.4 0 1 1 2.8 2.7z" />
      <path d="M9.1 8.7c.2-.5.4-.5.7-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.3.1.5-.1.7l-.4.5c.6 1.1 1.4 1.9 2.5 2.5l.5-.4c.2-.2.5-.2.7-.1l1.6.7c.3.1.4.3.4.5v.5c0 .3 0 .5-.5.7-.6.3-1.4.4-2.5 0-2.4-.8-4.4-2.8-5.2-5.2-.4-1.1-.3-1.9 0-2.5z" />
    </svg>
  );
}

function InvoicePdfDocumentIcon({
  withDownload = false,
}: {
  withDownload?: boolean;
}) {
  return (
    <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
      <FileText className="h-5 w-5" strokeWidth={1.9} />
      <span className="absolute inset-x-[3px] top-[7px] rounded-[2px] bg-current px-[1px] py-[0.5px] text-center text-[5px] font-black leading-none text-white dark:text-slate-950">
        PDF
      </span>
      {withDownload && (
        <span className="absolute -bottom-1 -right-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-blue-200 bg-white text-blue-700 shadow-sm dark:border-blue-700 dark:bg-slate-950 dark:text-blue-200">
          <Download className="h-2.5 w-2.5" strokeWidth={2.4} />
        </span>
      )}
    </span>
  );
}

function InvoiceDirectPdfIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 shrink-0"
      aria-hidden="true"
    >
      <path
        d="M6.5 2.75h7l4 4v14.5h-11z"
        fill="white"
        stroke="#dc2626"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 2.75v4h4"
        fill="none"
        stroke="#dc2626"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <rect x="4.15" y="11" width="15.7" height="6.45" rx="1.25" fill="#dc2626" />
      <text
        x="12"
        y="15.55"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="4.75"
        fontWeight="800"
        fill="white"
      >
        PDF
      </text>
    </svg>
  );
}

function InvoicePdfWhatsAppIcon() {
  return (
    <span className="relative inline-flex h-5 w-6 shrink-0 items-center justify-start">
      <InvoicePdfDocumentIcon />
      <span className="absolute -bottom-1 -right-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald-200 bg-emerald-500 text-white shadow-sm dark:border-emerald-700">
        <InvoiceWhatsAppIcon className="h-3 w-3" />
      </span>
    </span>
  );
}

type InvoiceMergedAppointmentEntry = ReturnType<
  typeof collectMergedAppointmentEntries
>[number];

const normalizeInvoiceAppointmentDisplayKey = (value: unknown) =>
  compactInvoiceValue(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getInvoiceAppointmentDayKey = (value: unknown): string => {
  const label = compactInvoiceValue(value);
  const dateMatch = label.match(
    /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\.?/,
  );
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, "0");
    const month = dateMatch[2].padStart(2, "0");
    const year = dateMatch[3] || "";
    return `${day}.${month}${year ? `.${year}` : ""}`;
  }
  const relativeMatch = label.match(
    /^(heute|morgen|übermorgen|uebermorgen|(?:(?:nächsten?|naechsten?|kommenden?|diesen?)\s+)?(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))/i,
  );
  return normalizeInvoiceAppointmentDisplayKey(relativeMatch?.[1] || "");
};

const compactInvoiceAppointmentEntriesForDisplay = (
  entries: InvoiceMergedAppointmentEntry[],
): InvoiceMergedAppointmentEntry[] => {
  const result: InvoiceMergedAppointmentEntry[] = [];

  for (const entry of entries) {
    const siteKey = normalizeInvoiceAppointmentDisplayKey(entry.site);
    const labelKey = normalizeInvoiceAppointmentDisplayKey(entry.label);
    if (!labelKey) continue;

    const exactIndex = result.findIndex(
      (current) =>
        normalizeInvoiceAppointmentDisplayKey(current.site) === siteKey &&
        normalizeInvoiceAppointmentDisplayKey(current.label) === labelKey,
    );
    if (exactIndex >= 0) {
      if (
        String(entry.source || "").length >
        String(result[exactIndex].source || "").length
      ) {
        result[exactIndex] = entry;
      }
      continue;
    }

    const dayKey = getInvoiceAppointmentDayKey(entry.label);
    const hasTime = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(entry.label);
    if (dayKey) {
      const sameDaySiteIndex = result.findIndex(
        (current) =>
          normalizeInvoiceAppointmentDisplayKey(current.site) === siteKey &&
          getInvoiceAppointmentDayKey(current.label) === dayKey,
      );
      if (sameDaySiteIndex >= 0) {
        const currentHasTime = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(
          result[sameDaySiteIndex].label,
        );
        if (currentHasTime && !hasTime) continue;
        if (!currentHasTime && hasTime) {
          result[sameDaySiteIndex] = entry;
          continue;
        }
      }
    }

    result.push(entry);
  }

  return result;
};

// V17.90L168: Die vorhandenen Trennlinien bleiben feste Layoutgrenzen.
// Nur ein reines Datum wird im Terminchip ausgeschrieben; jeder Zusatz zeigt nur das Kalendersymbol.
type AdaptiveAppointmentLabels = {
  full: string;
  dateOnly: string | null;
};

const buildAdaptiveAppointmentLabels = (
  value: unknown,
): AdaptiveAppointmentLabels => {
  const full = compactInvoiceValue(value) || "Termin klären";
  const dateMatch = full.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\.?$/);
  if (!dateMatch) return { full, dateOnly: null };
  const day = dateMatch[1].padStart(2, "0");
  const month = dateMatch[2].padStart(2, "0");
  const year = dateMatch[3] || "";
  return {
    full,
    dateOnly: year ? `${day}.${month}.${year}` : `${day}.${month}.`,
  };
};

// V17.90L169: Der Termin im Popover wird in Datum, Uhrzeit und Zusatz gegliedert.
type StructuredInvoiceAppointmentTooltipV17_90L169 = {
  date: string;
  time: string;
  note: string;
  fallback: string;
};

const parseInvoiceAppointmentTooltipV17_90L169 = (
  value: unknown,
): StructuredInvoiceAppointmentTooltipV17_90L169 => {
  const fallback = compactInvoiceValue(value) || "Termin klären";
  const source = fallback.replace(/\n+/g, " · ").replace(/\s+/g, " ").trim();
  const dateMatch = source.match(
    /\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\.?\b/,
  );
  const date = dateMatch
    ? `${dateMatch[1].padStart(2, "0")}.${dateMatch[2].padStart(2, "0")}.${
        dateMatch[3] ? String(dateMatch[3]).padStart(2, "0") : ""
      }`
    : "";
  const sourceWithoutDate = dateMatch
    ? source.replace(dateMatch[0], " ")
    : source;
  const clockMatches = Array.from(
    sourceWithoutDate.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g),
  ).map((match) => `${match[1].padStart(2, "0")}:${match[2]}`);
  const uniqueTimes = Array.from(new Set(clockMatches));
  const time =
    uniqueTimes.length >= 2
      ? `${uniqueTimes[0]}–${uniqueTimes[1]} Uhr`
      : uniqueTimes[0]
        ? `${uniqueTimes[0]} Uhr`
        : "";
  let note = source;
  if (dateMatch) note = note.replace(dateMatch[0], " ");
  note = note
    .replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g, " ")
    .replace(/\b(?:Ausführungstermin|Ausfuehrungstermin|Termin|Uhr)\b/gi, " ")
    .replace(/[·•|]+/g, " ")
    .replace(/\s*[–—-]\s*(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:um|von|bis)\s+/i, "")
    .replace(/[,:;\-–—.\s]+$/g, "")
    .replace(/^[,:;\-–—.\s]+/g, "")
    .trim();
  return { date, time, note, fallback };
};

const serializeInvoiceExecutionSiteForEdit = (
  site?: InvoiceExecutionSite | null,
) =>
  JSON.stringify({
    siteName: compactInvoiceValue(site?.siteName),
    siteAddress: compactInvoiceValue(site?.siteAddress),
    sitePlz: compactInvoiceValue(site?.sitePlz),
    siteCity: compactInvoiceValue(site?.siteCity),
    siteNote: compactInvoiceValue(site?.siteNote),
    sourceOrderId: compactInvoiceValue(site?.sourceOrderId),
  });

const normalizeInvoiceServiceName = (value: unknown) =>
  compactInvoiceValue(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const getInvoiceServiceReviewReasonV17_90L134 = (
  item: InvoiceItem,
  services: any[],
): string => {
  const name = compactInvoiceValue(item?.description);
  const quantity = Number(item?.quantity || 0);
  const price = Number(item?.unitPrice || 0);
  const unit = compactInvoiceValue(item?.unit);
  if (!name) return "Leistung prüfen";
  if (quantity <= 0) return "Menge prüfen";
  if (!unit || /(?:prüfen|pruefen|prufen)/i.test(unit)) return "Einheit prüfen";
  if (price <= 0) return "Preis prüfen";
  const catalog = (services || []).find(
    (service: any) =>
      normalizeInvoiceServiceName(service?.name) ===
      normalizeInvoiceServiceName(name),
  );
  if (!catalog) return "Nicht im Leistungskatalog";
  const catalogUnit = compactInvoiceValue(catalog?.unit);
  const catalogPrice = Number(catalog?.defaultPrice || 0);
  if (catalogUnit && catalogUnit !== unit) return "Einheit abweichend";
  if (catalogPrice > 0 && Math.abs(catalogPrice - price) >= 0.001)
    return "Preis abweichend";
  return "";
};

const splitInvoicePdfText = (value?: string | null) => {
  const source = String(value || "").trim();
  const marker = "Titel: ";
  if (!source.startsWith(marker)) return { pdfTitle: "", notes: source };
  const [firstLine, ...rest] = source.split(/\n/);
  return {
    pdfTitle: firstLine.slice(marker.length).trim(),
    notes: rest.join("\n").replace(/^\s+/, "").trim(),
  };
};

const joinInvoicePdfText = (pdfTitle: string, notes: string) => {
  const title = compactInvoiceValue(pdfTitle);
  const body = String(notes || "").trim();
  if (!title) return body;
  return body ? `Titel: ${title}\n\n${body}` : `Titel: ${title}`;
};

const uniqueInvoiceLines = (values: Array<string | null | undefined>) =>
  Array.from(
    new Map(
      values
        .flatMap((value) => String(value || "").split(/\n+/g))
        .map((line) => compactInvoiceValue(line))
        .filter(Boolean)
        .map((line) => [normalizeInvoiceServiceName(line), line]),
    ).values(),
  );

function splitInvoiceSourceLinesV17_90L237(value: unknown): string[] {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\[(?:HINWEIS|INFO|NOTIZ|GEFAHR|WARNUNG|WARNHINWEIS)\]/gi, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => compactInvoiceValue(line.replace(/^\s*[-•*]+\s*/g, "")))
    .filter(Boolean);
}

function collectInvoiceServiceEvidenceLinesV17_90L237(invoice?: Invoice | null): Set<string> {
  const result = new Set<string>();
  for (const order of invoice?.orders || []) {
    const raw = String(order?.notes || order?.audioTranscript || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = raw.split(/\n+/g).map((line) => compactInvoiceValue(line));
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      const next = lines.slice(index + 1).find(Boolean) || "";
      const sameLinePrice = /\b(?:CHF|EUR|USD|GBP)\s*\d|\b\d+(?:[.,]\d+)?\s*(?:CHF|EUR|USD|GBP)\b/i.test(line);
      const nextLinePrice = /\b(?:gesamtpreis|pauschalpreis|prix\s+total|prix\s+forfaitaire|total\s+price|flat\s+fee|prezzo\s+totale|precio\s+total)\b.{0,40}\b(?:CHF|EUR|USD|GBP)\b/i.test(next);
      if (sameLinePrice || nextLinePrice) result.add(normalizeInvoiceServiceName(line));
    }
  }
  return result;
}

function invoiceHintMatchesServiceEvidenceV17_90L237(
  value: string,
  evidence: Set<string>,
): boolean {
  const key = normalizeInvoiceServiceName(value);
  if (!key) return false;
  for (const candidate of evidence) {
    if (!candidate) continue;
    if (key === candidate) return true;
    const shorter = key.length <= candidate.length ? key : candidate;
    const longer = key.length > candidate.length ? key : candidate;
    if (shorter.length >= 12 && longer.includes(shorter) && shorter.length / longer.length >= 0.72) {
      return true;
    }
  }
  return false;
}

function uniquePreferredInvoiceInfoLinesV17_90L237(values: string[]): string[] {
  const result: string[] = [];
  for (const raw of values) {
    const line = compactInvoiceValue(raw);
    const key = normalizeInvoiceServiceName(line);
    if (!line || !key) continue;
    const existingIndex = result.findIndex((entry) => {
      const existing = normalizeInvoiceServiceName(entry);
      if (existing === key) return true;
      const shorter = existing.length <= key.length ? existing : key;
      const longer = existing.length > key.length ? existing : key;
      return shorter.length >= 8 && longer.includes(shorter);
    });
    if (existingIndex >= 0) {
      if (line.length > result[existingIndex].length) result[existingIndex] = line;
      continue;
    }
    result.push(line);
  }
  return result;
}

function extractInvoiceAccessLinesV17_90L237(
  invoice: Invoice | null,
  serviceNames: string[],
): string[] {
  const serviceKeys = (serviceNames || []).map(normalizeInvoiceServiceName).filter(Boolean);
  const accessPattern = /\b(?:schluessel|schlussel|schlüssel|schluesselbox|schlusselbox|schlüsselbox|schluesselkasten|schlusselkasten|schlüsselkasten|tuerkode|turkode|türkode|tuercode|turcode|türcode|zugang|zutritt|seiteneingang|hintereingang|eingangscode|key|keybox|key\s+box|door\s*code|access|entrance|cle|clé|boite\s+a\s+cles|boîte\s+à\s+clés|acces|accès|chiave|codice|ingresso|llave|codigo|código|acceso)\b/i;
  const candidates: string[] = [];
  for (const order of invoice?.orders || []) {
    for (const source of [order?.specialNotes, order?.notes, order?.audioTranscript]) {
      for (const line of splitInvoiceSourceLinesV17_90L237(source)) {
        const key = normalizeInvoiceServiceName(line);
        if (!key || !accessPattern.test(key)) continue;
        if (
          serviceKeys.some((serviceKey) =>
            serviceKey.length >= 8 &&
            (key === serviceKey || key.includes(serviceKey) || serviceKey.includes(key)),
          )
        ) continue;
        candidates.push(line);
      }
    }
  }
  return uniquePreferredInvoiceInfoLinesV17_90L237(candidates);
}

function collectInvoiceCanonicalSpecialNotesV17_90L237(
  invoice: Invoice | null,
  fallback?: string | null,
): string {
  const canonical = (invoice?.orders || [])
    .map((order) => String(order?.specialNotes || "").trim())
    .filter(Boolean)
    .join("\n");
  return canonical || String(fallback || "");
}

const cleanInvoiceCustomerMessage = (value?: string | null) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^(?:WhatsApp|Telegram):\s*\n?/i, "")
    .split(/---\s*(?:Übersetzung|Uebersetzung) \(automatisch\)\s*---/i)[0]
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\s*\[META\]/i.test(trimmed)) return false;
      if (
        /^\s*\[(?:Titel|Title|Priorität|Prioritaet|Priority)\s*:/i.test(trimmed)
      )
        return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const isPrimaryInvoiceInformationLine = (value?: string | null) => {
  const text = normalizeInvoiceServiceName(value);
  if (!text) return false;
  return (
    /\b(?:termin|datum|uhr|kontakt|telefon|tel|sms|whatsapp|mail|email|anrufen|melden|arbeitsbeginn|ankunft|vor ort|zugang|zutritt|schluessel|schlussel|schlüssel|schluesselbox|schlusselbox|schlüsselbox|schluesselkasten|schlusselkasten|schlüsselkasten|tuerkode|turkode|türkode|tuercode|turcode|türcode|seiteneingang|hintereingang|keybox|door code|access code)\b/.test(
      text,
    ) ||
    /\b\d{1,2}[:.]\d{2}\b/.test(text) ||
    /\b(?:0|\+41)[0-9\s()./-]{7,}\b/.test(text)
  );
};

function collectInvoiceExecutionSites(source: {
  items?: any[] | null;
  orders?: Invoice["orders"] | null;
}): InvoiceExecutionSite[] {
  const sites: InvoiceExecutionSite[] = [];
  const add = (candidate?: InvoiceExecutionSite | null) => {
    if (!candidate) return;
    const site = {
      siteName: compactInvoiceValue(candidate.siteName) || null,
      siteAddress: compactInvoiceValue(candidate.siteAddress) || null,
      sitePlz: compactInvoiceValue(candidate.sitePlz) || null,
      siteCity: compactInvoiceValue(candidate.siteCity) || null,
      siteNote: compactInvoiceValue(candidate.siteNote) || null,
      sourceOrderId: compactInvoiceValue(candidate.sourceOrderId) || null,
    };
    if (
      !site.siteName &&
      !site.siteAddress &&
      !site.sitePlz &&
      !site.siteCity &&
      !site.siteNote
    )
      return;
    const key = [
      site.siteName,
      site.siteAddress,
      site.sitePlz,
      site.siteCity,
      site.siteNote,
    ]
      .map((value) => compactInvoiceValue(value).toLowerCase())
      .join("|");
    const exists = sites.some(
      (entry) =>
        [
          entry.siteName,
          entry.siteAddress,
          entry.sitePlz,
          entry.siteCity,
          entry.siteNote,
        ]
          .map((value) => compactInvoiceValue(value).toLowerCase())
          .join("|") === key,
    );
    if (!exists) sites.push(site);
  };

  (source.items || []).forEach((item: any) =>
    add({
      siteName: item?.siteName,
      siteAddress: item?.siteAddress,
      sitePlz: item?.sitePlz,
      siteCity: item?.siteCity,
      siteNote: item?.siteNote,
      sourceOrderId: item?.sourceOrderId,
    }),
  );
  (source.orders || []).forEach((order) => {
    const workSites = Array.isArray(order?.workSites)
      ? [...order.workSites].sort(
          (a, b) =>
            Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
            Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
        )
      : [];
    workSites.forEach((site) =>
      add({ ...site, sourceOrderId: site.sourceOrderId || order.id }),
    );
    if (workSites.length === 0 || order?.siteAddressDifferent) {
      add({
        siteName: order?.siteName,
        siteAddress: order?.siteAddress,
        sitePlz: order?.sitePlz,
        siteCity: order?.siteCity,
        siteNote: order?.siteNote,
        sourceOrderId: order?.id,
      });
    }
  });
  return sites;
}

type InvoiceItemGroup = {
  key: string;
  site: InvoiceExecutionSite | null;
  entries: Array<{ item: InvoiceItem; index: number }>;
  subtotal: number;
};

const invoiceSiteKey = (site: InvoiceExecutionSite) =>
  [site.siteName, site.siteAddress, site.sitePlz, site.siteCity, site.siteNote]
    .map((value) => compactInvoiceValue(value).toLowerCase())
    .join("|");

function groupInvoiceItemsByExecutionSite(
  sourceItems: InvoiceItem[],
  sites: InvoiceExecutionSite[] = [],
): InvoiceItemGroup[] {
  const groups = new Map<string, InvoiceItemGroup>();
  sourceItems.forEach((item, index) => {
    const matchedSite =
      sites.find((site) => invoiceSiteKey(site) === invoiceSiteKey(item)) ||
      (item.sourceOrderId
        ? sites.find((site) => site.sourceOrderId === item.sourceOrderId)
        : undefined) ||
      (sites.length === 1 ? sites[0] : null);
    const site =
      matchedSite ||
      (item.siteName || item.siteAddress || item.sitePlz || item.siteCity
        ? {
            siteName: item.siteName || null,
            siteAddress: item.siteAddress || null,
            sitePlz: item.sitePlz || null,
            siteCity: item.siteCity || null,
            siteNote: item.siteNote || null,
            sourceOrderId: item.sourceOrderId || null,
          }
        : null);
    const key = site
      ? `${site.sourceOrderId || ""}|${invoiceSiteKey(site)}`
      : "general";
    const lineTotal = Number(item.quantity || 0) * Number(item.unitPrice || 0);
    const group = groups.get(key) || { key, site, entries: [], subtotal: 0 };
    group.entries.push({ item, index });
    group.subtotal += Number.isFinite(lineTotal) ? lineTotal : 0;
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

function buildInvoiceGroupReviewRows(
  group: InvoiceItemGroup,
  services: any[],
  currency: "CHF" | "EUR",
): string[] {
  return group.entries.flatMap(({ item }) => {
    const name = compactInvoiceValue(item?.description) || "Neue Leistung";
    const quantity = Number(item?.quantity || 0);
    const unitPrice = Number(item?.unitPrice || 0);
    const unit = compactInvoiceValue(item?.unit);
    const matched = (services || []).find(
      (service: any) =>
        normalizeInvoiceServiceName(service?.name) ===
        normalizeInvoiceServiceName(name),
    );
    const reasons: string[] = [];
    if (
      !name ||
      quantity <= 0 ||
      unitPrice <= 0 ||
      !unit ||
      /(?:prüfen|pruefen|prufen)/i.test(unit)
    )
      reasons.push("Preis, Menge oder Einheit prüfen");
    if (!matched) reasons.push("nicht im Leistungskatalog");
    if (matched) {
      const catalogPrice = Number(matched?.defaultPrice || 0);
      const catalogUnit = compactInvoiceValue(matched?.unit);
      if (catalogUnit && catalogUnit !== unit)
        reasons.push(`Einheit: ${unit || "–"} statt ${catalogUnit}`);
      if (Math.abs(catalogPrice - unitPrice) >= 0.001)
        reasons.push(
          `Preis: ${formatCurrency(unitPrice, currency)} statt ${formatCurrency(catalogPrice, currency)}`,
        );
    }
    return reasons.length > 0
      ? [
          `${name}
${reasons.join(" · ")}`,
        ]
      : [];
  });
}

type InvoiceServiceReviewEntry = {
  item: InvoiceItem;
  description: string;
  category: "blocker" | "deviation" | "missing";
  details: string[];
};

type InvoiceServiceReviewSiteGroup = {
  key: string;
  site: InvoiceExecutionSite | null;
  entries: InvoiceServiceReviewEntry[];
};

type InvoiceServiceDisplayEntry = {
  item: InvoiceItem;
  description: string;
  category: "blocker" | "deviation" | "missing" | "catalog";
  details: string[];
};

type InvoiceServiceDisplaySiteGroup = {
  key: string;
  site: InvoiceExecutionSite | null;
  entries: InvoiceServiceDisplayEntry[];
};

function buildInvoiceServiceDisplayEntriesV17_90L136(
  items: InvoiceItem[],
  services: any[],
  currency: "CHF" | "EUR",
): InvoiceServiceDisplayEntry[] {
  return (items || []).map((item) => {
    const quantity = Number(item?.quantity ?? 0);
    const unitPrice = Number(item?.unitPrice ?? 0);
    const description =
      compactInvoiceValue(item?.description) || "Unbenannte Leistung";
    const unit = compactInvoiceValue(item?.unit);
    const matchedService = (services || []).find(
      (service: any) =>
        normalizeInvoiceServiceName(service?.name) ===
        normalizeInvoiceServiceName(description),
    );
    const currentCalculation = `${quantity > 0 ? quantity : "prüfen"} ${
      unit || "–"
    } × ${
      unitPrice > 0 ? formatCurrency(unitPrice, currency) : "Preis prüfen"
    } = ${formatCurrency(
      Math.max(0, quantity) * Math.max(0, unitPrice),
      currency,
    )}`;
    const missingReasons = [
      !compactInvoiceValue(item?.description) ? "Leistungsname fehlt" : "",
      !unit ? "Einheit fehlt" : "",
      quantity <= 0 ? "Menge fehlt oder ist 0" : "",
      unitPrice <= 0 ? "Preis fehlt oder ist 0" : "",
    ].filter(Boolean);

    if (missingReasons.length > 0) {
      return {
        item,
        description,
        category: "blocker" as const,
        details: [`Aktuell: ${currentCalculation}`, ...missingReasons],
      };
    }

    if (!matchedService) {
      return {
        item,
        description,
        category: "missing" as const,
        details: [`Aktuell: ${currentCalculation}`],
      };
    }

    const catalogUnit = compactInvoiceValue(matchedService?.unit);
    const catalogPrice = Number(matchedService?.defaultPrice || 0);
    const sameUnit = !catalogUnit || catalogUnit === unit;
    const samePrice = Math.abs(catalogPrice - unitPrice) < 0.001;
    const details = [
      `Aktuell: ${currentCalculation}`,
      `Katalogpreis: ${formatCurrency(catalogPrice, currency)} / ${
        catalogUnit || "–"
      }`,
      ...[
        !sameUnit
          ? `Einheit weicht ab: ${unit || "–"} statt ${catalogUnit || "–"}`
          : "",
        !samePrice ? "Preis weicht vom Katalog ab." : "",
      ].filter(Boolean),
    ];

    return {
      item,
      description,
      category:
        sameUnit && samePrice ? ("catalog" as const) : ("deviation" as const),
      details,
    };
  });
}

function buildInvoiceServiceDisplaySiteGroupsV17_90L136(
  items: InvoiceItem[],
  sites: InvoiceExecutionSite[],
  services: any[],
  currency: "CHF" | "EUR",
): InvoiceServiceDisplaySiteGroup[] {
  return groupInvoiceItemsByExecutionSite(items, sites)
    .map((group) => ({
      key: group.key,
      site: group.site,
      entries: buildInvoiceServiceDisplayEntriesV17_90L136(
        group.entries.map((entry) => entry.item),
        services,
        currency,
      ),
    }))
    .filter((group) => group.entries.length > 0);
}

function buildInvoiceServiceReviewEntriesV17_90L135G(
  items: InvoiceItem[],
  services: any[],
  currency: "CHF" | "EUR",
): InvoiceServiceReviewEntry[] {
  return (items || []).flatMap<InvoiceServiceReviewEntry>((item) => {
    const quantity = Number(item?.quantity ?? 0);
    const unitPrice = Number(item?.unitPrice ?? 0);
    const description =
      compactInvoiceValue(item?.description) || "Unbenannte Leistung";
    const unit = compactInvoiceValue(item?.unit);
    const matchedService = (services || []).find(
      (service: any) =>
        normalizeInvoiceServiceName(service?.name) ===
        normalizeInvoiceServiceName(description),
    );
    const currentCalculation = `${quantity > 0 ? quantity : "prüfen"} ${unit || "–"} × ${
      unitPrice > 0 ? formatCurrency(unitPrice, currency) : "Preis prüfen"
    } = ${formatCurrency(Math.max(0, quantity) * Math.max(0, unitPrice), currency)}`;
    const missingReasons = [
      !compactInvoiceValue(item?.description) ? "Leistungsname fehlt" : "",
      !unit ? "Einheit fehlt" : "",
      quantity <= 0 ? "Menge fehlt oder ist 0" : "",
      unitPrice <= 0 ? "Preis fehlt oder ist 0" : "",
    ].filter(Boolean);

    if (missingReasons.length > 0) {
      return [
        {
          item,
          description,
          category: "blocker" as const,
          details: [...missingReasons, `Aktuell: ${currentCalculation}`],
        },
      ];
    }
    if (!matchedService) {
      return [
        {
          item,
          description,
          category: "missing" as const,
          details: [`Aktuell: ${currentCalculation}`],
        },
      ];
    }
    const catalogUnit = compactInvoiceValue(matchedService?.unit);
    const catalogPrice = Number(matchedService?.defaultPrice || 0);
    const sameUnit = catalogUnit === unit;
    const samePrice = Math.abs(catalogPrice - unitPrice) < 0.001;
    if (sameUnit && samePrice) return [];
    return [
      {
        item,
        description,
        category: "deviation" as const,
        details: [
          `Aktuell: ${currentCalculation}`,
          `Katalogpreis: ${formatCurrency(catalogPrice, currency)} / ${catalogUnit || "–"}`,
          ...[
            !sameUnit
              ? `Einheit weicht ab: ${unit || "–"} statt ${catalogUnit || "–"}`
              : "",
            !samePrice ? "Preis weicht vom Katalog ab." : "",
          ].filter(Boolean),
        ],
      },
    ];
  });
}

function buildInvoiceServiceReviewSiteGroupsV17_90L135G(
  items: InvoiceItem[],
  sites: InvoiceExecutionSite[],
  services: any[],
  currency: "CHF" | "EUR",
): InvoiceServiceReviewSiteGroup[] {
  return groupInvoiceItemsByExecutionSite(items, sites)
    .map((group) => ({
      key: group.key,
      site: group.site,
      entries: buildInvoiceServiceReviewEntriesV17_90L135G(
        group.entries.map((entry) => entry.item),
        services,
        currency,
      ),
    }))
    .filter((group) => group.entries.length > 0);
}

function getInvoiceMergedCount(invoice: Invoice): number {
  const orderCount = Array.isArray(invoice.orders) ? invoice.orders.length : 0;
  const originCount = Math.max(
    0,
    ...(invoice.orders || []).map((order) =>
      Array.isArray(order.originOrderIds)
        ? order.originOrderIds.filter(Boolean).length
        : 0,
    ),
  );
  const hasMergeReason = (invoice.orders || []).some((order) =>
    (order.reviewReasons || []).some((reason) =>
      ["manual_order_merge", "double_merge"].includes(String(reason || "")),
    ),
  );
  return Math.max(orderCount, originCount, hasMergeReason ? 2 : 0);
}

function buildInvoiceCommunicationData(invoice: Invoice) {
  const resolved = resolveCommunicationData(null, invoice.orders || []);
  return {
    ...resolved,
    customer: {
      ...(resolved.customer || {}),
      name: resolved.customer?.name || invoice.customer?.name || null,
      phone: resolved.customer?.phone || invoice.customer?.phone || null,
      email: resolved.customer?.email || invoice.customer?.email || null,
    },
    phone: resolved.phone || invoice.customer?.phone || null,
    email: resolved.email || invoice.customer?.email || null,
  };
}

function formatInvoiceDateLabel(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function toInvoiceDateInputValue(value?: string | null): string {
  if (!value) return "";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToInvoiceDate(value: string, days: number): string {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayInvoiceDateInputValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type InvoiceAppointmentEntryV17_90L177R = {
  site: string;
  label: string;
  source: string;
};

function normalizeInvoiceAppointmentKeyV17_90L177R(
  value?: string | null,
): string {
  return compactInvoiceValue(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseInvoiceAppointmentLineV17_90L177R(value?: string | null): string {
  const line = compactInvoiceValue(
    String(value || "").replace(/\[(?:HINWEIS|NOTE)\]\s*/gi, ""),
  );
  if (!line) return "";
  if (
    !/\b(?:termin|datum|zeitfenster|appointment|ausführungstermin|ausfuehrungstermin)\b/i.test(
      line,
    )
  ) {
    return "";
  }

  const dateMatch = line.match(
    /\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\b/,
  );
  const lineWithoutDate = dateMatch ? line.replace(dateMatch[0], " ") : line;
  const timeMatches = Array.from(
    lineWithoutDate.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g),
  );
  const times = timeMatches
    .map((match) => `${match[1].padStart(2, "0")}:${match[2]}`)
    .filter((time, index, all) => all.indexOf(time) === index);
  const timeLabel =
    times.length >= 2 ? `${times[0]}–${times[1]}` : times[0] || "";

  if (dateMatch) {
    const day = dateMatch[1].padStart(2, "0");
    const month = dateMatch[2].padStart(2, "0");
    const year = dateMatch[3]
      ? String(dateMatch[3]).length === 2
        ? `20${dateMatch[3]}`
        : String(dateMatch[3])
      : "";
    const dateLabel = year ? `${day}.${month}.${year}` : `${day}.${month}.`;
    return `Termin ${dateLabel}${timeLabel ? ` · ${timeLabel}` : ""}`;
  }

  if (timeLabel) {
    const relativeDate = line.match(
      /\b(?:heute|morgen|übermorgen|uebermorgen|nächsten?\s+(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)|kommenden?\s+(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))\b/i,
    )?.[0];
    return `Termin${relativeDate ? ` ${relativeDate}` : ""} · ${timeLabel}`;
  }

  if (/\b(?:klären|klaeren|offen|absprechen|vereinbaren)\b/i.test(line)) {
    return "Termin klären";
  }

  return "";
}

function splitInvoiceAppointmentSectionsV17_90L177R(
  value?: string | null,
): string[] {
  const source = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!source) return [];

  const sections = source
    .split(
      /\n\s*(?:─{3,}|-{3,})\s*\n|\n\s*(?:Hauptauftrag|Zusammengeführt mit|Zusammengefuehrt mit)\s*:\s*/gi,
    )
    .map((section) => section.trim())
    .filter(Boolean);
  return sections.length > 0 ? sections : [source];
}

function extractInvoiceAppointmentLinesV17_90L177R(
  value?: string | null,
): string[] {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/g)
    .map((line) => compactInvoiceValue(line))
    .filter((line) => Boolean(parseInvoiceAppointmentLineV17_90L177R(line)));
}

function resolveInvoiceAppointmentSiteV17_90L177R(
  order: NonNullable<Invoice["orders"]>[number],
  section: string,
  sectionIndex: number,
): string {
  const workSites = Array.isArray(order?.workSites)
    ? [...order.workSites].sort(
        (a, b) =>
          Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
          Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
      )
    : [];
  const sectionKey = normalizeInvoiceAppointmentKeyV17_90L177R(section);
  const matchingSite = workSites.find((site) => {
    const candidates = [
      site?.siteName,
      site?.siteAddress,
      [site?.sitePlz, site?.siteCity].filter(Boolean).join(" "),
    ]
      .map((value) => normalizeInvoiceAppointmentKeyV17_90L177R(value))
      .filter(Boolean);
    return candidates.some((candidate) => sectionKey.includes(candidate));
  });
  const fallbackSite = matchingSite || workSites[sectionIndex] || workSites[0];
  return (
    compactInvoiceValue(fallbackSite?.siteName) ||
    compactInvoiceValue(fallbackSite?.siteAddress) ||
    compactInvoiceValue(order?.siteName) ||
    compactInvoiceValue(order?.siteAddress) ||
    `Arbeitsort ${sectionIndex + 1}`
  );
}

function collectInvoiceAppointmentEntriesV17_90L177R(
  invoice: Invoice,
): InvoiceAppointmentEntryV17_90L177R[] {
  const entries: InvoiceAppointmentEntryV17_90L177R[] = [];

  const addEntry = (entry: InvoiceAppointmentEntryV17_90L177R) => {
    const labelKey = normalizeInvoiceAppointmentKeyV17_90L177R(entry.label);
    if (!labelKey) return;
    const siteKey = normalizeInvoiceAppointmentKeyV17_90L177R(entry.site);
    const exactIndex = entries.findIndex(
      (current) =>
        normalizeInvoiceAppointmentKeyV17_90L177R(current.label) === labelKey &&
        normalizeInvoiceAppointmentKeyV17_90L177R(current.site) === siteKey,
    );
    if (exactIndex >= 0) {
      if (entry.source.length > entries[exactIndex].source.length) {
        entries[exactIndex] = entry;
      }
      return;
    }

    const looseIndex = entries.findIndex((current) => {
      if (
        normalizeInvoiceAppointmentKeyV17_90L177R(current.label) !== labelKey
      ) {
        return false;
      }
      const currentSite = normalizeInvoiceAppointmentKeyV17_90L177R(
        current.site,
      );
      return !currentSite || !siteKey || /^arbeitsort \d+$/.test(currentSite);
    });
    if (looseIndex >= 0) {
      const current = entries[looseIndex];
      entries[looseIndex] = {
        site:
          /^arbeitsort \d+$/i.test(current.site) &&
          !/^arbeitsort \d+$/i.test(entry.site)
            ? entry.site
            : current.site,
        label: current.label,
        source:
          current.source.length >= entry.source.length
            ? current.source
            : entry.source,
      };
      return;
    }

    entries.push(entry);
  };

  for (const [orderIndex, order] of (invoice.orders || []).entries()) {
    const combinedSource = [
      order?.specialNotes,
      order?.notes,
      order?.description,
    ]
      .filter(Boolean)
      .join("\n");
    const sections = splitInvoiceAppointmentSectionsV17_90L177R(combinedSource);

    sections.forEach((section, sectionIndex) => {
      const site = resolveInvoiceAppointmentSiteV17_90L177R(
        order,
        section,
        sectionIndex,
      );
      for (const line of extractInvoiceAppointmentLinesV17_90L177R(section)) {
        const label = parseInvoiceAppointmentLineV17_90L177R(line);
        if (!label) continue;
        addEntry({ site, label, source: line });
      }
    });

    const directRaw = compactInvoiceValue(order?.date);
    if (directRaw) {
      let directLabel = "";
      const directDate = new Date(directRaw);
      if (!Number.isNaN(directDate.getTime())) {
        const day = String(directDate.getDate()).padStart(2, "0");
        const month = String(directDate.getMonth() + 1).padStart(2, "0");
        const year = directDate.getFullYear();
        const hasTime = /T\d{2}:\d{2}|\s\d{1,2}:\d{2}/.test(directRaw);
        const time = hasTime
          ? directDate.toLocaleTimeString("de-CH", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        directLabel = `Termin ${day}.${month}.${year}${time ? ` · ${time}` : ""}`;
      } else {
        directLabel = parseInvoiceAppointmentLineV17_90L177R(directRaw);
      }
      if (directLabel) {
        addEntry({
          site: resolveInvoiceAppointmentSiteV17_90L177R(
            order,
            combinedSource,
            orderIndex,
          ),
          label: directLabel,
          source: directRaw,
        });
      }
    }
  }

  return entries;
}

function formatInvoiceAppointmentLabel(invoice: Invoice): string {
  const entries = collectInvoiceAppointmentEntriesV17_90L177R(invoice);
  if (entries.length === 0) return "";
  if (entries.length === 1) return entries[0].label;
  return [
    `Termine · ${entries.length}`,
    ...entries.map(
      (entry, index) => `${index + 1}. ${entry.site}: ${entry.label}`,
    ),
  ].join("\n");
}

function InvoiceViewportTooltip({
  children,
  preferredWidth = 420,
  autoClose = true,
  mobileDismissOnInteraction = false,
}: {
  children: any;
  preferredWidth?: number;
  autoClose?: boolean;
  mobileDismissOnInteraction?: boolean;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const openRef = useRef(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const isMobileDismissMode = () =>
    mobileDismissOnInteraction &&
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px)").matches;

  const setTooltipOpen = (nextOpen: boolean) => {
    openRef.current = nextOpen;
    setOpen(nextOpen);
  };
  const clearOpenTimer = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };
  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };
  const clearAutoCloseTimer = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  };
  const closeTooltipImmediately = () => {
    clearOpenTimer();
    clearHideTimer();
    clearAutoCloseTimer();
    setTooltipOpen(false);
  };
  const scheduleAutoClose = () => {
    clearAutoCloseTimer();
    if (!autoClose) return;
    autoCloseTimerRef.current = setTimeout(() => {
      autoCloseTimerRef.current = null;
      setTooltipOpen(false);
    }, 3000);
  };
  const calculatePosition = () => {
    const trigger = anchorRef.current?.parentElement as HTMLElement | null;
    if (!trigger || typeof window === "undefined") return null;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 8;
    const width = Math.max(
      240,
      Math.min(preferredWidth, window.innerWidth - viewportPadding * 2),
    );
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const availableAbove = Math.max(0, rect.top - gap - viewportPadding);
    const availableBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - gap - viewportPadding,
    );
    const minimumUsableTooltipSpace = 120;
    const openBelow =
      availableAbove >= minimumUsableTooltipSpace
        ? false
        : availableBelow >= minimumUsableTooltipSpace
          ? true
          : availableBelow > availableAbove;
    const available = openBelow ? availableBelow : availableAbove;
    const maxHeight = Math.max(1, Math.min(560, available));
    return openBelow
      ? { left, width, maxHeight, top: rect.bottom + gap }
      : {
          left,
          width,
          maxHeight,
          bottom: window.innerHeight - rect.top + gap,
        };
  };
  const closeOtherPopovers = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227));
  };

  const openTooltipImmediately = () => {
    closeOtherPopovers();
    clearOpenTimer();
    clearHideTimer();
    const next = calculatePosition();
    if (next) setPosition(next);
    setTooltipOpen(true);
  };
  const scheduleShowTooltip = () => {
    clearHideTimer();
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      closeOtherPopovers();
      const next = calculatePosition();
      if (next) setPosition(next);
      setTooltipOpen(true);
    }, 300);
  };
  const scheduleHide = () => {
    clearOpenTimer();
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setTooltipOpen(false);
    }, 500);
  };

  useEffect(() => {
    const trigger = anchorRef.current?.parentElement as HTMLElement | null;
    if (!trigger) return;
    const pointerEntered = () => {
      if (isMobileDismissMode()) return;
      scheduleShowTooltip();
    };
    const pointerLeft = () => {
      if (isMobileDismissMode()) return;
      scheduleHide();
    };
    const focused = () => {
      if (isMobileDismissMode()) return;
      openTooltipImmediately();
    };
    const focusOut = (event: FocusEvent) => {
      if (isMobileDismissMode()) return;
      if (!trigger.contains(event.relatedTarget as Node | null)) scheduleHide();
    };
    const clicked = () => {
      if (isMobileDismissMode()) {
        if (openRef.current) {
          closeTooltipImmediately();
          return;
        }
        openTooltipImmediately();
        scheduleAutoClose();
        return;
      }
      if (open) {
        clearAutoCloseTimer();
        setTooltipOpen(false);
        return;
      }
      openTooltipImmediately();
      scheduleAutoClose();
    };
    trigger.addEventListener("pointerenter", pointerEntered);
    trigger.addEventListener("pointerleave", pointerLeft);
    trigger.addEventListener("focusin", focused);
    trigger.addEventListener("focusout", focusOut);
    trigger.addEventListener("click", clicked);
    return () => {
      trigger.removeEventListener("pointerenter", pointerEntered);
      trigger.removeEventListener("pointerleave", pointerLeft);
      trigger.removeEventListener("focusin", focused);
      trigger.removeEventListener("focusout", focusOut);
      trigger.removeEventListener("click", clicked);
      clearOpenTimer();
      clearHideTimer();
    };
  }); // Ohne Dependency-Array: bei jedem Render an den aktuell sichtbaren Parent-Chip neu binden.

  useEffect(
    () => () => {
      clearOpenTimer();
      clearHideTimer();
      clearAutoCloseTimer();
    },
    [],
  );

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!openRef.current) return;
      const target = event.target as Node | null;
      const trigger = anchorRef.current?.parentElement as HTMLElement | null;
      if (target && trigger?.contains(target)) return;
      if (target && tooltipRef.current?.contains(target)) return;
      closeTooltipImmediately();
    };
    const closeFromGlobalEvent = () => closeTooltipImmediately();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227, closeFromGlobalEvent);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227, closeFromGlobalEvent);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (isMobileDismissMode()) {
      const dismissOutside = (event: PointerEvent) => {
        const target = event.target as Node | null;
        const trigger = anchorRef.current?.parentElement as HTMLElement | null;
        if (!target) return;
        if (trigger?.contains(target) || tooltipRef.current?.contains(target)) {
          return;
        }
        closeTooltipImmediately();
      };
      const dismissOnViewportMovement = () => closeTooltipImmediately();

      document.addEventListener("pointerdown", dismissOutside, true);
      window.addEventListener("scroll", dismissOnViewportMovement, true);
      window.addEventListener("touchmove", dismissOnViewportMovement, {
        capture: true,
        passive: true,
      });
      window.addEventListener("resize", dismissOnViewportMovement, {
        passive: true,
      });
      return () => {
        document.removeEventListener("pointerdown", dismissOutside, true);
        window.removeEventListener("scroll", dismissOnViewportMovement, true);
        window.removeEventListener("touchmove", dismissOnViewportMovement, true);
        window.removeEventListener("resize", dismissOnViewportMovement);
      };
    }

    const update = () => {
      const next = calculatePosition();
      if (next) setPosition(next);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, preferredWidth, mobileDismissOnInteraction]);

  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden="true" />
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            onPointerEnter={() => {
              if (isMobileDismissMode()) return;
              clearHideTimer();
              clearAutoCloseTimer();
            }}
            onPointerDown={() => {
              if (isMobileDismissMode()) return;
              clearAutoCloseTimer();
            }}
            onPointerUp={() => {
              if (isMobileDismissMode()) return;
              scheduleAutoClose();
            }}
            onScroll={() => {
              if (isMobileDismissMode()) {
                closeTooltipImmediately();
                return;
              }
              clearAutoCloseTimer();
            }}
            onPointerLeave={() => {
              if (isMobileDismissMode()) return;
              scheduleHide();
            }}
            style={{
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
              top: position.top,
              bottom: position.bottom,
            }}
            className="pointer-events-auto fixed z-[2147483000] isolate opacity-100 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-3 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {children}
          </span>,
          document.body,
        )}
    </>
  );
}

function InvoiceAppointmentTooltipContentV17_90L169({
  text,
}: {
  text: string;
}) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const multiple = /^Termine\s*·\s*\d+/i.test(lines[0] || "");

  if (multiple) {
    const entries = lines.slice(1).map((line, index) => {
      const cleaned = line.replace(/^\d+\.\s*/, "").trim();
      const [sitePart, ...appointmentParts] = cleaned.split(/\s+—\s+/);
      return {
        site:
          appointmentParts.length > 0
            ? sitePart.trim()
            : `Arbeitsort ${index + 1}`,
        appointment:
          appointmentParts.length > 0
            ? appointmentParts.join(" — ").trim()
            : cleaned,
      };
    });

    return (
      <span className="block rounded-xl border border-violet-300 bg-violet-50 p-3 text-slate-950 dark:border-violet-800/70 dark:bg-violet-950/35 dark:text-slate-50">
        <span className="mb-2 flex items-center gap-2 text-sm font-extrabold leading-tight">
          <CalendarDays className="h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" />
          {lines[0]}
        </span>
        <span className="block space-y-2">
          {entries.map((entry, index) => {
            const parts = parseInvoiceAppointmentTooltipV17_90L169(
              entry.appointment,
            );
            return (
              <span
                key={`${entry.site}-${entry.appointment}-${index}`}
                className="block rounded-lg border border-violet-200 bg-white/80 p-2.5 dark:border-violet-800/60 dark:bg-slate-950/25"
              >
                <span className="block break-words text-[12px] font-extrabold leading-tight">
                  {index + 1}. {entry.site}
                </span>
                <span className="mt-1.5 block text-[12px] font-semibold leading-relaxed">
                  {[parts.date, parts.time].filter(Boolean).join(" · ") ||
                    parts.fallback}
                </span>
                {parts.note && (
                  <span className="mt-1 block text-[11px] font-medium leading-relaxed text-slate-600 dark:text-slate-300">
                    {parts.note}
                  </span>
                )}
              </span>
            );
          })}
        </span>
      </span>
    );
  }

  const parts = parseInvoiceAppointmentTooltipV17_90L169(text);
  return (
    <span className="block rounded-xl border border-violet-300 bg-violet-50 p-3 text-slate-950 dark:border-violet-800/70 dark:bg-violet-950/35 dark:text-slate-50">
      <span className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-violet-700 dark:text-violet-300" />
        <span className="min-w-0 flex-1">
          {parts.date ? (
            <span className="block text-lg font-extrabold leading-none tracking-tight">
              {parts.date}
            </span>
          ) : (
            <span className="block text-sm font-extrabold leading-tight">
              Termin
            </span>
          )}
          {parts.time && (
            <span className="mt-1.5 block text-sm font-extrabold leading-tight">
              {parts.time}
            </span>
          )}
          {parts.note && (
            <span className="mt-2 block border-t border-violet-200 pt-2 text-[12px] font-medium leading-relaxed dark:border-violet-800/70">
              {parts.note}
            </span>
          )}
          {!parts.date && !parts.time && !parts.note && (
            <span className="mt-1 block text-[12px] font-semibold leading-relaxed">
              {parts.fallback}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

// V17.90L136: Einheitliche Leistungsdarstellung innen und außen.
function InvoiceServiceReviewSectionsV17_90L135G({
  entries,
}: {
  entries: InvoiceServiceReviewEntry[];
}) {
  const sections = [
    { key: "blocker", title: "Preis / Menge / Einheit prüfen" },
    { key: "deviation", title: "Preis oder Einheit abweichend" },
    { key: "missing", title: "Nicht im Leistungskatalog" },
  ] as const;
  return (
    <span className="block text-left font-normal">
      {sections.map((section, sectionIndex) => {
        const sectionItems = entries.filter(
          (entry) => entry.category === section.key,
        );
        if (sectionItems.length === 0) return null;
        const hasPreviousVisibleSection = sections
          .slice(0, sectionIndex)
          .some((candidate) =>
            entries.some((entry) => entry.category === candidate.key),
          );
        return (
          <span
            key={section.key}
            className={`block ${hasPreviousVisibleSection ? "mt-3 border-t border-slate-200 pt-2 dark:border-slate-700" : ""}`}
          >
            <span className="mb-1.5 block font-bold text-slate-950 dark:text-slate-50">
              {section.title}
            </span>
            {sectionItems.map((entry, reviewIndex) => (
              <span
                key={`${entry.description}-${reviewIndex}`}
                className={`block ${reviewIndex > 0 ? "mt-2" : ""}`}
              >
                <span className="block break-words font-bold text-foreground">
                  * {entry.description}
                </span>
                {entry.details.map((detail, detailIndex) => {
                  const trimmedDetail = detail.trim();
                  const isCurrentPrice = /^(?:Aktuell|Berechnung):/i.test(
                    trimmedDetail,
                  );
                  const isCatalogPrice = /^Katalogpreis:/i.test(trimmedDetail);
                  return (
                    <span
                      key={`${entry.description}-${detailIndex}`}
                      className={`block break-words text-xs ${
                        isCurrentPrice
                          ? "font-bold text-slate-950 dark:text-slate-50"
                          : isCatalogPrice
                            ? "font-normal text-slate-500 dark:text-slate-400"
                            : "text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {detail}
                    </span>
                  );
                })}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

function InvoiceServiceDisplaySectionsV17_90L136({
  entries,
}: {
  entries: InvoiceServiceDisplayEntry[];
}) {
  const sections = [
    { key: "blocker", title: "Preis / Menge / Einheit prüfen" },
    { key: "deviation", title: "Preis oder Einheit abweichend" },
    { key: "missing", title: "Nicht im Leistungskatalog" },
    { key: "catalog", title: "Im Leistungskatalog" },
  ] as const;

  return (
    <span className="block text-left font-normal">
      {sections.map((section, sectionIndex) => {
        const sectionItems = entries.filter(
          (entry) => entry.category === section.key,
        );
        if (sectionItems.length === 0) return null;
        const visibleSectionIndex = sections
          .slice(0, sectionIndex)
          .some((candidate) =>
            entries.some((entry) => entry.category === candidate.key),
          );
        return (
          <span
            key={section.key}
            className={`block ${
              visibleSectionIndex
                ? "mt-3 border-t border-slate-200 pt-2 dark:border-slate-700"
                : ""
            }`}
          >
            <span className="mb-1.5 block font-bold text-slate-950 dark:text-slate-50">
              {section.title}
            </span>
            {sectionItems.map((entry, itemIndex) => (
              <span
                key={`${entry.description}-${itemIndex}`}
                className={`block ${itemIndex > 0 ? "mt-2" : ""}`}
              >
                <span className="block break-words font-bold text-foreground">
                  * {entry.description}
                </span>
                {entry.details.map((detail, detailIndex) => {
                  const trimmedDetail = detail.trim();
                  const isCurrentPrice = /^(?:Aktuell|Berechnung):/i.test(
                    trimmedDetail,
                  );
                  const isCatalogPrice = /^Katalogpreis:/i.test(trimmedDetail);
                  return (
                    <span
                      key={`${entry.description}-${detailIndex}`}
                      className={`block break-words text-xs ${
                        isCurrentPrice
                          ? "font-bold text-slate-950 dark:text-slate-50"
                          : isCatalogPrice
                            ? "font-normal text-slate-500 dark:text-slate-400"
                            : "text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {detail}
                    </span>
                  );
                })}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

function InvoiceServiceDisplayTooltipContentV17_90L136({
  total,
  entries,
  siteGroups = [],
}: {
  total: number;
  entries: InvoiceServiceDisplayEntry[];
  siteGroups?: InvoiceServiceDisplaySiteGroup[];
}) {
  const [activeSiteKey, setActiveSiteKey] = useState<string | null>(null);
  const multipleSites = siteGroups.length > 1;

  return (
    <span className="block text-left font-normal">
      <span className="mb-2 block text-sm font-bold text-slate-950 dark:text-slate-50">
        Leistungen · {total}
      </span>
      {multipleSites ? (
        <span className="block space-y-2">
          {siteGroups.map((group, index) => {
            const active = activeSiteKey === group.key;
            const address =
              [
                group.site?.siteAddress,
                [group.site?.sitePlz, group.site?.siteCity]
                  .filter(Boolean)
                  .join(" "),
              ]
                .filter(Boolean)
                .join(" · ") || "Adresse nicht angegeben";
            return (
              <span
                key={group.key}
                role="button"
                tabIndex={0}
                onPointerEnter={() => setActiveSiteKey(group.key)}
                onFocus={() => setActiveSiteKey(group.key)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setActiveSiteKey((current) =>
                    current === group.key ? null : group.key,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setActiveSiteKey((current) =>
                    current === group.key ? null : group.key,
                  );
                }}
                className={`block cursor-pointer overflow-hidden rounded-lg border bg-white outline-none dark:bg-slate-900 ${
                  active
                    ? "border-cyan-300 dark:border-cyan-800"
                    : "border-slate-200 hover:border-cyan-200 dark:border-slate-700"
                }`}
              >
                <span
                  className={`flex items-start justify-between gap-3 p-2 ${
                    active
                      ? "bg-cyan-50 dark:bg-cyan-950/30"
                      : "bg-slate-50 hover:bg-cyan-50/60 dark:bg-slate-900"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-bold text-slate-950 dark:text-slate-50">
                      {index + 1}.{" "}
                      {group.site?.siteName ||
                        group.site?.siteAddress ||
                        `Ausführungsort ${index + 1}`}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-slate-600 dark:text-slate-300">
                      {address}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                    Leistungen · {group.entries.length}
                  </span>
                </span>
                {active && (
                  <span className="block border-t border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900/60 dark:bg-amber-950/15">
                    <InvoiceServiceDisplaySectionsV17_90L136
                      entries={group.entries}
                    />
                  </span>
                )}
              </span>
            );
          })}
        </span>
      ) : (
        <InvoiceServiceDisplaySectionsV17_90L136 entries={entries} />
      )}
    </span>
  );
}

function InvoiceServiceReviewTooltipContentV17_90L135G({
  total,
  entries,
  siteGroups = [],
  title,
}: {
  total: number;
  entries: InvoiceServiceReviewEntry[];
  siteGroups?: InvoiceServiceReviewSiteGroup[];
  title?: string;
}) {
  const [activeSiteKey, setActiveSiteKey] = useState<string | null>(null);
  const multipleSites = siteGroups.length > 1;
  return (
    <span className="block text-left font-normal">
      <span className="mb-2 block text-sm font-bold text-slate-950 dark:text-slate-50">
        {title || `Leistungen prüfen · ${total}`}
      </span>
      {multipleSites ? (
        <span className="block space-y-2">
          {siteGroups.map((group, index) => {
            const active = activeSiteKey === group.key;
            const address =
              [
                group.site?.siteAddress,
                [group.site?.sitePlz, group.site?.siteCity]
                  .filter(Boolean)
                  .join(" "),
              ]
                .filter(Boolean)
                .join(" · ") || "Adresse nicht angegeben";
            return (
              <span
                key={group.key}
                role="button"
                tabIndex={0}
                onPointerEnter={() => setActiveSiteKey(group.key)}
                onFocus={() => setActiveSiteKey(group.key)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setActiveSiteKey((current) =>
                    current === group.key ? null : group.key,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setActiveSiteKey((current) =>
                    current === group.key ? null : group.key,
                  );
                }}
                className={`block cursor-pointer overflow-hidden rounded-lg border bg-white outline-none dark:bg-slate-900 ${
                  active
                    ? "border-cyan-300 dark:border-cyan-800"
                    : "border-slate-200 hover:border-cyan-200 dark:border-slate-700"
                }`}
              >
                <span
                  className={`flex items-start justify-between gap-3 p-2 ${
                    active
                      ? "bg-cyan-50 dark:bg-cyan-950/30"
                      : "bg-slate-50 hover:bg-cyan-50/60 dark:bg-slate-900"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-bold text-slate-950 dark:text-slate-50">
                      {index + 1}.{" "}
                      {group.site?.siteName ||
                        group.site?.siteAddress ||
                        `Ausführungsort ${index + 1}`}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-slate-600 dark:text-slate-300">
                      {address}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                    Leistungen prüfen · {group.entries.length}
                  </span>
                </span>
                {active && (
                  <span className="block border-t border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900/60 dark:bg-amber-950/15">
                    <InvoiceServiceReviewSectionsV17_90L135G
                      entries={group.entries}
                    />
                  </span>
                )}
              </span>
            );
          })}
        </span>
      ) : (
        <InvoiceServiceReviewSectionsV17_90L135G entries={entries} />
      )}
    </span>
  );
}

type InvoiceMobileServiceSheetStateV17_90L174 = {
  title: string;
  entries: InvoiceServiceReviewEntry[];
  siteGroups: InvoiceServiceReviewSiteGroup[];
};

function InvoiceMobileServiceReviewSheetV17_90L174({
  state,
  onClose,
}: {
  state: InvoiceMobileServiceSheetStateV17_90L174;
  onClose: () => void;
}) {
  const [activeSiteKey, setActiveSiteKey] = useState<string | null>(null);
  const multipleSites = state.siteGroups.length > 1;

  return (
    <div className="fixed inset-0 z-[12000]">
      <button
        type="button"
        aria-label="Leistungsübersicht schließen"
        className="absolute inset-0 bg-black/25 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        className="fixed left-3 right-3 top-1/2 flex max-h-[82vh] min-h-0 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left text-[13px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:left-1/2 sm:right-auto sm:w-[min(34rem,calc(100vw-2rem))] sm:-translate-x-1/2"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="min-w-0 truncate text-base font-bold text-slate-950 dark:text-slate-50">
            {state.title}
          </div>
          <button
            type="button"
            aria-label="Leistungsübersicht schließen"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 py-3 pb-5">
          {multipleSites ? (
            <div className="space-y-2">
              {state.siteGroups.map((group, groupIndex) => {
                const active = activeSiteKey === group.key;
                const address =
                  [
                    group.site?.siteAddress,
                    [group.site?.sitePlz, group.site?.siteCity]
                      .filter(Boolean)
                      .join(" "),
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Adresse nicht angegeben";
                return (
                  <div
                    key={`invoice_mobile_group_${group.key}`}
                    className={`overflow-hidden rounded-xl border ${
                      active
                        ? "border-cyan-300"
                        : "border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <button
                      type="button"
                      className={`flex w-full items-start justify-between gap-3 p-3 text-left ${
                        active
                          ? "bg-cyan-50 dark:bg-cyan-950/30"
                          : "bg-slate-50 dark:bg-slate-800/60"
                      }`}
                      onClick={() =>
                        setActiveSiteKey((current) =>
                          current === group.key ? null : group.key,
                        )
                      }
                    >
                      <span className="min-w-0">
                        <span className="block break-words font-bold text-slate-950 dark:text-slate-50">
                          {groupIndex + 1}.{" "}
                          {group.site?.siteName ||
                            group.site?.siteAddress ||
                            `Ausführungsort ${groupIndex + 1}`}
                        </span>
                        <span className="mt-0.5 block break-words text-[11px] text-slate-600 dark:text-slate-300">
                          {address}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900">
                        Leistungen prüfen · {group.entries.length}
                      </span>
                    </button>
                    {active && (
                      <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                        <InvoiceServiceReviewSectionsV17_90L135G
                          entries={group.entries}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <InvoiceServiceReviewSectionsV17_90L135G entries={state.entries} />
          )}
        </div>
      </div>
    </div>
  );
}

function InvoiceExecutionSitesTooltip({
  sites,
}: {
  sites: InvoiceExecutionSite[];
}) {
  if (sites.length === 0) return null;
  return (
    <InvoiceViewportTooltip>
      <span className="mb-2 flex items-center gap-1.5 text-sm font-bold text-sky-800 dark:text-sky-200">
        <MapPin className="h-4 w-4" />
        {sites.length > 1
          ? `Ausführungsorte · ${sites.length}`
          : "Ausführungsadresse"}
      </span>
      <span className="block space-y-2">
        {sites.map((site, siteIndex) => (
          <span
            key={`invoice_execution_tooltip_${siteIndex}`}
            className={`block ${
              siteIndex > 0
                ? "border-t border-sky-100 pt-2 dark:border-slate-700"
                : ""
            }`}
          >
            {sites.length > 1 && (
              <span className="mb-1 block font-bold text-slate-950 dark:text-slate-50">
                Arbeitsort {siteIndex + 1}
              </span>
            )}
            <span className="grid grid-cols-[76px_1fr] gap-x-2 gap-y-1.5">
              {site.siteName && (
                <>
                  <span className="text-muted-foreground">Objekt:</span>
                  <span className="break-words font-bold text-slate-950 dark:text-slate-50">
                    {site.siteName}
                  </span>
                </>
              )}
              <span className="text-muted-foreground">Strasse:</span>
              <span className="break-words">{site.siteAddress || "–"}</span>
              <span className="text-muted-foreground">PLZ / Ort:</span>
              <span className="break-words">
                {[site.sitePlz, site.siteCity].filter(Boolean).join(" ") || "–"}
              </span>
              {site.siteNote && (
                <>
                  <span className="text-muted-foreground">Hinweis:</span>
                  <span className="break-words">{site.siteNote}</span>
                </>
              )}
            </span>
          </span>
        ))}
      </span>
    </InvoiceViewportTooltip>
  );
}

const statusColors: Record<string, string> = {
  Entwurf: "bg-gray-100 text-gray-800",
  Gesendet: "bg-blue-100 text-blue-800",
  Überfällig: "bg-red-100 text-red-800",
  Bezahlt: "bg-green-100 text-green-800",
};

// Native <select> elements can keep the previously painted background in
// Chromium when a compact card is collapsed. Inline colors are used in
// addition to the Tailwind classes so the closed control always reflects the
// currently selected invoice status.
const statusInlineStyles = {
  Entwurf: {
    backgroundColor: "#f3f4f6",
    color: "#1f2937",
    borderColor: "#d1d5db",
  },
  Gesendet: {
    backgroundColor: "#dbeafe",
    color: "#1e40af",
    borderColor: "#93c5fd",
  },
  Überfällig: {
    backgroundColor: "#fee2e2",
    color: "#991b1b",
    borderColor: "#fca5a5",
  },
  Bezahlt: {
    backgroundColor: "#dcfce7",
    color: "#166534",
    borderColor: "#86efac",
  },
} as const;

const getInvoiceStatusInlineStyle = (status: string) =>
  statusInlineStyles[status as keyof typeof statusInlineStyles] ||
  statusInlineStyles.Entwurf;

// Invoice statuses shown in the dropdown.
// Order matters: Entwurf → Gesendet → Überfällig → Bezahlt reflects the
// real-world lifecycle.
const invoiceStatuses = ["Entwurf", "Gesendet", "Überfällig", "Bezahlt"];

/**
 * Effective status for display purposes.
 *
 * Shows "Überfällig" automatically when:
 *   - stored status is "Gesendet"
 *   - a due date exists
 *   - the due date is strictly in the past (< today, local date)
 *
 * Safety rails:
 *   - "Entwurf"  → never auto-overdue
 *   - "Bezahlt"  → never auto-overdue
 *   - no dueDate → never auto-overdue
 *   - manually-set "Überfällig" is always preserved
 *
 * This is a DISPLAY-ONLY derivation — the stored DB value is not mutated
 * unless the user explicitly picks "Überfällig" in the dropdown. This
 * keeps automatic detection safe and reversible.
 */
function getEffectiveInvoiceStatus(inv: {
  status?: string | null;
  dueDate?: string | null;
}): string {
  const raw = (inv?.status ?? "").trim();
  if (raw !== "Gesendet") return raw || "Entwurf";
  const due = inv?.dueDate ? new Date(inv.dueDate) : null;
  if (!due || isNaN(due.getTime())) return raw;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  return dueDay.getTime() < today.getTime() ? "Überfällig" : raw;
}

export default function RechnungenPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState("Alle");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name" | "amount">(
    "newest",
  );
  const [visibleCount, setVisibleCount] = useState(30);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editingInvoiceCustomer, setEditingInvoiceCustomer] =
    useState<Customer | null>(null);
  const initialInvoiceDate = getTodayInvoiceDateInputValue();
  const [defaultPaymentDays, setDefaultPaymentDays] = useState(14);
  const [form, setForm] = useState({
    customerId: "",
    invoiceDate: initialInvoiceDate,
    dueDate: addDaysToInvoiceDate(initialInvoiceDate, 14),
    paymentDays: "14",
    pdfTitle: "",
    notes: "",
    orderIds: [] as string[],
  });
  const historicalInvoiceCustomerLocked = Boolean(
    editingInvoice && isHistoricalInvoiceStatus(editingInvoice.status),
  );
  const dialogInvoiceCustomer =
    historicalInvoiceCustomerLocked && editingInvoiceCustomer
      ? editingInvoiceCustomer
      : form.customerId
        ? customers.find((customer) => customer.id === form.customerId) || null
        : null;
  const getEmptyItem = (): InvoiceItem => ({
    description: "",
    quantity: "",
    unit: "",
    unitPrice: "",
  });

  const [items, setItems] = useState<InvoiceItem[]>([getEmptyItem()]);
  const [expandedItemIndex, setExpandedItemIndex] = useState<number | null>(
    null,
  );
  const [serviceActionMenuIndex, setServiceActionMenuIndex] = useState<
    number | null
  >(null);
  const [editingExecutionAddress, setEditingExecutionAddress] = useState(false);
  const [executionAddressEditSnapshot, setExecutionAddressEditSnapshot] =
    useState("");
  const [expandedInvoiceSiteKeys, setExpandedInvoiceSiteKeys] = useState<
    Set<string>
  >(new Set());
  const [newInvoiceItemSiteKey, setNewInvoiceItemSiteKey] =
    useState<string>("");
  const [expandedInvoiceCardIds, setExpandedInvoiceCardIds] = useState<
    Set<string>
  >(new Set());
  const [invoiceCardExpansionRestored, setInvoiceCardExpansionRestored] =
    useState(false);
  const [invoiceCardInitialStateApplied, setInvoiceCardInitialStateApplied] =
    useState(false);
  const [expandedInvoiceServiceCardIds, setExpandedInvoiceServiceCardIds] =
    useState<Set<string>>(new Set());
  const [invoiceServiceOverviewOpen, setInvoiceServiceOverviewOpen] =
    useState(false);
  const [activeInvoiceServiceSheet, setActiveInvoiceServiceSheet] =
    useState<InvoiceMobileServiceSheetStateV17_90L174 | null>(null);
  const [useTouchChipPopovers, setUseTouchChipPopovers] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setUseTouchChipPopovers(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    setInvoiceServiceOverviewOpen(false);
  }, [dialogOpen, editingInvoice?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let restored = false;
    try {
      const stored = window.localStorage.getItem(
        "smartflow:rechnungen:expanded-card-ids:v1",
      );
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setExpandedInvoiceCardIds(
            new Set(
              parsed.filter(
                (value: unknown): value is string => typeof value === "string",
              ),
            ),
          );
          restored = true;
        }
      }
    } catch {
      window.localStorage.removeItem(
        "smartflow:rechnungen:expanded-card-ids:v1",
      );
    }
    setInvoiceCardInitialStateApplied(restored);
    setInvoiceCardExpansionRestored(true);
  }, []);
  const [editingInvoiceSiteKey, setEditingInvoiceSiteKey] = useState<
    string | null
  >(null);
  const [newInvoiceExecutionSite, setNewInvoiceExecutionSite] =
    useState<InvoiceExecutionSite | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingExecutionAddress) return;
    const currentSite = editingInvoice
      ? collectInvoiceExecutionSites({
          items,
          orders: editingInvoice?.orders || [],
        })[0] || null
      : newInvoiceExecutionSite;
    setExecutionAddressEditSnapshot(
      serializeInvoiceExecutionSiteForEdit(currentSite),
    );
    // Snapshot only when the editor changes from closed to open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingExecutionAddress]);

  useEffect(() => {
    if (serviceActionMenuIndex === null) return;
    const closeMenu = () => setServiceActionMenuIndex(null);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [serviceActionMenuIndex]);
  const [downloading, setDownloading] = useState<string | null>(null);
  // Native action menus avoid a full invoice-list render on open/close.
  const [vatRate, setVatRate] = useState(8.1);
  const [defaultVatRate, setDefaultVatRate] = useState(8.1);
  const [currency, setCurrency] = useState<"CHF" | "EUR">("CHF");
  // Stage M.2: Business WhatsApp intake number used as recipient for
  // "PDF an WhatsApp senden". NEVER use Customer.phone for this feature.
  const [businessWhatsappNumber, setBusinessWhatsappNumber] = useState<
    string | null
  >(null);
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [editOrderCtx, setEditOrderCtx] = useState<any>(null);
  const resolveS3Url = async (cloudPath: string) => {
    const res = await fetch("/api/upload/media-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cloud_storage_path: cloudPath, isPublic: false }),
    });
    const data = await res.json();
    return data.url as string;
  };
  const openMedia = async (cloudPath: string, type: string) => {
    try {
      setMediaType(type);
      setMediaDialogOpen(true);
      const url = await resolveS3Url(cloudPath);
      setMediaUrl(url);
    } catch {
      toast.error("Medien konnten nicht geladen werden");
    }
  };
  const openImageGallery = async (cloudPaths: string[]) => {
    if (!cloudPaths.length) return;
    setGalleryUrls([]);
    setGalleryIdx(0);
    setMediaType("image");
    setMediaDialogOpen(true);
    const urls = await Promise.all(cloudPaths.map((p) => resolveS3Url(p)));
    setGalleryUrls(urls);
  };

  // Linked order data (for communication block)
  const [linkedOrderData, setLinkedOrderData] = useState<{
    notes?: string | null;
    specialNotes?: string | null;
    needsReview?: boolean;
    mediaUrl?: string | null;
    mediaType?: string | null;
    imageUrls?: string[];
    thumbnailUrls?: string[];
    audioTranscript?: string | null;
    audioDurationSec?: number | null;
    audioTranscriptionStatus?: string | null;
    hinweisLevel?: string | null;
    description?: string | null;
  } | null>(null);

  // Auto-fill customer data from order notes when dialog opens
  const autoFillCustomer = async (customerId: string) => {
    if (!customerId) return;
    try {
      const res = await fetch(`/api/customers/${customerId}/auto-fill`, {
        method: "POST",
      });
      if (res.ok) {
        const updated = await res.json();
        setCustomers((prev) => {
          const exists = prev.some((c) => c.id === updated.id);
          if (exists)
            return prev.map((c) =>
              c.id === updated.id ? { ...c, ...updated } : c,
            );
          return [...prev, updated];
        });
      }
    } catch {}
  };

  // Block D: open the "Kunde bearbeiten" sheet for the currently-selected customer.
  // Used both by the inline ✏️ button and by clicking the customer summary box.
  // Optional `customerIdOverride` lets callers (e.g. the list-card chip
  // shortcut) pass a customer id directly without first relying on the
  // form state being flushed (useful when called immediately after
  // `openEditInvoice()` because React state updates batch).
  // Optional `noteOverride` is the linked-order's notes used for merge.
  const openCustomerEditor = async (
    customerIdOverride?: string,
    noteOverride?: string | null,
  ) => {
    if (historicalInvoiceCustomerLocked) {
      toast.error(
        "Gesendete, bezahlte oder archivierte Rechnungen behalten den historischen Kundenstand. Setze die Rechnung zuerst auf Entwurf.",
      );
      return;
    }
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
      const noteSource =
        noteOverride !== undefined ? noteOverride : linkedOrderData?.notes;
      // Use blank form as merge base — prevents stale data from previously viewed records leaking in
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

  // New/edit customer inline
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
  const [dupCheckOpen, setDupCheckOpen] = useState(false);

  // Stage E (deterministic chip flow): pending customerId waiting for the
  // dialog to mount before opening the customer-edit section. Set by the chip
  // shortcut in list cards via openEditInvoice({openCustomerSection:true}).
  const [pendingOpenCustomerEditor, setPendingOpenCustomerEditor] = useState<
    string | null
  >(null);
  const customerEditorRef = useRef<HTMLDivElement | null>(null);
  const serviceItemsRef = useRef<HTMLDivElement | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);

  // Android/browser back: close the edit dialog FIRST instead of jumping to the
  // previously visited module. Safe version — see lib/use-dialog-back-guard.ts.
  useDialogBackGuard(dialogOpen, () => {
    setDialogOpen(false);
    setEditingInvoice(null);
  });

  // Save customer (update or create — merge goes via Sheet)
  const saveCustomer = async () => {
    if (historicalInvoiceCustomerLocked) {
      toast.error(
        "Historische Rechnungsdaten können nicht über dieses Dokument geändert werden. Setze die Rechnung zuerst auf Entwurf.",
      );
      return;
    }
    if (!newCust.name.trim()) {
      toast.error("Name erforderlich");
      return;
    }
    setSavingCust(true);
    try {
      if (editingCustomer && form.customerId) {
        // Phase 2f: compute fieldsToClear = fields user intentionally emptied.
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
        const res = await fetch(`/api/customers/${form.customerId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...newCust, fieldsToClear }),
        });
        if (res.ok) {
          const updated = await res.json();
          setCustomers((prev) => {
            const e = prev.some((c) => c.id === updated.id);
            return e
              ? prev.map((c) =>
                  c.id === updated.id ? { ...c, ...updated } : c,
                )
              : [...prev, updated];
          });
          // Also update nested customer in invoices so list/cards refresh immediately
          setInvoices((prev) =>
            prev.map((inv) =>
              inv.customerId === updated.id &&
              !isHistoricalInvoiceStatus(inv.status)
                ? { ...inv, customer: { ...inv.customer, ...updated } }
                : inv,
            ),
          );
          setForm((f) => ({ ...f, customerId: updated.id }));
          toast.success(`Kunde "${updated.name}" aktualisiert!`);
        } else {
          const err = await res.json().catch(() => ({}) as any);
          if (err?.reason === "would_clear_existing_value")
            toast.error(err?.error || "Feld kann nicht geleert werden.");
          else toast.error("Fehler beim Aktualisieren");
          return;
        }
      } else {
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

  const load = async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    const paymentTermsPromise = fetch("/api/settings/invoice-payment-terms", {
      cache: "no-store",
    })
      .then(async (response) =>
        response.ok ? await response.json() : { paymentDays: 14 },
      )
      .catch(() => ({ paymentDays: 14 }));
    const {
      results: [inv, cust, ord, svc, settings],
      errors,
    } = await fetchAllJSON<[any[], any[], any[], any[], any]>([
      { url: "/api/invoices", fallback: [] },
      { url: "/api/customers", fallback: [] },
      { url: "/api/orders?status=Erledigt", fallback: [] },
      { url: "/api/services", fallback: [] },
      { url: "/api/settings", fallback: null },
    ]);
    const paymentTerms = await paymentTermsPromise;
    // If most critical endpoints failed, show error state
    if (errors.length >= 2) {
      if (!silent) {
        setLoadError(errors);
        setLoading(false);
      }
      return;
    }
    // Filter out "Erledigt" invoices (they go to archiv)
    setInvoices((inv ?? []).filter((i: Invoice) => i.status !== "Erledigt"));
    // Merge customers from invoices/orders (they may be soft-deleted)
    const custMap = new Map<string, any>();
    (cust ?? []).forEach((c: any) => custMap.set(c.id, c));
    (inv ?? []).forEach((i: any) => {
      if (i.customer && !custMap.has(i.customer.id))
        custMap.set(i.customer.id, i.customer);
    });
    (ord ?? []).forEach((o: any) => {
      if (o.customer && !custMap.has(o.customer.id))
        custMap.set(o.customer.id, o.customer);
    });
    setCustomers(Array.from(custMap.values()) as any);
    setOrders(ord ?? []);
    setServices(svc ?? []);
    const loadedPaymentDays = Number(paymentTerms?.paymentDays);
    setDefaultPaymentDays(
      Number.isInteger(loadedPaymentDays) &&
        loadedPaymentDays >= 1 &&
        loadedPaymentDays <= 365
        ? loadedPaymentDays
        : 14,
    );
    // Set default VAT rate from settings
    if (settings) {
      setCurrency(settings.currency === "EUR" ? "EUR" : "CHF");
      if (settings.mwstAktiv && settings.mwstSatz != null) {
        setDefaultVatRate(Number(settings.mwstSatz));
      } else if (settings.mwstAktiv === false) {
        setDefaultVatRate(0);
      }
      // Stage M.3: resolve the BUSINESS WhatsApp recipient for
      // "PDF an WhatsApp senden". The PDF goes to the business owner's
      // own inbox so they can review/forward.
      //   1) Prefer the dedicated `whatsappIntakeNumber` (if explicitly
      //      configured by the user).
      //   2) Fall back to `telefon` — the PRIMARY business number that
      //      the inbound WhatsApp/Twilio webhook (lib/phone-resolver.ts)
      //      already matches against. If inbound works, this number is
      //      WhatsApp-capable by definition.
      //   STRICT: NEVER fall back to `telefon2` (second number); NEVER
      //   use Customer.phone.
      setBusinessWhatsappNumber(
        settings.whatsappIntakeNumber || settings.telefon || null,
      );
      if (settings.whatsappEnabled === false) setWhatsappEnabled(false);
    }
    if (errors.length > 0)
      toast.error("Einige Daten konnten nicht vollständig geladen werden");
    if (!silent) setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const refreshVisibleList = () => {
      // Background refreshes must not replace the complete list with the
      // loading screen. That caused a visible flash on the first click after
      // returning to this browser tab.
      if (!dialogOpen) void load({ silent: true });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshVisibleList();
    };
    window.addEventListener("focus", refreshVisibleList);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshVisibleList);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen]);

  // editId logic removed — flow buttons now redirect to list only

  // Close native action menus on outside click without touching React state.
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      document
        .querySelectorAll<HTMLDetailsElement>(
          "details[data-invoice-action-menu][open]",
        )
        .forEach((menu) => {
          if (!target || !menu.contains(target)) menu.open = false;
        });
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);
  useEffect(() => {
    if (
      searchParams?.get("new") === "1" &&
      searchParams?.get("fromOffer") !== "1"
    ) {
      setItems([getEmptyItem()]);
      setDialogOpen(true);
    }
    // Handle fromOffer: fetch offer's linked order data
    if (searchParams?.get("fromOffer") === "1") {
      const customerId = searchParams.get("customerId") ?? "";
      const offerId = searchParams.get("offerId") ?? "";
      setForm((f) => ({ ...f, customerId }));
      const itemsJson = searchParams.get("items");
      if (itemsJson) {
        try {
          const parsed = JSON.parse(itemsJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setItems(
              parsed.map((item: any) => ({
                description: item.serviceName || item.description || "",
                quantity: String(item.quantity ?? 0),
                unit: item.unit ?? "Stunde",
                unitPrice: String(item.unitPrice ?? 0),
                siteName: item.siteName || item.workSite?.siteName || null,
                siteAddress:
                  item.siteAddress || item.workSite?.siteAddress || null,
                sitePlz: item.sitePlz || item.workSite?.sitePlz || null,
                siteCity: item.siteCity || item.workSite?.siteCity || null,
                siteNote: item.siteNote || item.workSite?.siteNote || null,
                sourceOrderId: item.sourceOrderId || null,
              })),
            );
          }
        } catch {}
      }
      if (offerId) {
        fetch(`/api/offers/${offerId}`)
          .then((r) => r.json())
          .then((offer) => {
            const lo = offer?.orders?.[0];
            if (lo)
              setLinkedOrderData({
                notes: lo.notes,
                specialNotes: lo.specialNotes,
                needsReview: lo.needsReview,
                mediaUrl: lo.mediaUrl,
                mediaType: lo.mediaType,
                imageUrls: lo.imageUrls,
                thumbnailUrls: lo.thumbnailUrls,
                audioTranscript: lo.audioTranscript,
                audioDurationSec: lo.audioDurationSec,
                audioTranscriptionStatus: lo.audioTranscriptionStatus,
                hinweisLevel: lo.hinweisLevel,
                description: lo.description,
              });
            if (offer?.orders?.length)
              setEditOrderCtx(resolveCommunicationData(null, offer.orders));
          })
          .catch(() => {});
      }
      // Auto-fill: extract missing customer data from notes and update DB
      if (customerId) autoFillCustomer(customerId);
      setDialogOpen(true);
    }
    // fromOrder auto-open removed — small dropdown now creates directly via API
  }, [searchParams]);

  // Package F: Auto-open edit dialog when landing with ?edit=<invoiceId>.
  // Fetches the exact target invoice by id via /api/invoices/<id> — so direct-open
  // from customer detail is reliable and never shows an unrelated filtered list.
  // Works even for Erledigt invoices (though customer detail currently prefers
  // routing those to /archiv for context).
  useEffect(() => {
    const editId = searchParams?.get("edit");
    if (!editId || dialogOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invoices/${editId}`);
        if (cancelled) return;
        if (!res.ok) {
          toast.error(
            res.status === 404
              ? "Rechnung nicht gefunden"
              : "Fehler beim Öffnen",
          );
          router.replace("/rechnungen", { scroll: false });
          return;
        }
        const inv = await res.json();
        if (cancelled) return;
        openEditInvoice(inv);
        router.replace("/rechnungen", { scroll: false });
      } catch {
        if (!cancelled) {
          toast.error("Fehler beim Öffnen");
          router.replace("/rechnungen", { scroll: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openNewInvoice = () => {
    const invoiceDate = getTodayInvoiceDateInputValue();
    setEditingInvoice(null);
    setEditingInvoiceCustomer(null);
    setVatRate(defaultVatRate);
    setCurrency(currency === "EUR" ? "EUR" : "CHF");
    setForm({
      customerId: "",
      invoiceDate,
      dueDate: addDaysToInvoiceDate(invoiceDate, defaultPaymentDays),
      paymentDays: String(defaultPaymentDays),
      pdfTitle: "",
      notes: "",
      orderIds: [],
    });
    setItems([getEmptyItem()]);
    setExpandedItemIndex(null);
    setServiceActionMenuIndex(null);
    setEditingExecutionAddress(false);
    setExpandedInvoiceSiteKeys(new Set());
    setEditingInvoiceSiteKey(null);
    setNewInvoiceItemSiteKey("");
    setNewInvoiceExecutionSite(null);
    setLinkedOrderData(null);
    setEditOrderCtx(null);
    setShowNewCustomer(false);
    setEditingCustomer(false);
    setDialogOpen(true);
  };

  /**
   * Opens the invoice edit dialog. With `opts.openCustomerSection: true`
   * the customer-edit panel is auto-expanded with fresh customer data —
   * used by the list-card "Kundendaten unvollständig" chip so the user
   * lands directly inside the editor with one tap.
   */
  const openEditInvoice = (
    inv: Invoice,
    opts?: {
      openCustomerSection?: boolean;
      focusStatus?: boolean;
      focusItems?: boolean;
    },
  ) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227));
    }
    setActiveInvoiceServiceSheet(null);
    setEditingInvoice(inv);
    setEditingInvoiceCustomer(inv.customer ? { ...inv.customer } : null);
    setDupCheckOpen(false);
    // Reset customer form to prevent stale data leaking between records
    setNewCust({
      name: "",
      phone: "",
      email: "",
      address: "",
      plz: "",
      city: "",
      country: "CH",
    });
    setVatRate(inv.vatRate != null ? Number(inv.vatRate) : defaultVatRate);
    setCurrency(inv.currency === "EUR" ? "EUR" : "CHF");
    // Set linked order data for Original-Nachricht / Besonderheiten
    const lo = inv.orders?.[0];
    if (lo)
      setLinkedOrderData({
        notes: lo.notes,
        specialNotes: lo.specialNotes,
        needsReview: lo.needsReview,
        mediaUrl: lo.mediaUrl,
        mediaType: lo.mediaType,
        imageUrls: lo.imageUrls,
        thumbnailUrls: lo.thumbnailUrls,
        audioTranscript: lo.audioTranscript,
        audioDurationSec: lo.audioDurationSec,
        audioTranscriptionStatus: lo.audioTranscriptionStatus,
        hinweisLevel: lo.hinweisLevel,
        description: lo.description,
      });
    else setLinkedOrderData(null);
    setEditOrderCtx(
      inv.orders?.length ? resolveCommunicationData(null, inv.orders) : null,
    );
    // Strip forwarded customer message from Bemerkungen (legacy data cleanup)
    const cleanNotes = stripForwardedMessage(inv.notes, lo?.notes);
    const invoicePdfText = splitInvoicePdfText(cleanNotes);
    const invoiceDate = toInvoiceDateInputValue(inv.invoiceDate);
    setForm({
      customerId: inv.customerId,
      invoiceDate,
      dueDate:
        toInvoiceDateInputValue(inv.dueDate) ||
        addDaysToInvoiceDate(invoiceDate, defaultPaymentDays),
      paymentDays: String(defaultPaymentDays),
      pdfTitle: invoicePdfText.pdfTitle,
      notes: invoicePdfText.notes,
      orderIds: [],
    });
    setExpandedItemIndex(null);
    setServiceActionMenuIndex(null);
    setEditingExecutionAddress(false);
    setExpandedInvoiceSiteKeys(new Set());
    setEditingInvoiceSiteKey(null);
    setNewInvoiceItemSiteKey("");
    setNewInvoiceExecutionSite(null);
    setItems(
      inv.items?.length > 0
        ? inv.items.map((it: any) => ({
            description: it.description ?? "",
            quantity: String(it.quantity ?? 0),
            unit: it.unit ?? "Stunde",
            unitPrice: String(it.unitPrice ?? 0),
            siteName: it.siteName || null,
            siteAddress: it.siteAddress || null,
            sitePlz: it.sitePlz || null,
            siteCity: it.siteCity || null,
            siteNote: it.siteNote || null,
            sourceOrderId: it.sourceOrderId || null,
          }))
        : [getEmptyItem()],
    );
    if (opts?.openCustomerSection && inv.customerId) {
      // Stage E (deterministic flow): mark a pending request; the effect below
      // picks it up once dialog is open AND form.customerId === pendingId.
      // This avoids the React batching race where the async fetch in
      // openCustomerEditor could complete before the dialog had even mounted.
      setPendingOpenCustomerEditor(inv.customerId);
      // We intentionally DO NOT reset showNewCustomer / editingCustomer here.
    } else {
      setShowNewCustomer(false);
      setEditingCustomer(false);
      setPendingOpenCustomerEditor(null);
    }
    setDialogOpen(true);
    if (opts?.focusStatus) {
      window.setTimeout(() => {
        const statusSelect = document.getElementById(
          "invoice-status-select",
        ) as HTMLSelectElement | null;
        statusSelect?.scrollIntoView({ behavior: "smooth", block: "center" });
        statusSelect?.focus();
      }, 180);
    }
    if (opts?.focusItems) {
      window.setTimeout(() => {
        serviceItemsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 180);
    }
    // Historische Rechnungen dürfen den zentralen Kundenstamm weder nachladen
    // noch durch Auto-Fill verändern. Entwürfe bleiben live verknüpft.
    if (inv.customerId && !isHistoricalInvoiceStatus(inv.status))
      autoFillCustomer(inv.customerId);
  };

  // Stage E (deterministic chip flow): runs AFTER the dialog has actually
  // opened AND the form is populated. Cannot be raced by openEditInvoice's
  // own state resets.
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
          const noteSource = linkedOrderData?.notes ?? null;
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
        setEditingCustomer(true);
        setShowNewCustomer(true);
        setPendingOpenCustomerEditor(null);
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

  useEffect(() => {
    if (!dialogOpen) setPendingOpenCustomerEditor(null);
  }, [dialogOpen]);

  const toggleInvoiceExecutionAddressEditor = (
    site?: InvoiceExecutionSite | null,
  ) => {
    if (!site) return;
    if (!editingExecutionAddress) {
      setEditingExecutionAddress(true);
      return;
    }
    if (
      serializeInvoiceExecutionSiteForEdit(site) !==
      executionAddressEditSnapshot
    ) {
      toast.info("Bitte Ausführungsadresse zuerst speichern.");
      return;
    }
    setEditingExecutionAddress(false);
  };

  const setNewInvoiceExecutionAddressEnabled = (enabled: boolean) => {
    if (!enabled) {
      setNewInvoiceExecutionSite(null);
      setEditingExecutionAddress(false);
      return;
    }
    setNewInvoiceExecutionSite(
      (current) => current || getEmptyInvoiceExecutionSite(),
    );
    setEditingExecutionAddress(true);
  };

  const updateNewInvoiceExecutionSite = (
    field: keyof InvoiceExecutionSite,
    value: string,
  ) => {
    setNewInvoiceExecutionSite((current) => ({
      ...(current || getEmptyInvoiceExecutionSite()),
      [field]: value,
    }));
  };

  const addItem = () => {
    const sites = collectInvoiceExecutionSites({
      items,
      orders: editingInvoice?.orders || [],
    });
    const groups = groupInvoiceItemsByExecutionSite(items || [], sites);
    // V17.90L135J: Bei mehreren Arbeitsorten wird der Arbeitsort erst
    // innerhalb der neu geöffneten Leistungsposition ausgewählt. Dadurch ist
    // kein dauerhaftes Arbeitsort-Dropdown in der Kopfzeile nötig.
    const requestedKey =
      sites.length > 1
        ? null
        : newInvoiceItemSiteKey ||
          editingInvoiceSiteKey ||
          Array.from(expandedInvoiceSiteKeys)[0] ||
          groups[0]?.key ||
          null;

    const targetSite =
      groups.find((group) => group.key === requestedKey)?.site ||
      sites.find((site) => invoiceGroupKeyForSite(site) === requestedKey) ||
      null;
    setItems((current) => [
      { ...getEmptyItem(), ...(targetSite || {}) },
      ...current,
    ]);
    if (requestedKey)
      setExpandedInvoiceSiteKeys(
        (current) => new Set([...current, requestedKey]),
      );
    setExpandedItemIndex(0);
    setServiceActionMenuIndex(null);
    requestAnimationFrame(() => {
      serviceItemsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      window.setTimeout(() => {
        serviceItemsRef.current
          ?.querySelector<HTMLInputElement>(
            '[data-service-item-index="0"] input',
          )
          ?.focus();
      }, 180);
    });
  };
  const removeItem = (i: number) => {
    if (items.length <= 1) {
      setItems([getEmptyItem()]);
      setExpandedItemIndex(0);
      setServiceActionMenuIndex(null);
      return;
    }
    setItems(items.filter((_: any, idx: number) => idx !== i));
    setExpandedItemIndex((current) =>
      current === i
        ? null
        : current != null && current > i
          ? current - 1
          : current,
    );
    setServiceActionMenuIndex(null);
  };
  const updateItem = (i: number, field: string, value: string) => {
    const updated = [...(items ?? [])];
    if (updated[i]) (updated[i] as any)[field] = value;
    setItems(updated);
  };

  const assignInvoiceItemToSite = (index: number, siteKey: string) => {
    const sites = collectInvoiceExecutionSites({
      items,
      orders: editingInvoice?.orders || [],
    });
    const site = sites.find(
      (candidate) => invoiceGroupKeyForSite(candidate) === siteKey,
    );
    if (!site) return;
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              siteName: site.siteName || null,
              siteAddress: site.siteAddress || null,
              sitePlz: site.sitePlz || null,
              siteCity: site.siteCity || null,
              siteNote: site.siteNote || null,
              sourceOrderId: site.sourceOrderId || null,
            }
          : item,
      ),
    );
    setNewInvoiceItemSiteKey(siteKey);
    setExpandedInvoiceSiteKeys((current) => new Set([...current, siteKey]));
  };

  const onItemServiceSelect = (
    idx: number,
    name: string,
    svcOpt?: ServiceOption,
  ) => {
    const svc = svcOpt ?? services?.find((s: any) => s.name === name);
    if (svc) {
      updateItem(idx, "description", svc.name);
      updateItem(idx, "unitPrice", String(svc.defaultPrice ?? 0));
      updateItem(idx, "unit", compactInvoiceValue(svc.unit));
    } else if (!name) {
      updateItem(idx, "description", "");
      updateItem(idx, "unitPrice", "");
      updateItem(idx, "quantity", "");
      updateItem(idx, "unit", "");
    } else {
      updateItem(idx, "description", name);
    }
  };

  const handleServiceCreated = (newSvc: ServiceOption) => {
    setServices((prev: any[]) =>
      [...prev, newSvc].sort((a, b) =>
        (a?.name ?? "").localeCompare(b?.name ?? "", "de", {
          sensitivity: "base",
        }),
      ),
    );
  };

  const saveInvoiceItemToServices = async (index: number) => {
    const item = items[index];
    const name = compactInvoiceValue(item?.description);
    const price = Number(item?.unitPrice || 0);
    const quantity = Number(item?.quantity || 0);
    const unit = compactInvoiceValue(item?.unit);
    if (!name || price <= 0 || quantity <= 0 || !unit) {
      toast.error("Leistung, Preis, Menge und Einheit zuerst prüfen");
      return;
    }

    const existing = services.find(
      (service: any) =>
        normalizeInvoiceServiceName(service?.name) ===
        normalizeInvoiceServiceName(name),
    );

    if (existing) {
      const sameUnit = compactInvoiceValue(existing.unit) === unit;
      const samePrice =
        Math.abs(Number(existing.defaultPrice || 0) - price) < 0.001;
      if (sameUnit && samePrice) {
        onItemServiceSelect(index, existing.name, existing);
        toast.success("Leistung ist bereits passend im Leistungskatalog");
        setServiceActionMenuIndex(null);
        return;
      }
      setConfirmDialog({
        title: "Leistungskatalog aktualisieren?",
        message: `${name} ist bereits vorhanden. Preis und Einheit mit den Rechnungswerten ersetzen?`,
        action: async () => {
          const response = await fetch("/api/services", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: existing.id,
              name: existing.name || name,
              defaultPrice: price,
              unit,
            }),
          });
          if (!response.ok) {
            toast.error("Leistungskatalog konnte nicht aktualisiert werden");
            return;
          }
          const savedService: ServiceOption = await response.json();
          handleServiceCreated(savedService);
          onItemServiceSelect(index, savedService.name, savedService);
          toast.success("Leistungskatalog wurde aktualisiert");
        },
      });
      setServiceActionMenuIndex(null);
      return;
    }

    try {
      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, defaultPrice: price, unit }),
      });
      if (!response.ok) throw new Error("service_create_failed");
      const savedService: ServiceOption = await response.json();
      handleServiceCreated(savedService);
      onItemServiceSelect(index, savedService.name, savedService);
      toast.success("Leistung wurde in den Leistungskatalog übernommen");
    } catch {
      toast.error("Leistung konnte nicht übernommen werden");
    } finally {
      setServiceActionMenuIndex(null);
    }
  };

  const invoiceGroupKeyForSite = (site: InvoiceExecutionSite) =>
    `${site.sourceOrderId || ""}|${invoiceSiteKey(site)}`;

  const addInvoiceExecutionSite = () => {
    const sites = collectInvoiceExecutionSites({
      items,
      orders: editingInvoice?.orders || [],
    });
    const unfinishedSite = sites.find(
      (site) =>
        !compactInvoiceValue(site.siteName) &&
        !compactInvoiceValue(site.siteAddress) &&
        !compactInvoiceValue(site.sitePlz) &&
        !compactInvoiceValue(site.siteCity),
    );
    if (unfinishedSite) {
      const unfinishedKey = invoiceGroupKeyForSite(unfinishedSite);
      setEditingInvoiceSiteKey(unfinishedKey);
      setNewInvoiceItemSiteKey(unfinishedKey);
      setExpandedInvoiceSiteKeys(
        (current) => new Set([...current, unfinishedKey]),
      );
      toast.info("Leeren Arbeitsort zuerst ausfüllen oder löschen.");
      return;
    }
    const site: InvoiceExecutionSite = {
      siteName: "",
      siteAddress: "",
      sitePlz: "",
      siteCity: "",
      siteNote: "",
      sourceOrderId: null,
    };
    const key = invoiceGroupKeyForSite(site);
    setItems((current) => [{ ...getEmptyItem(), ...site }, ...current]);
    setEditingInvoiceSiteKey(key);
    setNewInvoiceItemSiteKey(key);
    setExpandedInvoiceSiteKeys((current) => new Set([...current, key]));
    setExpandedItemIndex(0);
    requestAnimationFrame(() =>
      serviceItemsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  };

  const updateInvoiceGroupSite = (
    groupKey: string,
    field: keyof InvoiceExecutionSite,
    value: string,
  ) => {
    const currentSite = collectInvoiceExecutionSites({
      items,
      orders: editingInvoice?.orders || [],
    }).find((site) => invoiceGroupKeyForSite(site) === groupKey);
    const nextKey = currentSite
      ? invoiceGroupKeyForSite({ ...currentSite, [field]: value })
      : groupKey;
    setItems((current) =>
      current.map((item) =>
        invoiceGroupKeyForSite(item as InvoiceExecutionSite) === groupKey
          ? { ...item, [field]: value || null }
          : item,
      ),
    );
    setEditingInvoiceSiteKey(nextKey);
    setExpandedInvoiceSiteKeys((current) => {
      const next = new Set(current);
      next.delete(groupKey);
      next.add(nextKey);
      return next;
    });
  };

  const removeInvoiceExecutionSite = (groupKey: string) => {
    const groups = groupInvoiceItemsByExecutionSite(
      items || [],
      collectInvoiceExecutionSites({
        items,
        orders: editingInvoice?.orders || [],
      }),
    );
    const group = groups.find((entry) => entry.key === groupKey);
    if (!group?.site) return;
    if (group.site.sourceOrderId) {
      toast.error(
        "Dieser Arbeitsort stammt aus dem Auftrag und kann hier nicht gelöscht werden.",
      );
      return;
    }
    const hasRealItems = group.entries.some(({ item }) =>
      Boolean(
        compactInvoiceValue(item.description) ||
        Number(item.quantity || 0) > 0 ||
        Number(item.unitPrice || 0) > 0,
      ),
    );
    if (hasRealItems) {
      toast.error(
        "Arbeitsort kann nicht gelöscht werden: Leistungen sind noch zugeordnet.",
      );
      return;
    }
    setItems((current) =>
      current.filter(
        (item) =>
          invoiceGroupKeyForSite(item as InvoiceExecutionSite) !== groupKey,
      ),
    );
    setExpandedInvoiceSiteKeys((current) => {
      const next = new Set(current);
      next.delete(groupKey);
      return next;
    });
    setEditingInvoiceSiteKey(null);
    setNewInvoiceItemSiteKey("");
  };

  const toggleAllInvoiceSites = () => {
    const sites = collectInvoiceExecutionSites({
      items,
      orders: editingInvoice?.orders || [],
    });
    const groups = groupInvoiceItemsByExecutionSite(items || [], sites);
    setExpandedInvoiceSiteKeys((current) =>
      current.size === groups.length
        ? new Set()
        : new Set(groups.map((group) => group.key)),
    );
  };

  const updateInvoiceExecutionSite = (
    field: keyof InvoiceExecutionSite,
    value: string,
  ) => {
    setItems((current) =>
      current.map((item) => ({ ...item, [field]: value || null })),
    );
  };

  const subtotal =
    items?.reduce(
      (sum: number, item: InvoiceItem) =>
        sum + Number(item?.quantity ?? 0) * Number(item?.unitPrice ?? 0),
      0,
    ) ?? 0;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  const renderInvoiceServiceOverview = () => {
    const overviewItems = (items || []).filter((item: InvoiceItem) =>
      compactInvoiceValue(item?.description),
    );
    const overviewSites = collectInvoiceExecutionSites({
      items: overviewItems,
      orders: editingInvoice?.orders || [],
    });
    const overviewGroups = groupInvoiceItemsByExecutionSite(
      overviewItems,
      overviewSites,
    ).filter((group) => group.entries.length > 0);
    const hasMultipleOverviewSites = overviewGroups.length > 1;

    return (
      <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">Leistungsübersicht</div>
            <div className="text-xs text-muted-foreground">
              Live aus den Leistungen oben
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setInvoiceServiceOverviewOpen((current) => !current)}
            className="h-7 w-full px-2 text-[11px] sm:w-auto"
          >
            {invoiceServiceOverviewOpen ? "Einklappen" : "Anzeigen"}
          </Button>
        </div>

        {!invoiceServiceOverviewOpen && (
          <button
            type="button"
            className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-left text-sm hover:bg-muted/40"
            onClick={() => setInvoiceServiceOverviewOpen(true)}
          >
            <span className="min-w-0 truncate text-muted-foreground">
              {hasMultipleOverviewSites
                ? `${overviewGroups.length} Arbeitsorte · ${overviewItems.length} Leistungen`
                : `${overviewItems.length} Leistung${overviewItems.length === 1 ? "" : "en"}`}
            </span>
            <span className="shrink-0 font-mono font-semibold text-primary">
              {formatCurrency(subtotal, currency)}
            </span>
          </button>
        )}

        {invoiceServiceOverviewOpen && hasMultipleOverviewSites && (
          <div className="mt-2 space-y-2 rounded-lg border-2 border-slate-300 bg-muted/20 p-2 dark:border-slate-700">
            {overviewGroups.map((group, groupIndex) => {
              const groupTotal = group.entries.reduce(
                (sum, entry) =>
                  sum +
                  Number(entry.item?.quantity || 0) *
                    Number(entry.item?.unitPrice || 0),
                0,
              );
              const siteTitle =
                group.site?.siteName ||
                group.site?.siteAddress ||
                `Ausführungsort ${groupIndex + 1}`;
              const siteAddress = [
                group.site?.siteName ? group.site?.siteAddress : null,
                [group.site?.sitePlz, group.site?.siteCity]
                  .filter(Boolean)
                  .join(" "),
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <div
                  key={`invoice-overview-site-${group.key}`}
                  className="overflow-hidden rounded-md border-2 border-slate-300 bg-background shadow-sm dark:border-slate-700"
                >
                  <div className="flex items-start justify-between gap-2 border-b-2 border-slate-200 bg-muted/40 px-2 py-1.5 dark:border-slate-700">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold leading-tight">
                        📍 {groupIndex + 1}. {siteTitle}
                      </div>
                      {siteAddress && (
                        <div className="text-xs text-muted-foreground">
                          {siteAddress}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 rounded-md border border-slate-300 bg-background px-2 py-1 text-right font-mono text-sm font-bold text-primary dark:border-slate-700">
                      {formatCurrency(groupTotal, currency)}
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200 px-2 text-sm dark:divide-slate-700">
                    {group.entries.map(({ item, index }) => {
                      const quantity = Number(item?.quantity || 0);
                      const unitPrice = Number(item?.unitPrice || 0);
                      const lineTotal = quantity * unitPrice;
                      return (
                        <div
                          key={`invoice-overview-${group.key}-${index}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-1.5"
                        >
                          <div className="min-w-0">
                            <div className="font-medium">
                              {compactInvoiceValue(item?.description) ||
                                "Unbenannte Leistung"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {quantity > 0
                                ? `${quantity} ${compactInvoiceValue(item?.unit) || "–"}`
                                : "Menge prüfen"}
                              {" · "}
                              {unitPrice > 0
                                ? formatCurrency(unitPrice, currency)
                                : "Preis prüfen"}
                            </div>
                          </div>
                          <div className="text-right font-mono text-sm font-medium">
                            {formatCurrency(
                              Number.isFinite(lineTotal) ? lineTotal : 0,
                              currency,
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="flex justify-between rounded-md border border-slate-300 bg-muted/70 px-3 py-2 text-sm font-semibold dark:border-slate-700">
              <span>Gesamt netto</span>
              <span className="font-mono text-primary">
                {formatCurrency(subtotal, currency)}
              </span>
            </div>
          </div>
        )}

        {invoiceServiceOverviewOpen && !hasMultipleOverviewSites && (
          <div className="mt-2 overflow-x-auto rounded-lg border-2 border-slate-300 dark:border-slate-700">
            <table className="w-full min-w-[680px] border-collapse text-[13px] leading-snug">
              <thead className="bg-slate-50 text-left dark:bg-slate-900/70">
                <tr className="border-b border-slate-300 dark:border-slate-700">
                  <th className="w-12 px-2 py-1.5 font-semibold">Nr.</th>
                  <th className="px-2 py-1.5 font-semibold">Leistung</th>
                  <th className="w-32 px-2 py-1.5 font-semibold">Einheit</th>
                  <th className="w-20 px-2 py-1.5 text-right font-semibold">
                    Menge
                  </th>
                  <th className="w-32 px-2 py-1.5 text-right font-semibold">
                    Einzelpreis
                  </th>
                  <th className="w-32 px-2 py-1.5 text-right font-semibold">
                    Summe
                  </th>
                </tr>
              </thead>
              <tbody>
                {overviewItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-2 py-3 text-center text-muted-foreground"
                    >
                      Keine Leistung erfasst.
                    </td>
                  </tr>
                ) : (
                  overviewItems.map((item: InvoiceItem, index: number) => {
                    const quantity = Number(item?.quantity || 0);
                    const unitPrice = Number(item?.unitPrice || 0);
                    const lineTotal = quantity * unitPrice;
                    return (
                      <tr
                        key={`invoice-overview-row-${index}`}
                        className="border-b border-slate-200 last:border-b-0 dark:border-slate-800"
                      >
                        <td className="px-2 py-1.5 align-top">{index + 1}</td>
                        <td className="px-2 py-1.5 align-top font-medium">
                          {item.description}
                        </td>
                        <td className="px-2 py-1.5 align-top">
                          {compactInvoiceValue(item.unit) || "–"}
                        </td>
                        <td className="px-2 py-1.5 text-right align-top font-mono">
                          {Number.isFinite(quantity) ? quantity : 0}
                        </td>
                        <td className="px-2 py-1.5 text-right align-top font-mono">
                          {formatCurrency(
                            Number.isFinite(unitPrice) ? unitPrice : 0,
                            currency,
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right align-top font-mono">
                          {formatCurrency(
                            Number.isFinite(lineTotal) ? lineTotal : 0,
                            currency,
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold dark:border-slate-700 dark:bg-slate-900/70">
                  <td colSpan={5} className="px-2 py-2">
                    Gesamt
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-primary">
                    {formatCurrency(subtotal, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  };

  const onCustomerChange = (customerId: string) => {
    // A manually created invoice must not silently inherit every open order of
    // the selected customer. Hidden orderIds could trigger source-order
    // blockers and make "Rechnung erstellen" fail although the visible manual
    // invoice is complete.
    setForm((current) => ({
      ...current,
      customerId,
      ...(!editingInvoice ? { orderIds: [] } : {}),
    }));
  };

  const save = async (closeAfterSave = true): Promise<boolean> => {
    if (!form?.customerId) {
      toast.error("Bitte Kunde wählen");
      return false;
    }
    if (!items?.length || !items[0]?.description?.trim()) {
      toast.error("Mindestens eine Leistung");
      return false;
    }
    if (!form.invoiceDate || !form.dueDate) {
      toast.error("Rechnungsdatum und Fälligkeitsdatum sind erforderlich");
      return false;
    }
    if (form.dueDate < form.invoiceDate) {
      toast.error(
        "Das Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen",
      );
      return false;
    }
    setSaving(true);
    try {
      const itemsForCreate = newInvoiceExecutionSite
        ? items.map((item) => ({
            ...item,
            siteName:
              compactInvoiceValue(newInvoiceExecutionSite.siteName) || null,
            siteAddress:
              compactInvoiceValue(newInvoiceExecutionSite.siteAddress) || null,
            sitePlz:
              compactInvoiceValue(newInvoiceExecutionSite.sitePlz) || null,
            siteCity:
              compactInvoiceValue(newInvoiceExecutionSite.siteCity) || null,
            siteNote:
              compactInvoiceValue(newInvoiceExecutionSite.siteNote) || null,
          }))
        : items;
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          notes: joinInvoicePdfText(form.pdfTitle, form.notes),
          items: itemsForCreate,
          vatRate,
          currency,
        }),
      });
      if (res.ok) {
        const createdInvoice = await res.json().catch(() => null);
        toast.success("Rechnung gespeichert");
        await load();
        if (closeAfterSave) {
          setDialogOpen(false);
          setItems([getEmptyItem()]);
          setNewInvoiceExecutionSite(null);
          setExecutionAddressEditSnapshot(
            serializeInvoiceExecutionSiteForEdit(newInvoiceExecutionSite),
          );
          setEditingExecutionAddress(false);
          const invoiceDate = getTodayInvoiceDateInputValue();
          setForm({
            customerId: "",
            invoiceDate,
            dueDate: addDaysToInvoiceDate(invoiceDate, defaultPaymentDays),
            paymentDays: String(defaultPaymentDays),
            pdfTitle: "",
            notes: "",
            orderIds: [],
          });
        } else if (createdInvoice?.id) {
          setEditingInvoice(createdInvoice);
          setItems(
            Array.isArray(createdInvoice.items)
              ? createdInvoice.items
              : itemsForCreate,
          );
          setExecutionAddressEditSnapshot(
            serializeInvoiceExecutionSiteForEdit(newInvoiceExecutionSite),
          );
          setNewInvoiceExecutionSite(null);
          setEditingExecutionAddress(false);
        }
        return true;
      } else {
        const errorData = await res.json().catch(() => null);
        toast.error(
          errorData?.error || "Rechnung konnte nicht erstellt werden",
        );
        return false;
      }
    } catch (error) {
      console.error("invoice create failed", error);
      toast.error("Rechnung konnte nicht erstellt werden");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (closeAfterSave = true): Promise<boolean> => {
    if (!editingInvoice) return false;
    if (!form.invoiceDate || !form.dueDate) {
      toast.error("Rechnungsdatum und Fälligkeitsdatum sind erforderlich");
      return false;
    }
    if (form.dueDate < form.invoiceDate) {
      toast.error(
        "Das Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen",
      );
      return false;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${editingInvoice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editingInvoice.status,
          notes: joinInvoicePdfText(form.pdfTitle, form.notes),
          invoiceDate: form.invoiceDate,
          dueDate: form.dueDate,
          items,
          vatRate,
          currency,
        }),
      });
      if (!res.ok) {
        toast.error("Fehler");
        return false;
      }
      toast.success("Rechnung aktualisiert");
      if (closeAfterSave) {
        setDialogOpen(false);
        setEditingInvoice(null);
      }
      await load();
      return true;
    } catch {
      toast.error("Fehler");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveInvoiceExecutionAddress = async () => {
    const saved = await saveEdit(false);
    if (saved) {
      const currentSite =
        collectInvoiceExecutionSites({
          items,
          orders: editingInvoice?.orders || [],
        })[0] || null;
      setExecutionAddressEditSnapshot(
        serializeInvoiceExecutionSiteForEdit(currentSite),
      );
      setEditingExecutionAddress(false);
    }
  };

  // Save + Archive → set status Erledigt + back to list
  const saveAndArchive = async () => {
    if (!editingInvoice) return;
    if (!form.invoiceDate || !form.dueDate) {
      toast.error("Rechnungsdatum und Fälligkeitsdatum sind erforderlich");
      return;
    }
    if (form.dueDate < form.invoiceDate) {
      toast.error(
        "Das Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen",
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${editingInvoice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "Erledigt",
          notes: joinInvoicePdfText(form.pdfTitle, form.notes),
          invoiceDate: form.invoiceDate,
          dueDate: form.dueDate,
          items,
          vatRate,
          currency,
        }),
      });
      if (res.ok) {
        // L182: Nach erfolgreichem Archivieren sofort aus der aktiven Liste
        // entfernen. Ein erneutes Laden der ganzen Seite ist nicht nötig.
        removeInvoiceFromActiveList(editingInvoice.id);
        toast.success("Rechnung erledigt und archiviert");
        setDialogOpen(false);
        setEditingInvoice(null);
      } else toast.error("Fehler");
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    window.open(
      `/api/invoices/${id}/pdf?_t=${Date.now()}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const sendPdfToWhatsApp = async (inv: Invoice) => {
    // New flow: server generates PDF, uploads to public S3, and sends
    // it via Twilio directly to the operator's PRIMARY business WhatsApp
    // number (whatsappIntakeNumber → telefon). The operator then forwards
    // the message from their own WhatsApp to the customer.
    // Customer.phone and CompanySettings.telefon2 are NEVER used.
    if (!businessWhatsappNumber) {
      toast.error(
        "Keine WhatsApp-Nummer für den Betrieb hinterlegt. Bitte unter Einstellungen → Kontakt die Hauptnummer (Telefon) oder die WhatsApp-Empfangsnummer eintragen.",
        { duration: 6000 },
      );
      return;
    }
    setDownloading(inv.id);
    const sendingToast = toast.loading(
      "PDF wird erstellt und an Ihre WhatsApp gesendet …",
    );
    try {
      const result = await sendPdfToBusinessWhatsApp({
        kind: "invoice",
        id: inv.id,
      });
      toast.dismiss(sendingToast);
      if (result.ok) {
        toast.success(
          "PDF wurde an Ihre WhatsApp-Nummer gesendet. Sie können es nun aus dem Chat an den Kunden weiterleiten.",
          { duration: 6000 },
        );
      } else if (result.reason === "no_business_number") {
        toast.error(
          result.message ||
            "Keine WhatsApp-Nummer für den Betrieb hinterlegt. Bitte unter Einstellungen → Kontakt die Hauptnummer (Telefon) oder die WhatsApp-Empfangsnummer eintragen.",
          { duration: 6000 },
        );
      } else if (result.reason === "pdf_failed") {
        toast.error(result.message || "PDF konnte nicht erstellt werden.");
      } else if (result.reason === "upload_failed") {
        toast.error(
          result.message ||
            "PDF konnte nicht für den Versand bereitgestellt werden.",
        );
      } else if (result.reason === "twilio_not_configured") {
        toast.error(
          result.message ||
            "WhatsApp-Versand ist nicht konfiguriert. Bitte Twilio-Absendernummer (TWILIO_WHATSAPP_FROM) hinterlegen.",
          { duration: 8000 },
        );
      } else if (result.reason === "twilio_invalid_to") {
        toast.error(
          result.message || "Die hinterlegte WhatsApp-Nummer ist ungültig.",
          { duration: 6000 },
        );
      } else if (result.reason === "twilio_rejected") {
        toast.error(
          result.message || "WhatsApp-Versand wurde von Twilio abgelehnt.",
          { duration: 6000 },
        );
      } else if (result.reason === "twilio_network") {
        toast.error(
          result.message ||
            "Verbindung zu Twilio fehlgeschlagen. Bitte erneut versuchen.",
        );
      } else if (result.reason === "unauthorized") {
        toast.error("Bitte melden Sie sich erneut an.");
      } else {
        toast.error(result.message || "Fehler beim Senden an WhatsApp.");
      }
    } catch (err) {
      toast.dismiss(sendingToast);
      console.error("[rechnungen] sendPdfToWhatsApp failed", err);
      toast.error("Fehler beim Senden an WhatsApp.");
    } finally {
      setDownloading(null);
    }
  };

  const removeInvoiceFromActiveList = (id: string) => {
    setInvoices((current) => current.filter((invoice) => invoice.id !== id));
    setExpandedInvoiceCardIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setExpandedInvoiceServiceCardIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const restoreInvoiceInActiveList = (
    invoice: Invoice | null,
    previousIndex: number,
  ) => {
    if (!invoice) return;
    setInvoices((current) => {
      if (current.some((entry) => entry.id === invoice.id)) return current;
      const next = [...current];
      next.splice(
        Math.min(Math.max(previousIndex, 0), next.length),
        0,
        invoice,
      );
      return next;
    });
  };

  const updateStatus = async (
    e: React.MouseEvent | React.ChangeEvent,
    id: string,
    status: string,
  ) => {
    if ("stopPropagation" in e) e.stopPropagation();
    const previousIndex = invoices.findIndex((invoice) => invoice.id === id);
    const previousInvoice = previousIndex >= 0 ? invoices[previousIndex] : null;
    const previousStatus = previousInvoice?.status;
    const movesToArchive = status === "Erledigt";

    if (movesToArchive) {
      // L182: Erfolgreich archivierte Rechnungen gehören nicht mehr in die
      // aktive Rechnungsliste. Optimistisch sofort entfernen, damit Karte und
      // Zähler ohne Reload reagieren. Bei API-Fehler exakt zurücksetzen.
      removeInvoiceFromActiveList(id);
    } else {
      setInvoices((current) =>
        current.map((invoice) =>
          invoice.id === id ? { ...invoice, status } : invoice,
        ),
      );
    }

    try {
      const response = await fetch(`/api/invoices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("status_update_failed");
      if (movesToArchive) {
        toast.success("Rechnung archiviert");
      } else if (status === "Bezahlt") {
        toast.success("Rechnung als bezahlt markiert.", {
          duration: 8000,
          action: {
            label: "Archivieren",
            onClick: () => {
              void updateStatus(
                { stopPropagation: () => {} } as any,
                id,
                "Erledigt",
              );
            },
          },
        });
      } else {
        toast.success("Status aktualisiert");
      }
    } catch {
      if (movesToArchive) {
        restoreInvoiceInActiveList(previousInvoice, previousIndex);
      } else {
        setInvoices((current) =>
          current.map((invoice) =>
            invoice.id === id
              ? { ...invoice, status: previousStatus || invoice.status }
              : invoice,
          ),
        );
      }
      toast.error(
        movesToArchive
          ? "Rechnung konnte nicht archiviert werden"
          : "Status konnte nicht gespeichert werden",
      );
    }
  };

  const remove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setConfirmDialog({
      title: "In Papierkorb verschieben?",
      message: "Die Rechnung wird in den Papierkorb verschoben.",
      action: async () => {
        const removedIndex = invoices.findIndex((invoice) => invoice.id === id);
        const removedInvoice =
          removedIndex >= 0 ? invoices[removedIndex] : null;
        const restoreInvoice = () => {
          if (!removedInvoice) return;
          setInvoices((current) => {
            if (current.some((invoice) => invoice.id === removedInvoice.id))
              return current;
            const next = [...current];
            next.splice(
              Math.min(Math.max(removedIndex, 0), next.length),
              0,
              removedInvoice,
            );
            return next;
          });
        };

        setInvoices((current) =>
          current.filter((invoice) => invoice.id !== id),
        );
        try {
          if (removedInvoice?.sourceOfferId) {
            await fetch(`/api/offers/${removedInvoice.sourceOfferId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "Angenommen" }),
            });
            toast.info("Angebot-Status zurückgesetzt");
          }
          const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" });
          if (!res.ok) {
            const result = await res.json().catch(() => ({}));
            restoreInvoice();
            toast.error(
              result?.error || "Rechnung konnte nicht verschoben werden",
            );
            return;
          }
          toast.success("Rechnung in Papierkorb verschoben");
        } catch {
          restoreInvoice();
          toast.error("Fehler beim Verschieben in den Papierkorb");
        }
      },
    });
  };

  const revertToOffer = (inv: Invoice) => {
    const hasOffer = !!inv.sourceOfferId;
    const msg = hasOffer
      ? `Rechnung ${inv.invoiceNumber} zurück zu Angeboten verschieben? Die Rechnung wird gelöscht und das verknüpfte Angebot wird wieder aktiviert.`
      : `Rechnung ${inv.invoiceNumber} zurücksetzen? Die Rechnung wird gelöscht und die verknüpften Aufträge werden wieder aktiv.`;
    setConfirmDialog({
      title: hasOffer ? "Zurück zu Angeboten?" : "Rechnung zurücksetzen?",
      message: msg,
      action: async () => {
        try {
          const res = await fetch(`/api/invoices/${inv.id}/revert`, {
            method: "POST",
          });
          if (res.ok) {
            const data = await res.json();
            if (data.reactivatedOffer) {
              toast.success("Rechnung zurückgesetzt — Angebot wieder aktiv");
              router.push("/angebote");
            } else {
              toast.success(
                `Rechnung zurückgesetzt — ${data.revertedOrders || 0} Auftrag/Aufträge wieder aktiv`,
              );
              router.push("/auftraege");
            }
          } else {
            const err = await res.json().catch(() => ({}));
            toast.error(err.error || "Fehler beim Zurücksetzen");
          }
        } catch {
          toast.error("Fehler beim Zurücksetzen");
        }
      },
    });
  };

  // Sort: Offen first, then by status, alphabetical by customer
  const sorted = [...invoices].sort((a, b) => {
    switch (sortBy) {
      case "oldest":
        return (
          new Date(a.createdAt ?? a.invoiceDate ?? 0).getTime() -
          new Date(b.createdAt ?? b.invoiceDate ?? 0).getTime()
        );
      case "name":
        return (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "");
      case "amount":
        return (Number(b.total) || 0) - (Number(a.total) || 0);
      default:
        return (
          new Date(b.createdAt ?? b.invoiceDate ?? 0).getTime() -
          new Date(a.createdAt ?? a.invoiceDate ?? 0).getTime()
        );
    }
  });

  const unpaidCount = invoices.filter((i) => i.status !== "Bezahlt").length;
  const paidCount = invoices.filter((i) => i.status === "Bezahlt").length;
  const visibleInvoiceIds = sorted
    .slice(0, visibleCount)
    .map((invoice) => invoice.id);
  const visibleInvoiceIdsKey = visibleInvoiceIds.join("\u241f");

  useEffect(() => {
    if (
      !invoiceCardExpansionRestored ||
      invoiceCardInitialStateApplied ||
      visibleInvoiceIds.length === 0
    )
      return;
    setExpandedInvoiceCardIds(new Set(visibleInvoiceIds));
    setInvoiceCardInitialStateApplied(true);
  }, [
    invoiceCardExpansionRestored,
    invoiceCardInitialStateApplied,
    visibleInvoiceIdsKey,
  ]);

  useEffect(() => {
    if (
      !invoiceCardExpansionRestored ||
      !invoiceCardInitialStateApplied ||
      typeof window === "undefined"
    )
      return;
    try {
      window.localStorage.setItem(
        "smartflow:rechnungen:expanded-card-ids:v1",
        JSON.stringify(Array.from(expandedInvoiceCardIds)),
      );
    } catch {
      // Local storage can be unavailable in strict/private browser modes.
    }
  }, [
    invoiceCardExpansionRestored,
    invoiceCardInitialStateApplied,
    expandedInvoiceCardIds,
  ]);

  const allVisibleInvoiceCardsExpanded =
    visibleInvoiceIds.length > 0 &&
    visibleInvoiceIds.every((id) => expandedInvoiceCardIds.has(id));

  const toggleInvoiceCard = (id: string) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SMARTFLOW_CLOSE_CARD_POPOVERS_EVENT_V17_90L227));
    }
    setActiveInvoiceServiceSheet(null);
    setExpandedInvoiceCardIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllInvoiceCards = () => {
    setExpandedInvoiceCardIds((current) => {
      const next = new Set(current);
      visibleInvoiceIds.forEach((id) => {
        if (allVisibleInvoiceCardsExpanded) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const toggleInvoiceServiceCard = (id: string) => {
    setExpandedInvoiceServiceCardIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  if (loadError)
    return <LoadErrorFallback details={loadError} onRetry={load} />;

  return (
    <div className="space-y-4 pb-16 md:pb-8">
      {activeInvoiceServiceSheet && (
        <InvoiceMobileServiceReviewSheetV17_90L174
          state={activeInvoiceServiceSheet}
          onClose={() => setActiveInvoiceServiceSheet(null)}
        />
      )}
      <div className="pointer-events-none fixed left-16 top-0 z-40 flex h-14 items-center">
        <span className="font-display text-sm font-bold sm:text-base">
          Rechnungen
        </span>
      </div>

      <div className="fixed left-1/2 top-0 z-40 flex h-14 -translate-x-1/2 items-center">
        <button
          type="button"
          onClick={() => router.push("/angebote")}
          className="pointer-events-auto inline-flex h-8 items-center gap-1 rounded-full border border-slate-300 bg-background/95 px-2.5 text-xs font-semibold shadow-sm backdrop-blur hover:bg-muted"
          aria-label="Zu Angebote"
          title="Zu Angebote"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Angebote</span>
        </button>
      </div>

      <div className="-mx-2 px-2 py-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {unpaidCount} offen · {paidCount} bezahlt
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2.5 text-xs"
              onClick={toggleAllInvoiceCards}
              disabled={visibleInvoiceIds.length === 0}
            >
              {allVisibleInvoiceCardsExpanded
                ? "Alle schließen"
                : "Alle öffnen"}
            </Button>
            <Button className="h-8 px-2.5 text-xs" onClick={openNewInvoice}>
              <Plus className="mr-1 h-4 w-4" />
              <span className="hidden sm:inline">Neue Rechnung</span>
              <span className="sm:hidden">Neu</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Name, Ort, Leistung, Rechnungs-Nr…"
            className="pl-10 h-9 text-sm"
            value={searchText}
            onChange={(e: any) => setSearchText(e?.target?.value ?? "")}
          />
        </div>
        <select
          className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
          value={filterStatus}
          onChange={(e: any) => setFilterStatus(e?.target?.value ?? "Alle")}
        >
          <option value="Alle">Status: Alle</option>
          <option value="Offen">Unbezahlt</option>
          <option value="Überfällig">Überfällig</option>
          <option value="Bezahlt">Bezahlt</option>
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
        </select>
      </div>

      <div className="space-y-1.5">
        {(() => {
          const filteredInv = sorted.filter((inv: Invoice) => {
            if (filterStatus === "Offen" && inv.status === "Bezahlt")
              return false;
            if (filterStatus === "Bezahlt" && inv.status !== "Bezahlt")
              return false;
            // "Überfällig" matches either stored status OR dynamically derived (Gesendet + past dueDate).
            // Uses same getEffectiveInvoiceStatus helper already used for badge display.
            if (
              filterStatus === "Überfällig" &&
              getEffectiveInvoiceStatus(inv) !== "Überfällig"
            )
              return false;
            const s = searchText?.toLowerCase() ?? "";
            if (!s) return true;
            const itemDescs =
              inv.items
                ?.map((it: any) => it.description)
                .filter(Boolean)
                .join(" ") || "";
            return (
              inv?.customer?.name?.toLowerCase()?.includes(s) ||
              inv?.customer?.city?.toLowerCase()?.includes(s) ||
              itemDescs.toLowerCase().includes(s) ||
              inv?.invoiceNumber?.toLowerCase()?.includes(s) ||
              inv?.customer?.customerNumber?.toLowerCase()?.includes(s)
            );
          });
          return confirmDialog ? null : filteredInv.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Keine Rechnungen gefunden
            </p>
          ) : (
            <>
              {filteredInv
                .slice(0, visibleCount)
                .map((inv: Invoice, i: number) => {
                  const isPaid = inv.status === "Bezahlt";
                  // Effective status may auto-derive "Überfällig" for unpaid
                  // "Gesendet" invoices whose dueDate has passed. The select
                  // below uses this for display (value + color) only; the raw
                  // stored status remains in the DB until the user actively
                  // changes it via the dropdown.
                  const effectiveStatus = getEffectiveInvoiceStatus(inv);
                  const invoiceExecutionSites =
                    collectInvoiceExecutionSites(inv);
                  const executionSite = invoiceExecutionSites[0] || null;
                  const visibleItems = (inv.items || []).filter((item: any) =>
                    Boolean(String(item?.description || "").trim()),
                  );
                  const invoiceCardExpanded = expandedInvoiceCardIds.has(
                    inv.id,
                  );
                  const invoiceServicesExpanded =
                    expandedInvoiceServiceCardIds.has(inv.id);
                  const displayedInvoiceItems = invoiceServicesExpanded
                    ? visibleItems
                    : visibleItems.slice(0, 6);
                  const dueLabel = formatInvoiceDateLabel(inv.dueDate);
                  const invoiceAppointmentEntries =
                    compactInvoiceAppointmentEntriesForDisplay(
                      collectMergedAppointmentEntries(
                        (inv.orders || []) as any,
                      ),
                    );
                  const invoiceAppointmentLabel =
                    formatMergedAppointmentTooltip(invoiceAppointmentEntries) ||
                    formatInvoiceAppointmentLabel(inv);
                  const invoiceAppointmentDisplayLabel =
                    invoiceAppointmentLabel;
                  const invoiceAppointmentChipLabels =
                    buildAdaptiveAppointmentLabels(
                      invoiceAppointmentDisplayLabel,
                    );
                  const invoiceContactData = buildInvoiceCommunicationData(inv);
                  const mergedCount = getInvoiceMergedCount(inv);
                  const mergedContactEntries = buildMergedContactReviewEntries(
                    (inv.orders || []) as any,
                  );
                  const hasMergedContactReview =
                    mergedCount > 1 && mergedContactEntries.length > 1;
                  const invoiceCurrencyReviewDetails =
                    collectInvoiceCurrencyReviewDetailsV17_90L227(inv);
                  const invoiceCurrencyReviewCount =
                    invoiceCurrencyReviewDetails.length;
                  const invoiceCurrencyReviewTooltip =
                    formatInvoiceCurrencyReviewTooltipV17_90L227(
                      invoiceCurrencyReviewDetails,
                    );

                  const renderInvoiceQuickActions = () => (
                    <div
                      className="ml-auto inline-flex shrink-0 items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-700"
                      onPointerDown={(event) => event.stopPropagation()}
                      onTouchStart={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(event) => downloadPdf(event, inv.id)}
                        className="inline-flex h-8 w-9 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 shadow-sm transition hover:-translate-y-px hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-900/50"
                        title="PDF herunterladen"
                        aria-label="PDF herunterladen"
                      >
                        <InvoiceDirectPdfIcon />
                      </button>
                      {whatsappEnabled && businessWhatsappNumber && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void sendPdfToWhatsApp(inv);
                          }}
                          disabled={downloading === inv.id}
                          className="inline-flex h-8 w-10 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm transition hover:-translate-y-px hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-1 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                          title="PDF per WhatsApp senden"
                          aria-label="PDF per WhatsApp senden"
                        >
                          {downloading === inv.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <InvoicePdfWhatsAppIcon />
                          )}
                        </button>
                      )}
                    </div>
                  );

                  const renderInvoiceCompactFunctionalChips = () => (
                    <div
                      className="inline-flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden [&_svg]:h-[18px] [&_svg]:w-[18px]"
                      onPointerDown={(event) => event.stopPropagation()}
                      onTouchStart={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {hasMergedContactReview ? (
                        <MergedContactReviewChip
                          records={(inv.orders || []) as any}
                          compact
                        />
                      ) : (
                        <CommunicationChips
                          data={invoiceContactData}
                          compact
                          contactsOnly
                        />
                      )}
                    </div>
                  );

                  const invoiceServiceDisplayEntries =
                    buildInvoiceServiceDisplayEntriesV17_90L136(
                      visibleItems as InvoiceItem[],
                      services || [],
                      inv.currency === "EUR" ? "EUR" : "CHF",
                    );
                  const invoiceServiceDisplaySiteGroups =
                    buildInvoiceServiceDisplaySiteGroupsV17_90L136(
                      visibleItems as InvoiceItem[],
                      invoiceExecutionSites,
                      services || [],
                      inv.currency === "EUR" ? "EUR" : "CHF",
                    );
                  const invoiceServicesTooltipText =
                    invoiceServiceDisplayEntries
                      .map((entry) =>
                        [`* ${entry.description}`, ...entry.details].join("\n"),
                      )
                      .join("\n\n") || `Leistungen · ${visibleItems.length}`;

                  const invoiceServiceReviewEntries =
                    buildInvoiceServiceReviewEntriesV17_90L135G(
                      visibleItems as InvoiceItem[],
                      services || [],
                      inv.currency === "EUR" ? "EUR" : "CHF",
                    );
                  const invoiceServiceReviewSiteGroups =
                    buildInvoiceServiceReviewSiteGroupsV17_90L135G(
                      visibleItems as InvoiceItem[],
                      invoiceExecutionSites,
                      services || [],
                      inv.currency === "EUR" ? "EUR" : "CHF",
                    );
                  const invoiceBlockerEntries =
                    invoiceServiceReviewEntries.filter(
                      (entry) => entry.category === "blocker",
                    );
                  const invoiceYellowReviewEntries =
                    invoiceServiceReviewEntries.filter(
                      (entry) => entry.category !== "blocker",
                    );
                  const invoiceBlockerSiteGroups =
                    invoiceServiceReviewSiteGroups
                      .map((group) => ({
                        ...group,
                        entries: group.entries.filter(
                          (entry) => entry.category === "blocker",
                        ),
                      }))
                      .filter((group) => group.entries.length > 0);
                  const invoiceYellowReviewSiteGroups =
                    invoiceServiceReviewSiteGroups
                      .map((group) => ({
                        ...group,
                        entries: group.entries.filter(
                          (entry) => entry.category !== "blocker",
                        ),
                      }))
                      .filter((group) => group.entries.length > 0);

                  const renderInvoiceCompactReviewChip = (
                    tone: "yellow" | "red",
                  ) => {
                    const isRed = tone === "red";
                    const entries = isRed
                      ? invoiceBlockerEntries
                      : invoiceYellowReviewEntries;
                    const siteGroups = isRed
                      ? invoiceBlockerSiteGroups
                      : invoiceYellowReviewSiteGroups;
                    if (entries.length === 0) return null;

                    const title = isRed
                      ? `Preis / Menge / Einheit prüfen · ${entries.length}`
                      : `Leistungen prüfen · ${entries.length}`;

                    return (
                      <button
                        type="button"
                        aria-label={title}
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (useTouchChipPopovers) {
                            setActiveInvoiceServiceSheet({
                              title,
                              entries,
                              siteGroups,
                            });
                            return;
                          }
                          openEditInvoice(inv, { focusItems: true });
                          setExpandedItemIndex(null);
                        }}
                        className={`group relative inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0 text-[10px] font-bold shadow-sm outline-none focus:ring-2 focus:ring-offset-1 ${
                          isRed
                            ? "border border-red-300 bg-red-100 text-red-800 hover:bg-red-200 focus:ring-red-300"
                            : "border border-yellow-400 bg-yellow-100 text-yellow-900 ring-1 ring-yellow-200/70 hover:bg-yellow-200 focus:ring-yellow-300"
                        }`}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>{entries.length}</span>
                        {!useTouchChipPopovers && (
                          <InvoiceViewportTooltip
                            preferredWidth={432}
                            autoClose={false}
                          >
                            <InvoiceServiceReviewTooltipContentV17_90L135G
                              total={entries.length}
                              entries={entries}
                              siteGroups={siteGroups}
                              title={title}
                            />
                          </InvoiceViewportTooltip>
                        )}
                      </button>
                    );
                  };

                  const renderInvoiceCurrencyReviewChip = (slot: string) => {
                    if (invoiceCurrencyReviewCount <= 0) return null;
                    const title = `Währung prüfen · ${invoiceCurrencyReviewCount}`;
                    return (
                      <button
                        key={`${slot}-currency-review`}
                        type="button"
                        aria-label={title}
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!useTouchChipPopovers) openEditInvoice(inv, { focusItems: true });
                        }}
                        className="relative inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-full border border-red-300 bg-red-100 px-2 py-0 text-[10px] font-bold text-red-800 shadow-sm hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Währung</span>
                        <span>{invoiceCurrencyReviewCount}</span>
                        <InvoiceViewportTooltip
                          preferredWidth={360}
                          mobileDismissOnInteraction
                        >
                          <span className="whitespace-pre-wrap break-words">
                            {invoiceCurrencyReviewTooltip}
                          </span>
                        </InvoiceViewportTooltip>
                      </button>
                    );
                  };

                  const renderInvoiceServicesChip = (
                    placement: "compact" | "expanded" = "compact",
                  ) =>
                    invoiceYellowReviewEntries.length > 0 ||
                    invoiceBlockerEntries.length > 0 ||
                    invoiceCurrencyReviewCount > 0 ||
                    Boolean(invoiceAppointmentDisplayLabel) ? (
                      <span
                        className={
                          placement === "compact"
                            ? "inline-flex shrink-0 items-center border-l border-slate-200 pl-3 dark:border-slate-700"
                            : "inline-flex shrink-0 items-center border-l border-slate-200 pl-3 dark:border-slate-700"
                        }
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {renderInvoiceCompactReviewChip("yellow")}
                          {renderInvoiceCompactReviewChip("red")}
                          {renderInvoiceCurrencyReviewChip("review-group")}
                          {invoiceAppointmentDisplayLabel && (
                            <button
                              type="button"
                              onPointerDown={(event) => event.stopPropagation()}
                              onTouchStart={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              className={`relative inline-flex h-8 w-8 min-w-0 max-w-full shrink-0 items-center justify-center rounded-full border border-violet-300 bg-violet-50 px-0 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-100 ${invoiceAppointmentChipLabels.dateOnly ? "md:w-auto md:px-2.5" : "md:w-8 md:px-0"}`}
                              aria-label={invoiceAppointmentDisplayLabel}
                            >
                              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                              {invoiceAppointmentChipLabels.dateOnly && (
                                <span className="hidden whitespace-nowrap md:ml-1.5 md:inline">
                                  {invoiceAppointmentChipLabels.dateOnly}
                                </span>
                              )}
                              <span className="sr-only">
                                {invoiceAppointmentChipLabels.full}
                              </span>
                              <InvoiceViewportTooltip
                                preferredWidth={320}
                                mobileDismissOnInteraction
                              >
                                <InvoiceAppointmentTooltipContentV17_90L169
                                  text={invoiceAppointmentDisplayLabel}
                                />
                              </InvoiceViewportTooltip>
                            </button>
                          )}
                        </span>
                      </span>
                    ) : null;
                  return (
                    <motion.div
                      key={inv?.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02 }}
                    >
                      <Card
                        className="border-2 border-slate-400 dark:border-slate-600 hover:border-slate-500 dark:hover:border-slate-500 transition-all hover:shadow-md tap-safe active:scale-[0.998]"
                        aria-expanded={invoiceCardExpanded}
                        onClick={(event) => {
                          if (
                            event.target instanceof Element &&
                            event.target.closest(
                              "button, a, input, select, textarea, label, summary, details, [role='button'], [data-card-toggle-ignore='true']",
                            )
                          )
                            return;
                          toggleInvoiceCard(inv.id);
                        }}
                      >
                        <CardContent className="p-3 sm:p-4">
                          <div className="flex items-start gap-2">
                            <details
                              data-invoice-action-menu
                              className="relative shrink-0 group"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <summary
                                className="list-none cursor-pointer p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted [&::-webkit-details-marker]:hidden"
                                title="Aktionen"
                                aria-label="Aktionen"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </summary>
                              <div className="absolute left-0 top-full z-50 mt-1 hidden min-w-[190px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl group-open:block dark:border-slate-700 dark:bg-gray-900">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu =
                                      e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement)
                                      menu.open = false;
                                    openEditInvoice(inv);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  <FileText className="h-4 w-4 text-primary" />
                                  Bearbeiten
                                </button>
                                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu =
                                      e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement)
                                      menu.open = false;
                                    void updateStatus(e, inv.id, "Erledigt");
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  <Archive className="h-4 w-4 text-amber-600" />
                                  Archivieren
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu =
                                      e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement)
                                      menu.open = false;
                                    revertToOffer(inv);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  <Undo2 className="h-4 w-4 text-amber-600" />
                                  {inv.sourceOfferId
                                    ? "Zurück zu Angebot"
                                    : "Zurück zu Auftrag"}
                                </button>
                                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu =
                                      e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement)
                                      menu.open = false;
                                    remove(
                                      { stopPropagation: () => {} } as any,
                                      inv.id,
                                    );
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Papierkorb
                                </button>
                              </div>
                            </details>

                            {!invoiceCardExpanded && (
                              <div
                                className={`min-w-0 flex-1 cursor-pointer rounded-lg px-1.5 py-1 transition-colors hover:bg-slate-100 active:bg-slate-200 dark:hover:bg-slate-800/80 dark:active:bg-slate-700 ${isPaid ? "opacity-80" : ""}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleInvoiceCard(inv.id);
                                }}
                              >
                                <div className="relative grid min-w-0 grid-cols-1 items-start gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible md:flex-nowrap md:pr-[40%]">
                                      <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground sm:text-[11px]">
                                        {(() => {
                                          const dt =
                                            inv.orders?.[0]?.createdAt ||
                                            inv.createdAt ||
                                            inv.invoiceDate;
                                          return dt
                                            ? `${new Date(
                                                dt,
                                              ).toLocaleDateString("de-CH", {
                                                day: "2-digit",
                                                month: "2-digit",
                                              })} ${new Date(
                                                dt,
                                              ).toLocaleTimeString("de-CH", {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                              })}`
                                            : "";
                                        })()}
                                      </span>
                                      <span className="min-w-0 max-w-[20rem] shrink truncate text-sm font-semibold">
                                        {isFallbackCustomerName(
                                          inv?.customer?.name,
                                        )
                                          ? "Kunde nicht zugeordnet"
                                          : inv?.customer?.name || "–"}
                                      </span>
                                      {inv?.customer?.customerNumber && (
                                        <span className="shrink-0 text-[11px] text-muted-foreground">
                                          ({inv.customer.customerNumber})
                                        </span>
                                      )}
                                      {invoiceExecutionSites.length > 0 && (
                                        <button
                                          type="button"
                                          onPointerDown={(event) =>
                                            event.stopPropagation()
                                          }
                                          onTouchStart={(event) =>
                                            event.stopPropagation()
                                          }
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            openEditInvoice(inv);
                                            window.setTimeout(
                                              () =>
                                                setEditingExecutionAddress(
                                                  true,
                                                ),
                                              120,
                                            );
                                          }}
                                          className="group relative inline-flex min-w-0 basis-full max-w-full shrink items-center gap-1 overflow-hidden rounded-full border border-cyan-300 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800 hover:bg-cyan-100 sm:basis-auto sm:flex-[0_1_18rem] sm:max-w-[18rem]"
                                          aria-label="Ausführungsort anzeigen und bearbeiten"
                                        >
                                          <MapPin className="h-3 w-3 shrink-0" />
                                          <span className="truncate">
                                            {invoiceExecutionSites.length > 1
                                              ? `Ausführungsorte · ${invoiceExecutionSites.length}`
                                              : executionSite?.siteName ||
                                                executionSite?.siteAddress ||
                                                "Ausführungsort"}
                                          </span>
                                          <InvoiceExecutionSitesTooltip
                                            sites={invoiceExecutionSites}
                                          />
                                        </button>
                                      )}
                                    </div>
                                    <div className="mt-1 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
                                      Leistungen · {visibleItems.length}
                                    </div>
                                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible border-t border-slate-200 pt-2 dark:border-slate-700">
                                      <select
                                        value={effectiveStatus}
                                        onMouseDown={(event) =>
                                          event.stopPropagation()
                                        }
                                        onPointerDown={(event) =>
                                          event.stopPropagation()
                                        }
                                        onPointerUp={(event) =>
                                          event.stopPropagation()
                                        }
                                        onTouchStart={(event) =>
                                          event.stopPropagation()
                                        }
                                        onClick={(event) =>
                                          event.stopPropagation()
                                        }
                                        onChange={(event) =>
                                          updateStatus(
                                            event,
                                            inv.id,
                                            event.target.value,
                                          )
                                        }
                                        className={`h-7 rounded-full border px-2 text-[10px] font-semibold outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 ${
                                          statusColors[effectiveStatus] ||
                                          statusColors.Entwurf
                                        }`}
                                        style={getInvoiceStatusInlineStyle(
                                          effectiveStatus,
                                        )}
                                        aria-label={`Status bearbeiten: ${effectiveStatus}`}
                                      >
                                        {invoiceStatuses.map((status) => (
                                          <option
                                            key={status}
                                            value={status}
                                            style={getInvoiceStatusInlineStyle(
                                              status,
                                            )}
                                          >
                                            {status}
                                          </option>
                                        ))}
                                      </select>
                                      {renderInvoiceCompactFunctionalChips()}
                                      {renderInvoiceQuickActions()}
                                      {useTouchChipPopovers ? (
                                        (invoiceYellowReviewEntries.length >
                                          0 ||
                                          invoiceBlockerEntries.length > 0 ||
                                          invoiceCurrencyReviewCount > 0 ||
                                          Boolean(
                                            invoiceAppointmentDisplayLabel,
                                          )) && (
                                          <span className="inline-flex shrink-0 items-center border-l border-slate-200 pl-3 dark:border-slate-700">
                                            <span className="inline-flex items-center gap-1.5">
                                              {renderInvoiceCompactReviewChip(
                                                "yellow",
                                              )}
                                              {renderInvoiceCompactReviewChip(
                                                "red",
                                              )}
                                              {renderInvoiceCurrencyReviewChip("review-group")}
                                              {invoiceAppointmentDisplayLabel && (
                                                <button
                                                  type="button"
                                                  onPointerDown={(event) =>
                                                    event.stopPropagation()
                                                  }
                                                  onTouchStart={(event) =>
                                                    event.stopPropagation()
                                                  }
                                                  onClick={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                  }}
                                                  className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-300 bg-violet-50 text-violet-800 shadow-sm hover:bg-violet-100"
                                                  aria-label={
                                                    invoiceAppointmentDisplayLabel
                                                  }
                                                >
                                                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                                  <InvoiceViewportTooltip
                                                    preferredWidth={320}
                                                    mobileDismissOnInteraction
                                                  >
                                                    <InvoiceAppointmentTooltipContentV17_90L169
                                                      text={
                                                        invoiceAppointmentDisplayLabel
                                                      }
                                                    />
                                                  </InvoiceViewportTooltip>
                                                </button>
                                              )}
                                            </span>
                                          </span>
                                        )
                                      ) : (
                                        <>
                                          {renderInvoiceServicesChip("compact")}
                                        </>
                                      )}
                                    </div>
                                    <div className="mt-2 flex items-center justify-end gap-2 border-t border-slate-200 pt-2 dark:border-slate-700 sm:hidden">
                                      <div className="shrink-0 whitespace-nowrap text-right font-mono text-sm font-bold tabular-nums">
                                        {formatCurrency(
                                          Number(inv?.total ?? 0),
                                          inv.currency === "EUR"
                                            ? "EUR"
                                            : "CHF",
                                        )}
                                      </div>
                                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </div>
                                  <div className="ml-auto hidden min-w-[74px] shrink-0 flex-col items-end justify-between gap-2 self-stretch border-l border-slate-200 pl-3 dark:border-slate-700 sm:flex">
                                    <div className="flex min-w-0 items-center justify-end gap-2 self-end pr-3 sm:pr-5">
                                      <div className="shrink-0 whitespace-nowrap text-right font-mono text-sm font-bold tabular-nums">
                                        {formatCurrency(
                                          Number(inv?.total ?? 0),
                                          inv.currency === "EUR"
                                            ? "EUR"
                                            : "CHF",
                                        )}
                                      </div>
                                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                            <div
                              className={`flex-1 min-w-0 ${isPaid ? "opacity-80" : ""} ${invoiceCardExpanded ? "" : "hidden"}`}
                            >
                              <div
                                className="flex min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-1.5 py-1 transition-colors hover:bg-blue-50/80 active:bg-blue-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-700 md:flex-nowrap"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleInvoiceCard(inv.id);
                                }}
                              >
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {(() => {
                                    const dt =
                                      inv.orders?.[0]?.createdAt ||
                                      inv.createdAt ||
                                      inv.invoiceDate;
                                    return dt
                                      ? new Date(dt).toLocaleDateString(
                                          "de-CH",
                                          { day: "2-digit", month: "2-digit" },
                                        )
                                      : "";
                                  })()}
                                </span>
                                <span className="min-w-0 max-w-[20rem] shrink truncate font-semibold text-sm sm:text-base text-foreground">
                                  {isFallbackCustomerName(inv?.customer?.name)
                                    ? "⚠️ Kunde nicht zugeordnet"
                                    : (inv?.customer?.name ?? "")}
                                </span>
                                {inv?.customer?.customerNumber && (
                                  <span className="text-xs text-muted-foreground">
                                    ({inv.customer.customerNumber})
                                  </span>
                                )}
                                {mergedCount > 1 && (
                                  <span className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                    Zusammengeführt · {mergedCount}
                                  </span>
                                )}
                                {invoiceExecutionSites.length > 0 && (
                                  <button
                                    type="button"
                                    onPointerDown={(event) =>
                                      event.stopPropagation()
                                    }
                                    onTouchStart={(event) =>
                                      event.stopPropagation()
                                    }
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      openEditInvoice(inv);
                                      window.setTimeout(
                                        () => setEditingExecutionAddress(true),
                                        120,
                                      );
                                    }}
                                    className="group relative inline-flex min-w-0 basis-full max-w-full shrink items-center gap-1 overflow-hidden rounded-full border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-xs text-cyan-800 hover:bg-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:basis-auto sm:flex-[0_1_18rem] sm:max-w-[18rem]"
                                    aria-label="Ausführungsadresse anzeigen und bearbeiten"
                                  >
                                    <MapPin className="h-3 w-3 shrink-0" />
                                    <span className="truncate">
                                      {invoiceExecutionSites.length > 1
                                        ? `Ausführungsorte · ${invoiceExecutionSites.length}`
                                        : executionSite?.siteName ||
                                          executionSite?.siteAddress ||
                                          "Ausführungsort"}
                                    </span>
                                    <InvoiceExecutionSitesTooltip
                                      sites={invoiceExecutionSites}
                                    />
                                  </button>
                                )}
                                {isCustomerDataIncomplete(inv.customer) && (
                                  <MissingCustomerDataBadge
                                    variant="compact"
                                    onClick={() =>
                                      openEditInvoice(inv, {
                                        openCustomerSection: true,
                                      })
                                    }
                                  />
                                )}
                                <span className="ml-auto flex shrink-0 flex-col items-end whitespace-nowrap leading-tight">
                                  <span className="font-mono text-[11px] text-muted-foreground">
                                    {inv?.invoiceNumber ?? ""}
                                  </span>
                                  {dueLabel && (
                                    <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                                      Fällig: {dueLabel}
                                    </span>
                                  )}
                                </span>
                              </div>

                              <div
                                className="mt-3 cursor-pointer rounded-xl border border-slate-300 bg-slate-100/90 p-3 transition-colors hover:bg-slate-200/70 dark:border-slate-600 dark:bg-slate-800/70 dark:hover:bg-slate-800"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEditInvoice(inv);
                                  setExpandedItemIndex(null);
                                }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    openEditInvoice(inv);
                                    setExpandedItemIndex(null);
                                  }
                                }}
                              >
                                <div className="mb-2 text-xs font-medium text-muted-foreground">
                                  Leistungen · {visibleItems.length}
                                </div>
                                <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
                                  {displayedInvoiceItems.map(
                                    (item: any, itemIndex: number) => (
                                      <div
                                        key={`${inv.id}-item-${itemIndex}`}
                                        className="flex min-w-0 items-center gap-2 text-sm"
                                      >
                                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500/80" />
                                        <span className="truncate">
                                          {item.description}
                                        </span>
                                        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                                          {formatCurrency(
                                            Number(item.quantity || 0) *
                                              Number(item.unitPrice || 0),
                                            inv.currency === "EUR"
                                              ? "EUR"
                                              : "CHF",
                                          )}
                                        </span>
                                      </div>
                                    ),
                                  )}
                                </div>
                                {visibleItems.length > 6 && (
                                  <button
                                    type="button"
                                    onPointerDown={(event) =>
                                      event.stopPropagation()
                                    }
                                    onTouchStart={(event) =>
                                      event.stopPropagation()
                                    }
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      toggleInvoiceServiceCard(inv.id);
                                    }}
                                    className="mt-2 flex w-full items-center justify-center rounded-lg border border-blue-200 bg-blue-50/60 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                                  >
                                    {invoiceServicesExpanded
                                      ? "Weniger Leistungen anzeigen"
                                      : `+ ${visibleItems.length - 6} weitere Leistungen`}
                                  </button>
                                )}
                              </div>

                              <div
                                className="relative mt-1.5 flex min-h-8 min-w-0 cursor-pointer flex-wrap items-center gap-1.5 overflow-visible rounded-lg px-1.5 py-1 transition-colors hover:bg-blue-50/80 active:bg-blue-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-700"
                                onClick={(event) => {
                                  if (
                                    event.target instanceof Element &&
                                    event.target.closest(
                                      "button, a, input, select, textarea, label, summary, details, [role='button'], [data-card-toggle-ignore='true']",
                                    )
                                  )
                                    return;
                                  event.stopPropagation();
                                  toggleInvoiceCard(inv.id);
                                }}
                              >
                                <select
                                  onClick={(event) => event.stopPropagation()}
                                  className={`h-8 shrink-0 rounded-lg border px-2 text-[11px] font-medium ${
                                    statusColors[effectiveStatus] ||
                                    statusColors.Entwurf
                                  }`}
                                  style={getInvoiceStatusInlineStyle(
                                    effectiveStatus,
                                  )}
                                  value={effectiveStatus}
                                  onChange={(event) =>
                                    updateStatus(
                                      event,
                                      inv.id,
                                      event.target.value,
                                    )
                                  }
                                >
                                  {invoiceStatuses.map((status) => (
                                    <option
                                      key={status}
                                      style={getStatusStyle(
                                        INVOICE_STATUS_STYLES,
                                        status,
                                      )}
                                    >
                                      {status}
                                    </option>
                                  ))}
                                </select>
                                {renderInvoiceCompactFunctionalChips()}
                                {renderInvoiceQuickActions()}
                                {useTouchChipPopovers ? (
                                  (invoiceYellowReviewEntries.length > 0 ||
                                    invoiceBlockerEntries.length > 0 ||
                                    invoiceCurrencyReviewCount > 0 ||
                                    Boolean(
                                      invoiceAppointmentDisplayLabel,
                                    )) && (
                                    <span className="inline-flex shrink-0 items-center border-l border-slate-200 pl-3 dark:border-slate-700">
                                      <span className="inline-flex items-center gap-1.5">
                                        {renderInvoiceCompactReviewChip(
                                          "yellow",
                                        )}
                                        {renderInvoiceCompactReviewChip("red")}
                                        {renderInvoiceCurrencyReviewChip("review-group")}
                                        {invoiceAppointmentDisplayLabel && (
                                          <button
                                            type="button"
                                            onPointerDown={(event) =>
                                              event.stopPropagation()
                                            }
                                            onTouchStart={(event) =>
                                              event.stopPropagation()
                                            }
                                            onClick={(event) => {
                                              event.preventDefault();
                                              event.stopPropagation();
                                            }}
                                            className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-300 bg-violet-50 text-violet-800 shadow-sm hover:bg-violet-100"
                                            aria-label={
                                              invoiceAppointmentDisplayLabel
                                            }
                                          >
                                            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                            <InvoiceViewportTooltip
                                              preferredWidth={320}
                                              mobileDismissOnInteraction
                                            >
                                              <InvoiceAppointmentTooltipContentV17_90L169
                                                text={
                                                  invoiceAppointmentDisplayLabel
                                                }
                                              />
                                            </InvoiceViewportTooltip>
                                          </button>
                                        )}
                                      </span>
                                    </span>
                                  )
                                ) : (
                                  <>{renderInvoiceServicesChip("expanded")}</>
                                )}
                              </div>

                              <div
                                className="relative mt-2 flex min-h-0 cursor-pointer items-start justify-end gap-3 rounded-lg border-t px-1.5 py-2 transition-colors hover:bg-blue-50/80 active:bg-blue-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-700 sm:min-h-12 sm:justify-between sm:py-3"
                                onClick={(event) => {
                                  if (
                                    event.target instanceof Element &&
                                    event.target.closest(
                                      "button, a, input, select, textarea, label, summary, details, [role='button'], [data-card-toggle-ignore='true']",
                                    )
                                  )
                                    return;
                                  event.stopPropagation();
                                  toggleInvoiceCard(inv.id);
                                }}
                              >
                                <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex" />
                                <div className="ml-auto flex shrink-0 items-end gap-3 sm:flex-col sm:items-end sm:gap-2 sm:border-l sm:border-slate-200 sm:pl-3 sm:dark:border-slate-700">
                                  <div className="shrink-0 text-right">
                                    <div
                                      className={`font-mono text-lg font-bold tabular-nums ${isPaid ? "text-muted-foreground" : "text-foreground"}`}
                                    >
                                      {formatCurrency(
                                        Number(inv?.total ?? 0),
                                        inv.currency === "EUR" ? "EUR" : "CHF",
                                      )}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      inkl. MwSt.
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              {filteredInv.length > visibleCount && (
                <div className="text-center pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount((v) => v + 30)}
                  >
                    Mehr laden ({filteredInv.length - visibleCount} weitere)
                  </Button>
                </div>
              )}
            </>
          );
        })()}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingInvoice(null);
        }}
      >
        <DialogContent
          className={`${dupCheckOpen ? "max-w-5xl w-[96vw]" : "max-w-4xl w-[95vw]"} max-h-[90vh] overflow-y-auto overflow-x-hidden transition-all [&>button]:hidden`}
        >
          <div className="pointer-events-none sticky top-0 z-[80] flex h-0 justify-end">
            <button
              type="button"
              onClick={() => {
                setDialogOpen(false);
                setEditingInvoice(null);
              }}
              className="pointer-events-auto mt-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 shadow-sm transition-colors hover:bg-red-100 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:border-red-900/60 dark:bg-red-950/80 dark:text-red-300 dark:hover:bg-red-900/80"
              aria-label="Bearbeitungsfenster schließen"
              title="Schließen"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <DialogHeader className="pr-12">
            <DialogTitle>
              {editingInvoice ? "Rechnung bearbeiten" : "Neue Rechnung"}
            </DialogTitle>
            {/* Source / traceability info — non-editable */}
            {editingInvoice?.sourceOfferNumber && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Erstellt aus Angebot{" "}
                <span className="font-mono font-medium text-foreground">
                  {editingInvoice.sourceOfferNumber}
                </span>
              </p>
            )}
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
              {/* Top header: customer-data warnings — shown near customer area.
                The chip itself is the only click target — clicking it opens
                the customer-edit section. No duplicate buttons; the existing
                "✏️ Bearbeiten" link inside the customer card and
                "Kunde aktualisieren" save button inside the edit section
                handle all other actions. */}
              {(() => {
                if (historicalInvoiceCustomerLocked) return null;
                const cust = dialogInvoiceCustomer;
                // Canonical rule — name/address/plz/city required; phone/email optional.
                const missingData = !!cust && isCustomerDataIncomplete(cust);
                if (!linkedOrderData?.needsReview && !missingData) return null;
                return (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => openCustomerEditor()}
                      className="tap-safe inline-flex items-center gap-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
                      aria-label="Kundendaten ergänzen — öffnet den Kunde-bearbeiten-Bereich"
                    >
                      {linkedOrderData?.needsReview && (
                        <Badge
                          variant="secondary"
                          className="text-[11px] px-2 py-0.5 bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200 border border-orange-300"
                        >
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Kundendaten prüfen
                        </Badge>
                      )}
                      {!linkedOrderData?.needsReview && missingData && (
                        <MissingCustomerDataBadge variant="standard" />
                      )}
                    </button>
                  </div>
                );
              })()}
              {/* Customer Info / Select / Edit */}
              <div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-1 gap-1">
                  <div className="flex items-center gap-2">
                    <Label>Kunde *</Label>
                    {historicalInvoiceCustomerLocked && (
                      <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Historischer Kundenstand
                      </span>
                    )}
                  </div>
                  {!showNewCustomer &&
                    form.customerId &&
                    !historicalInvoiceCustomerLocked && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                          onClick={() => openCustomerEditor()}
                        >
                          ✏️ Bearbeiten
                        </button>
                        <button
                          className="text-xs text-amber-600 hover:underline flex items-center gap-1"
                          onClick={() => setDupCheckOpen(true)}
                        >
                          🔍 Duplikate prüfen
                        </button>
                      </div>
                    )}
                </div>
                {!showNewCustomer ? (
                  <>
                    {editingInvoice && form.customerId ? (
                      (() => {
                        const cust = dialogInvoiceCustomer;
                        if (!cust) return null;
                        // Required fields: name/address/plz/city — painted red when missing.
                        // Optional fields: phone/email — always neutral (black), never red.
                        const reqMiss = isRequiredCustomerFieldMissing;
                        return (
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
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-semibold">
                                👤 {cust.customerNumber || ""}
                                {cust.customerNumber ? " · " : ""}
                              </span>
                              <span
                                className={`text-sm font-semibold ${isFallbackCustomerName(cust.name) ? "text-amber-600 italic" : reqMiss(cust.name) ? "text-red-500 border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                              >
                                {isFallbackCustomerName(cust.name)
                                  ? "⚠️ Kunde noch nicht zugeordnet (bitte echten Kunden zuweisen)"
                                  : cust.name || "Name fehlt"}
                              </span>
                            </div>
                            <div className="grid grid-cols-1 gap-1 text-xs">
                              <div
                                className={`flex items-center gap-1 ${reqMiss(cust.address) ? "text-red-500" : "text-foreground/70"}`}
                              >
                                <span className="font-medium w-16 shrink-0">
                                  Strasse:
                                </span>
                                <span
                                  className={
                                    reqMiss(cust.address)
                                      ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                      : ""
                                  }
                                >
                                  {cust.address || "fehlt"}
                                </span>
                              </div>
                              <div className="flex gap-3">
                                <div
                                  className={`flex items-center gap-1 ${reqMiss(cust.plz) ? "text-red-500" : "text-foreground/70"}`}
                                >
                                  <span className="font-medium w-16 shrink-0">
                                    PLZ:
                                  </span>
                                  <span
                                    className={
                                      reqMiss(cust.plz)
                                        ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                        : ""
                                    }
                                  >
                                    {cust.plz || "fehlt"}
                                  </span>
                                </div>
                                <div
                                  className={`flex items-center gap-1 ${reqMiss(cust.city) ? "text-red-500" : "text-foreground/70"}`}
                                >
                                  <span className="font-medium shrink-0">
                                    Ort:
                                  </span>
                                  <span
                                    className={
                                      reqMiss(cust.city)
                                        ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                        : ""
                                    }
                                  >
                                    {cust.city || "fehlt"}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 text-foreground/70">
                                <span className="font-medium w-16 shrink-0">
                                  Tel:
                                </span>
                                <span>{cust.phone || "—"}</span>
                              </div>
                              <div className="flex items-center gap-1 text-foreground/70">
                                <span className="font-medium w-16 shrink-0">
                                  E-Mail:
                                </span>
                                <span>{cust.email || "—"}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <CustomerSearchCombobox
                            customers={customers}
                            value={form.customerId}
                            onChange={(id) => onCustomerChange(id)}
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
                            const cust = dialogInvoiceCustomer;
                            if (!cust) return null;
                            const reqMiss = isRequiredCustomerFieldMissing;
                            return (
                              <div className="mt-2 border rounded-lg p-2 sm:p-3 bg-muted/30 space-y-1.5 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-semibold">
                                    👤 {cust.customerNumber || ""}
                                    {cust.customerNumber ? " · " : ""}
                                  </span>
                                  <span
                                    className={`text-sm font-semibold ${isFallbackCustomerName(cust.name) ? "text-amber-600 italic" : reqMiss(cust.name) ? "text-red-500 border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                  >
                                    {isFallbackCustomerName(cust.name)
                                      ? "⚠️ Kunde noch nicht zugeordnet (bitte echten Kunden zuweisen)"
                                      : cust.name || "Name fehlt"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-1 gap-1 text-xs">
                                  <div
                                    className={`flex items-center gap-1 ${reqMiss(cust.address) ? "text-red-500" : "text-foreground/70"}`}
                                  >
                                    <span className="font-medium w-16 shrink-0">
                                      Strasse:
                                    </span>
                                    <span
                                      className={
                                        reqMiss(cust.address)
                                          ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                          : ""
                                      }
                                    >
                                      {cust.address || "fehlt"}
                                    </span>
                                  </div>
                                  <div className="flex gap-3">
                                    <div
                                      className={`flex items-center gap-1 ${reqMiss(cust.plz) ? "text-red-500" : "text-foreground/70"}`}
                                    >
                                      <span className="font-medium w-16 shrink-0">
                                        PLZ:
                                      </span>
                                      <span
                                        className={
                                          reqMiss(cust.plz)
                                            ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                            : ""
                                        }
                                      >
                                        {cust.plz || "fehlt"}
                                      </span>
                                    </div>
                                    <div
                                      className={`flex items-center gap-1 ${reqMiss(cust.city) ? "text-red-500" : "text-foreground/70"}`}
                                    >
                                      <span className="font-medium shrink-0">
                                        Ort:
                                      </span>
                                      <span
                                        className={
                                          reqMiss(cust.city)
                                            ? "border-b border-red-400 border-dashed pb-0.5 italic"
                                            : ""
                                        }
                                      >
                                        {cust.city || "fehlt"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 text-foreground/70">
                                    <span className="font-medium w-16 shrink-0">
                                      Tel:
                                    </span>
                                    <span>{cust.phone || "—"}</span>
                                  </div>
                                  <div className="flex items-center gap-1 text-foreground/70">
                                    <span className="font-medium w-16 shrink-0">
                                      E-Mail:
                                    </span>
                                    <span>{cust.email || "—"}</span>
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
                    className="border rounded-lg p-2 sm:p-3 space-y-2 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 min-w-0"
                  >
                    <p className="text-xs font-semibold text-muted-foreground">
                      {editingCustomer
                        ? "✏️ Kunde bearbeiten"
                        : "➕ Neuer Kunde erstellen"}
                    </p>
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
                        Zurück zur Rechnung
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {!dupCheckOpen && !editingInvoice && (
                <div className="scroll-mt-20 rounded-xl border border-cyan-200 bg-cyan-50/40 p-2.5 sm:p-3 dark:border-cyan-900/60 dark:bg-cyan-950/20">
                  <div
                    role={newInvoiceExecutionSite ? "button" : undefined}
                    tabIndex={newInvoiceExecutionSite ? 0 : -1}
                    onClick={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest("button,input,select,textarea,a"))
                        return;
                      toggleInvoiceExecutionAddressEditor(
                        newInvoiceExecutionSite,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (
                        newInvoiceExecutionSite &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        toggleInvoiceExecutionAddressEditor(
                          newInvoiceExecutionSite,
                        );
                      }
                    }}
                    className={`-m-1 grid grid-cols-1 gap-2 rounded-lg p-1.5 outline-none transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start ${
                      newInvoiceExecutionSite
                        ? "cursor-pointer hover:bg-cyan-100/80 focus-visible:ring-2 focus-visible:ring-cyan-400 dark:hover:bg-cyan-900/30"
                        : ""
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-slate-400"
                        checked={Boolean(newInvoiceExecutionSite)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          setNewInvoiceExecutionAddressEnabled(
                            event.target.checked,
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-5">
                          Ausführungsadresse abweichend von Rechnungsadresse
                        </span>
                        <span className="block max-w-2xl text-xs leading-4 text-muted-foreground">
                          Nur aktivieren, wenn die Arbeit an einem anderen Ort
                          ausgeführt wird.
                        </span>
                      </span>
                    </div>
                    {newInvoiceExecutionSite && !editingExecutionAddress && (
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 w-full justify-start px-2 text-xs sm:w-auto"
                          onClick={addInvoiceExecutionSite}
                          disabled={saving}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          Arbeitsort hinzufügen
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 w-full justify-start px-2 text-xs sm:w-auto"
                          onClick={() => setEditingExecutionAddress(true)}
                          disabled={saving}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Bearbeiten
                        </Button>
                      </div>
                    )}
                  </div>

                  {!newInvoiceExecutionSite ? (
                    <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-background px-3 py-2 text-sm text-muted-foreground">
                      Die Rechnungsadresse gilt auch als Ausführungsadresse.
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                      {editingExecutionAddress ? (
                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs">Objekt / Bereich</Label>
                            <Input
                              value={newInvoiceExecutionSite.siteName || ""}
                              placeholder="z. B. Wohnpark Limmat, Serverraum"
                              onChange={(event: any) =>
                                updateNewInvoiceExecutionSite(
                                  "siteName",
                                  event?.target?.value ?? "",
                                )
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-xs">
                              Strasse + Hausnummer
                            </Label>
                            <Input
                              value={newInvoiceExecutionSite.siteAddress || ""}
                              placeholder="Strasse + Hausnummer"
                              onChange={(event: any) =>
                                updateNewInvoiceExecutionSite(
                                  "siteAddress",
                                  event?.target?.value ?? "",
                                )
                              }
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr]">
                            <div>
                              <Label className="text-xs">PLZ</Label>
                              <Input
                                value={newInvoiceExecutionSite.sitePlz || ""}
                                placeholder="PLZ"
                                onChange={(event: any) =>
                                  updateNewInvoiceExecutionSite(
                                    "sitePlz",
                                    event?.target?.value ?? "",
                                  )
                                }
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Ort</Label>
                              <Input
                                value={newInvoiceExecutionSite.siteCity || ""}
                                placeholder="Ort"
                                onChange={(event: any) =>
                                  updateNewInvoiceExecutionSite(
                                    "siteCity",
                                    event?.target?.value ?? "",
                                  )
                                }
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">
                              Hinweis zum Ausführungsort
                            </Label>
                            <Input
                              value={newInvoiceExecutionSite.siteNote || ""}
                              placeholder="Optionaler interner Hinweis"
                              onChange={(event: any) =>
                                updateNewInvoiceExecutionSite(
                                  "siteNote",
                                  event?.target?.value ?? "",
                                )
                              }
                            />
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={addInvoiceExecutionSite}
                              disabled={saving}
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" />
                              Arbeitsort hinzufügen
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void save(false)}
                              disabled={saving}
                            >
                              {saving ? "Speichern..." : "Adresse speichern"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold">
                              {newInvoiceExecutionSite.siteName ||
                                "Ausführungsadresse"}
                            </div>
                            <div className="mt-1 grid grid-cols-[74px_1fr] gap-x-2 gap-y-1 text-sm">
                              <span className="text-muted-foreground">
                                Strasse:
                              </span>
                              <span className="break-words">
                                {newInvoiceExecutionSite.siteAddress || "–"}
                              </span>
                              <span className="text-muted-foreground">
                                PLZ / Ort:
                              </span>
                              <span className="break-words">
                                {[
                                  newInvoiceExecutionSite.sitePlz,
                                  newInvoiceExecutionSite.siteCity,
                                ]
                                  .filter(Boolean)
                                  .join(" ") || "–"}
                              </span>
                              {newInvoiceExecutionSite.siteNote && (
                                <>
                                  <span className="text-muted-foreground">
                                    Hinweis:
                                  </span>
                                  <span className="break-words">
                                    {newInvoiceExecutionSite.siteNote}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!dupCheckOpen &&
                editingInvoice &&
                collectInvoiceExecutionSites({
                  items,
                  orders: editingInvoice?.orders || [],
                }).length <= 1 &&
                (() => {
                  const executionSite = collectInvoiceExecutionSites({
                    items,
                    orders: editingInvoice?.orders || [],
                  })[0];
                  if (!executionSite) return null;
                  return (
                    <div className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-2.5 outline-none sm:p-3 dark:border-cyan-900/60 dark:bg-cyan-950/20">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          const target = event.target as HTMLElement;
                          if (target.closest("button,input,select,textarea,a"))
                            return;
                          toggleInvoiceExecutionAddressEditor(executionSite);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleInvoiceExecutionAddressEditor(executionSite);
                          }
                        }}
                        className="-m-1 grid cursor-pointer grid-cols-1 gap-2 rounded-lg p-1.5 outline-none transition-colors hover:bg-cyan-100/80 focus-visible:ring-2 focus-visible:ring-cyan-400 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start dark:hover:bg-cyan-900/30"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-2">
                          <input
                            type="checkbox"
                            checked
                            readOnly
                            onClick={(event) => event.stopPropagation()}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                            aria-label="Ausführungsadresse abweichend"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold leading-5">
                              Ausführungsadresse abweichend von Rechnungsadresse
                            </div>
                            <p className="max-w-2xl text-xs leading-4 text-muted-foreground">
                              Nur aktivieren, wenn die Arbeit an einem anderen
                              Ort ausgeführt wird.
                            </p>
                          </div>
                        </div>
                        {!editingExecutionAddress && (
                          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-1">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                addInvoiceExecutionSite();
                              }}
                              disabled={saving}
                              className="inline-flex h-7 w-full items-center justify-start rounded-md border border-slate-200 bg-white px-2 text-xs font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" />
                              Arbeitsort hinzufügen
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditingExecutionAddress(true);
                              }}
                              disabled={saving}
                              className="inline-flex h-7 w-full items-center justify-start rounded-md border border-slate-200 bg-white px-2 text-xs font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
                            >
                              <Pencil className="mr-1 h-3.5 w-3.5" />
                              Bearbeiten
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        {editingExecutionAddress ? (
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <Label className="text-xs">
                                Objekt / Bereich
                              </Label>
                              <Input
                                value={executionSite.siteName || ""}
                                onChange={(event: any) =>
                                  updateInvoiceExecutionSite(
                                    "siteName",
                                    event?.target?.value ?? "",
                                  )
                                }
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <Label className="text-xs">Strasse</Label>
                              <Input
                                value={executionSite.siteAddress || ""}
                                onChange={(event: any) =>
                                  updateInvoiceExecutionSite(
                                    "siteAddress",
                                    event?.target?.value ?? "",
                                  )
                                }
                              />
                            </div>
                            <div>
                              <Label className="text-xs">PLZ</Label>
                              <Input
                                value={executionSite.sitePlz || ""}
                                onChange={(event: any) =>
                                  updateInvoiceExecutionSite(
                                    "sitePlz",
                                    event?.target?.value ?? "",
                                  )
                                }
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Ort</Label>
                              <Input
                                value={executionSite.siteCity || ""}
                                onChange={(event: any) =>
                                  updateInvoiceExecutionSite(
                                    "siteCity",
                                    event?.target?.value ?? "",
                                  )
                                }
                              />
                            </div>
                            <div className="sm:col-span-2 flex flex-wrap items-center justify-end gap-2 pt-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  addInvoiceExecutionSite();
                                }}
                                disabled={saving}
                              >
                                <Plus className="mr-1 h-3.5 w-3.5" />
                                Arbeitsort hinzufügen
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void saveInvoiceExecutionAddress();
                                }}
                                disabled={saving}
                              >
                                {saving ? "Speichern..." : "Adresse speichern"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold">
                                {executionSite.siteName || "Ausführungsadresse"}
                              </div>
                              <div className="mt-1 grid grid-cols-[74px_1fr] gap-x-2 gap-y-1 text-sm">
                                <span className="text-muted-foreground">
                                  Strasse:
                                </span>
                                <span className="break-words">
                                  {executionSite.siteAddress || "–"}
                                </span>
                                <span className="text-muted-foreground">
                                  PLZ / Ort:
                                </span>
                                <span className="break-words">
                                  {[
                                    executionSite.sitePlz,
                                    executionSite.siteCity,
                                  ]
                                    .filter(Boolean)
                                    .join(" ") || "–"}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

              {/* Form fields — collapsed when dupCheck open */}
              {dupCheckOpen ? (
                <div className="p-2 bg-muted/40 rounded border border-dashed text-xs text-muted-foreground flex items-center justify-between">
                  <span>
                    {items?.filter((i: InvoiceItem) => i.description).length ||
                      0}{" "}
                    Leistung(en) · {formatCurrency(total, currency)} ·{" "}
                    {form.invoiceDate || "–"} ·{" "}
                    {editingInvoice?.status || "Neu"}
                  </span>
                  <span className="text-[10px] italic">
                    Duplikat-Prüfung aktiv — Form eingeklappt
                  </span>
                </div>
              ) : (
                <>
                  <div
                    ref={serviceItemsRef}
                    className="scroll-mt-24 space-y-3 rounded-xl border bg-background p-3 sm:p-4"
                  >
                    <div className="space-y-2">
                      {(() => {
                        const currentSites = collectInvoiceExecutionSites({
                          items,
                          orders: editingInvoice?.orders || [],
                        });
                        const multiSite = currentSites.length > 1;
                        return (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h3 className="whitespace-nowrap text-base font-semibold">
                                {multiSite
                                  ? "Arbeitsorte & Leistungen"
                                  : `Leistungen · ${items?.length || 0}`}
                              </h3>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {multiSite && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={toggleAllInvoiceSites}
                                  >
                                    {expandedInvoiceSiteKeys.size ===
                                    groupInvoiceItemsByExecutionSite(
                                      items || [],
                                      currentSites,
                                    ).length
                                      ? "Übersicht"
                                      : "Alle öffnen"}
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={addItem}
                                >
                                  <Plus className="mr-1 h-4 w-4" /> Leistung
                                  hinzufügen
                                </Button>
                              </div>
                            </div>
                            {multiSite ? (
                              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                <span className="min-w-0 truncate">
                                  {currentSites.length} Arbeitsorte ·{" "}
                                  {items?.length || 0} Leistungen
                                </span>
                                <span className="shrink-0 font-mono font-medium text-foreground">
                                  {formatCurrency(subtotal, currency)}
                                </span>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Kompakte Übersicht. Zum Bearbeiten die Leistung
                                aufklappen.
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    <div className="space-y-2">
                      {(() => {
                        const groups = groupInvoiceItemsByExecutionSite(
                          items || [],
                          collectInvoiceExecutionSites({
                            items,
                            orders: editingInvoice?.orders || [],
                          }),
                        );
                        const renderEntries = (
                          entries: Array<{ item: InvoiceItem; index: number }>,
                        ) =>
                          entries.map(({ item, index: idx }) => {
                            const quantity = Number(item?.quantity ?? 0);
                            const unitPrice = Number(item?.unitPrice ?? 0);
                            const lineTotal = unitPrice * quantity;
                            const matchedService = services.find(
                              (service: any) =>
                                normalizeInvoiceServiceName(service?.name) ===
                                normalizeInvoiceServiceName(item?.description),
                            );
                            const hasMissingValues =
                              !compactInvoiceValue(item?.description) ||
                              !compactInvoiceValue(item?.unit) ||
                              quantity <= 0 ||
                              unitPrice <= 0;
                            const catalogMismatch = Boolean(
                              matchedService &&
                              (compactInvoiceValue(matchedService.unit) !==
                                compactInvoiceValue(item?.unit) ||
                                Math.abs(
                                  Number(matchedService.defaultPrice || 0) -
                                    unitPrice,
                                ) >= 0.001),
                            );
                            const itemNeedsReview =
                              hasMissingValues ||
                              !matchedService ||
                              catalogMismatch;
                            const itemReviewReasonV17_90L134 =
                              getInvoiceServiceReviewReasonV17_90L134(
                                item,
                                services || [],
                              ) || (itemNeedsReview ? "Manuell prüfen" : "");
                            const isExpanded = expandedItemIndex === idx;
                            const isMenuOpen = serviceActionMenuIndex === idx;

                            return (
                              <div
                                key={idx}
                                data-service-item-index={idx}
                                className={`relative overflow-visible rounded-xl border transition-colors ${
                                  hasMissingValues
                                    ? "border-red-300 bg-red-50/30 dark:border-red-800/70 dark:bg-red-950/10"
                                    : itemNeedsReview
                                      ? "border-amber-300 bg-amber-50/30"
                                      : "border-slate-200 bg-background"
                                }`}
                              >
                                <div
                                  className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2.5 transition-colors ${
                                    isExpanded ? "rounded-t-xl" : "rounded-xl"
                                  } ${
                                    hasMissingValues
                                      ? "hover:bg-red-100/70 dark:hover:bg-red-900/25"
                                      : itemNeedsReview
                                        ? "hover:bg-amber-100/70 dark:hover:bg-amber-900/25"
                                        : "hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedItemIndex((current) =>
                                        current === idx ? null : idx,
                                      );
                                      setServiceActionMenuIndex(null);
                                    }}
                                    className="min-w-0 text-left"
                                  >
                                    <div className="min-w-0">
                                      <span className="block truncate font-medium">
                                        {item?.description || "Neue Leistung"}
                                      </span>
                                    </div>
                                    <div className="mt-0.5 grid min-w-0 grid-cols-1 items-center gap-x-8 gap-y-1 sm:grid-cols-[17rem_auto]">
                                      <div className="truncate text-xs text-muted-foreground">
                                        {quantity > 0 ? quantity : "prüfen"}{" "}
                                        {item?.unit || "Einheit prüfen"} ×{" "}
                                        {unitPrice > 0
                                          ? formatCurrency(unitPrice, currency)
                                          : "Preis prüfen"}
                                      </div>
                                      {itemNeedsReview && (
                                        <span className="inline-flex min-w-0 max-w-[12rem] items-center overflow-hidden border-l border-slate-200 pl-3 dark:border-slate-700">
                                          <span
                                            title={itemReviewReasonV17_90L134}
                                            className={`max-w-full truncate whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                              hasMissingValues
                                                ? "border-red-300 bg-red-100 text-red-800"
                                                : "border-amber-300 bg-amber-100 text-amber-800"
                                            }`}
                                          >
                                            {itemReviewReasonV17_90L134}
                                          </span>
                                        </span>
                                      )}
                                    </div>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedItemIndex((current) =>
                                        current === idx ? null : idx,
                                      );
                                      setServiceActionMenuIndex(null);
                                    }}
                                    className="flex items-center gap-2 whitespace-nowrap"
                                  >
                                    <span className="font-mono font-semibold">
                                      {formatCurrency(lineTotal, currency)}
                                    </span>
                                    <ChevronDown
                                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                                        isExpanded ? "rotate-180" : ""
                                      }`}
                                    />
                                  </button>

                                  <div className="relative">
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setServiceActionMenuIndex((current) =>
                                          current === idx ? null : idx,
                                        );
                                      }}
                                      className="rounded-md border border-slate-200 bg-background p-1.5 text-slate-600 hover:bg-muted"
                                      title="Aktionen"
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </button>
                                    {isMenuOpen && (
                                      <div
                                        onClick={(event) =>
                                          event.stopPropagation()
                                        }
                                        className="absolute bottom-full right-0 z-50 mb-1 w-60 rounded-md border bg-background py-1 text-sm shadow-xl"
                                      >
                                        {compactInvoiceValue(
                                          item?.description,
                                        ) && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              saveInvoiceItemToServices(idx)
                                            }
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                                          >
                                            <Plus className="h-3.5 w-3.5" />
                                            In Leistungskatalog übernehmen
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => removeItem(idx)}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                          Löschen
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="space-y-3 border-t border-slate-200 bg-background p-3 dark:border-slate-700">
                                    {collectInvoiceExecutionSites({
                                      items,
                                      orders: editingInvoice?.orders || [],
                                    }).length > 1 && (
                                      <div className="rounded-lg border border-cyan-200 bg-cyan-50/60 p-2">
                                        <Label className="text-xs">
                                          Arbeitsort
                                        </Label>
                                        <select
                                          className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                          value={(() => {
                                            const sites =
                                              collectInvoiceExecutionSites({
                                                items,
                                                orders:
                                                  editingInvoice?.orders || [],
                                              });
                                            const matched = sites.find(
                                              (site) =>
                                                invoiceSiteKey(site) ===
                                                invoiceSiteKey(item),
                                            );
                                            return matched
                                              ? invoiceGroupKeyForSite(matched)
                                              : "";
                                          })()}
                                          onChange={(event) =>
                                            assignInvoiceItemToSite(
                                              idx,
                                              event.target.value,
                                            )
                                          }
                                        >
                                          <option value="">
                                            Arbeitsort wählen…
                                          </option>
                                          {collectInvoiceExecutionSites({
                                            items,
                                            orders:
                                              editingInvoice?.orders || [],
                                          }).map((site, siteIndex) => {
                                            const key =
                                              invoiceGroupKeyForSite(site);
                                            return (
                                              <option
                                                key={`${key}-${siteIndex}`}
                                                value={key}
                                              >
                                                {siteIndex + 1}.{" "}
                                                {site.siteName ||
                                                  site.siteAddress ||
                                                  "Neuer Arbeitsort"}
                                              </option>
                                            );
                                          })}
                                        </select>
                                      </div>
                                    )}
                                    <ServiceCombobox
                                      value={item?.description ?? ""}
                                      services={services as ServiceOption[]}
                                      onChange={(name, svc) =>
                                        onItemServiceSelect(idx, name, svc)
                                      }
                                      onServiceCreated={handleServiceCreated}
                                      currentPrice={
                                        item?.unitPrice != null
                                          ? String(item.unitPrice)
                                          : undefined
                                      }
                                      currentUnit={item?.unit}
                                      contextLabel="Rechnung"
                                      saveButtonPlacement="none"
                                    />
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                      <div>
                                        <Label className="text-xs">
                                          Einheit
                                        </Label>
                                        <select
                                          className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                          value={item?.unit ?? ""}
                                          onChange={(event: any) =>
                                            updateItem(
                                              idx,
                                              "unit",
                                              event?.target?.value ?? "",
                                            )
                                          }
                                        >
                                          <option value="">
                                            Einheit prüfen
                                          </option>
                                          <option value="Stunde">Stunde</option>
                                          <option value="Tag">Tag</option>
                                          <option value="Pauschal">
                                            Pauschal
                                          </option>
                                          <option value="Meter">Meter</option>
                                          <option value="Quadratmeter">
                                            Quadratmeter
                                          </option>
                                          <option value="Kubikmeter">
                                            Kubikmeter
                                          </option>
                                          <option value="Stück">Stück</option>
                                          <option value="Kilogramm">
                                            Kilogramm
                                          </option>
                                          <option value="Tonne">Tonne</option>
                                          <option value="Liter">Liter</option>
                                        </select>
                                      </div>
                                      <div>
                                        <Label className="text-xs">Menge</Label>
                                        <Input
                                          type="number"
                                          step="0.25"
                                          placeholder="prüfen"
                                          className={`h-9 ${quantity <= 0 ? "border-red-500 bg-red-50" : ""}`}
                                          value={
                                            quantity <= 0
                                              ? ""
                                              : (item?.quantity ?? "")
                                          }
                                          onChange={(event: any) =>
                                            updateItem(
                                              idx,
                                              "quantity",
                                              event?.target?.value ?? "0",
                                            )
                                          }
                                        />
                                      </div>
                                      <div>
                                        <Label className="text-xs">
                                          Preis ({currency})
                                        </Label>
                                        <Input
                                          type="number"
                                          step="0.05"
                                          placeholder="prüfen"
                                          className={`h-9 ${unitPrice <= 0 ? "border-red-500 bg-red-50" : ""}`}
                                          value={
                                            unitPrice <= 0
                                              ? ""
                                              : (item?.unitPrice ?? "")
                                          }
                                          onChange={(event: any) =>
                                            updateItem(
                                              idx,
                                              "unitPrice",
                                              event?.target?.value ?? "0",
                                            )
                                          }
                                        />
                                      </div>
                                    </div>
                                    {itemNeedsReview && (
                                      <div
                                        className={`rounded-lg border px-3 py-2 text-xs ${
                                          hasMissingValues
                                            ? "border-red-300 bg-red-100/70 text-red-900"
                                            : "border-amber-300 bg-amber-50 text-amber-900"
                                        }`}
                                      >
                                        <div className="font-semibold">
                                          {hasMissingValues
                                            ? "Leistung prüfen"
                                            : "Manuell prüfen"}
                                        </div>
                                        <div className="mt-0.5">
                                          {hasMissingValues
                                            ? "Leistung, Einheit, Menge oder Preis vervollständigen."
                                            : !matchedService
                                              ? "Nicht im Leistungskatalog. Optional über das Drei-Punkte-Menü übernehmen."
                                              : "Preis oder Einheit weicht vom Leistungskatalog ab."}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          });

                        if (groups.length <= 1) {
                          return renderEntries(groups[0]?.entries || []);
                        }

                        return groups.map((group, groupIndex) => (
                          <details
                            key={group.key}
                            open={expandedInvoiceSiteKeys.has(group.key)}
                            onToggle={(event) => {
                              const open = event.currentTarget.open;
                              setExpandedInvoiceSiteKeys((current) => {
                                const next = new Set(current);
                                if (open) next.add(group.key);
                                else next.delete(group.key);
                                return next;
                              });
                            }}
                            className="overflow-visible space-y-1.5"
                          >
                            <summary
                              className={`flex cursor-pointer list-none items-center justify-between gap-3 border-2 border-cyan-400 bg-cyan-100/75 px-3 py-2.5 transition-colors hover:bg-cyan-200/70 dark:border-cyan-800 dark:bg-cyan-950/25 dark:hover:bg-cyan-900/35 [&::-webkit-details-marker]:hidden ${
                                expandedInvoiceSiteKeys.has(group.key)
                                  ? "rounded-t-xl rounded-b-none border-b-0"
                                  : "rounded-xl"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">
                                  📍 {groupIndex + 1}.{" "}
                                  {group.site?.siteName ||
                                    group.site?.siteAddress ||
                                    `Ausführungsort ${groupIndex + 1}`}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                  {[
                                    group.site?.siteAddress,
                                    [group.site?.sitePlz, group.site?.siteCity]
                                      .filter(Boolean)
                                      .join(" "),
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "Adresse nicht angegeben"}
                                </div>
                                {(() => {
                                  const groupReviewEntries =
                                    buildInvoiceServiceReviewEntriesV17_90L135G(
                                      group.entries.map((entry) => entry.item),
                                      services || [],
                                      currency,
                                    );
                                  const groupBlockerEntries =
                                    groupReviewEntries.filter(
                                      (entry) => entry.category === "blocker",
                                    );
                                  const groupYellowEntries =
                                    groupReviewEntries.filter(
                                      (entry) => entry.category !== "blocker",
                                    );
                                  if (
                                    groupYellowEntries.length === 0 &&
                                    groupBlockerEntries.length === 0
                                  )
                                    return null;
                                  return (
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                      {groupYellowEntries.length > 0 && (
                                        <span
                                          className="relative inline-flex max-w-[12rem] items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
                                          role="button"
                                          tabIndex={0}
                                          onClick={(event) =>
                                            event.stopPropagation()
                                          }
                                          onPointerDown={(event) =>
                                            event.stopPropagation()
                                          }
                                        >
                                          <span className="truncate whitespace-nowrap">
                                            Leistungen prüfen ·{" "}
                                            {groupYellowEntries.length}
                                          </span>
                                          <InvoiceViewportTooltip
                                            preferredWidth={432}
                                            autoClose={false}
                                          >
                                            <InvoiceServiceReviewTooltipContentV17_90L135G
                                              total={groupYellowEntries.length}
                                              entries={groupYellowEntries}
                                              title={`Leistungen prüfen · ${groupYellowEntries.length}`}
                                            />
                                          </InvoiceViewportTooltip>
                                        </span>
                                      )}
                                      {groupBlockerEntries.length > 0 && (
                                        <span
                                          className="relative inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800"
                                          role="button"
                                          tabIndex={0}
                                          onClick={(event) =>
                                            event.stopPropagation()
                                          }
                                          onPointerDown={(event) =>
                                            event.stopPropagation()
                                          }
                                        >
                                          <AlertTriangle className="h-3 w-3 shrink-0" />
                                          <span className="truncate whitespace-nowrap">
                                            Rechnung prüfen ·{" "}
                                            {groupBlockerEntries.length}
                                          </span>
                                          <InvoiceViewportTooltip
                                            preferredWidth={432}
                                            autoClose={false}
                                          >
                                            <InvoiceServiceReviewTooltipContentV17_90L135G
                                              total={groupBlockerEntries.length}
                                              entries={groupBlockerEntries}
                                              title={`Rechnung prüfen · ${groupBlockerEntries.length}`}
                                            />
                                          </InvoiceViewportTooltip>
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[10px] text-muted-foreground">
                                  {group.entries.length} Leistungen
                                </div>
                                <div className="font-mono text-sm font-bold text-emerald-700">
                                  {formatCurrency(group.subtotal, currency)}
                                </div>
                                <button
                                  type="button"
                                  className="mt-1 text-[11px] font-medium text-emerald-700 hover:underline"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setEditingInvoiceSiteKey((current) =>
                                      current === group.key ? null : group.key,
                                    );
                                    setExpandedInvoiceSiteKeys(
                                      (current) =>
                                        new Set([...current, group.key]),
                                    );
                                  }}
                                >
                                  Arbeitsort bearbeiten
                                </button>
                              </div>
                            </summary>
                            {editingInvoiceSiteKey === group.key &&
                              group.site && (
                                <div className="ml-2 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-background p-3 sm:grid-cols-2">
                                  <div className="sm:col-span-2">
                                    <Label className="text-xs">
                                      Objekt / Bereich
                                    </Label>
                                    <Input
                                      value={group.site.siteName || ""}
                                      onChange={(event) =>
                                        updateInvoiceGroupSite(
                                          group.key,
                                          "siteName",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </div>
                                  <div className="sm:col-span-2">
                                    <Label className="text-xs">Strasse</Label>
                                    <Input
                                      value={group.site.siteAddress || ""}
                                      onChange={(event) =>
                                        updateInvoiceGroupSite(
                                          group.key,
                                          "siteAddress",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">PLZ</Label>
                                    <Input
                                      value={group.site.sitePlz || ""}
                                      onChange={(event) =>
                                        updateInvoiceGroupSite(
                                          group.key,
                                          "sitePlz",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">Ort</Label>
                                    <Input
                                      value={group.site.siteCity || ""}
                                      onChange={(event) =>
                                        updateInvoiceGroupSite(
                                          group.key,
                                          "siteCity",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </div>
                                  <div className="sm:col-span-2 flex justify-end">
                                    {!group.site.sourceOrderId && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                        onClick={() =>
                                          removeInvoiceExecutionSite(group.key)
                                        }
                                      >
                                        Arbeitsort löschen
                                      </Button>
                                    )}
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        setEditingInvoiceSiteKey(null)
                                      }
                                    >
                                      Fertig
                                    </Button>
                                  </div>
                                </div>
                              )}
                            <div className="ml-2 space-y-2 bg-background pt-1">
                              {renderEntries(group.entries)}
                            </div>
                          </details>
                        ));
                      })()}
                    </div>
                  </div>

                  <div className="space-y-4 border-t-4 border-slate-300 pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-base font-semibold">
                        Rechnungsdaten & Betrag
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        Klar getrennt von den Leistungen
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <Label>Rechnungsdatum</Label>
                        <Input
                          type="date"
                          value={form.invoiceDate}
                          onChange={(e: any) => {
                            const invoiceDate = e?.target?.value ?? "";
                            setForm((current) => ({
                              ...current,
                              invoiceDate,
                              dueDate: addDaysToInvoiceDate(
                                invoiceDate,
                                defaultPaymentDays,
                              ),
                              paymentDays: String(defaultPaymentDays),
                            }));
                          }}
                        />
                      </div>
                      <div>
                        <Label>Fälligkeitsdatum</Label>
                        <Input
                          type="date"
                          min={form.invoiceDate || undefined}
                          value={form.dueDate}
                          onChange={(e: any) =>
                            setForm((current) => ({
                              ...current,
                              dueDate: e?.target?.value ?? "",
                            }))
                          }
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Standardmäßig {defaultPaymentDays} Tage. Für diese
                          Rechnung frei änderbar.
                        </p>
                      </div>
                      {editingInvoice && (
                        <div>
                          <Label>Status</Label>
                          <select
                            id="invoice-status-select"
                            className="flex h-10 w-full rounded-md border border-input px-3 text-sm"
                            style={getStatusStyle(
                              INVOICE_STATUS_STYLES,
                              editingInvoice.status,
                            )}
                            value={editingInvoice.status}
                            onChange={(e: any) =>
                              setEditingInvoice({
                                ...editingInvoice,
                                status: e.target.value,
                              })
                            }
                          >
                            {invoiceStatuses.map((status) => (
                              <option
                                key={status}
                                style={getStatusStyle(
                                  INVOICE_STATUS_STYLES,
                                  status,
                                )}
                              >
                                {status}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <Label>Währung</Label>
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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

                    <div className="min-w-0 space-y-3 rounded-xl border-2 border-slate-400 bg-slate-100/90 p-2 sm:p-4 dark:border-slate-700 dark:bg-slate-900/70">
                      <MwStControl vatRate={vatRate} onChange={setVatRate} />
                      <div className="min-w-0 space-y-1 border-t border-slate-300 pt-2 text-xs sm:text-sm">
                        <div className="flex min-w-0 justify-between">
                          <span className="shrink-0">Netto</span>
                          <span className="font-mono">
                            {formatCurrency(subtotal, currency)}
                          </span>
                        </div>
                        {vatRate > 0 && (
                          <div className="flex min-w-0 justify-between">
                            <span className="shrink-0">MwSt. {vatRate}%</span>
                            <span className="font-mono">
                              {formatCurrency(vatAmount, currency)}
                            </span>
                          </div>
                        )}
                        <div className="flex min-w-0 justify-between border-t-2 border-slate-300 pt-2 text-sm font-bold sm:text-base">
                          <span className="shrink-0">Total</span>
                          <span className="font-mono text-primary">
                            {formatCurrency(total, currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <>
                    <div className="rounded-xl border bg-background p-2 sm:p-3">
                      <div
                        className={
                          editingInvoice
                            ? "grid grid-cols-1 gap-2 sm:grid-cols-3"
                            : "grid grid-cols-1 gap-2 sm:grid-cols-2"
                        }
                      >
                        {editingInvoice ? (
                          <>
                            <Button
                              type="button"
                              onClick={() => saveEdit(false)}
                              disabled={saving}
                              className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                            >
                              {saving ? "Speichern..." : "Speichern"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => saveEdit(true)}
                              disabled={saving}
                              className="w-full border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            >
                              {saving
                                ? "Speichern..."
                                : "Speichern & schließen"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={saveAndArchive}
                              disabled={saving}
                              className="w-full border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            >
                              <Archive className="mr-1 h-4 w-4" /> Archivieren
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              onClick={() => save(false)}
                              disabled={saving}
                              className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                            >
                              {saving ? "Speichern..." : "Speichern"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => save(true)}
                              disabled={saving}
                              className="w-full border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            >
                              {saving
                                ? "Speichern..."
                                : "Speichern & schließen"}
                            </Button>
                          </>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setDialogOpen(false);
                          setEditingInvoice(null);
                        }}
                        disabled={saving}
                        className="mt-2 w-full"
                      >
                        Abbrechen
                      </Button>
                    </div>
                  </>

                  <div className="rounded-xl border p-3 sm:p-4">
                    <h3 className="text-base font-semibold">
                      Text für Rechnung / PDF
                    </h3>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Nur für den Kunden sichtbar. Beide Felder sind optional.
                    </p>
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs">
                          Titel im Rechnungs-PDF
                        </Label>
                        <Input
                          placeholder="z. B. Zusätzliche Informationen"
                          value={form.pdfTitle}
                          onChange={(event: any) =>
                            setForm({
                              ...form,
                              pdfTitle: event?.target?.value ?? "",
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Text im Rechnungs-PDF</Label>
                        <textarea
                          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          rows={4}
                          placeholder="Optionaler Hinweis oder Zusatztext für das Rechnungs-PDF..."
                          value={form.notes}
                          onChange={(event: any) =>
                            setForm({
                              ...form,
                              notes: event?.target?.value ?? "",
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {!editOrderCtx && renderInvoiceServiceOverview()}

                  {editOrderCtx &&
                    (() => {
                      const canonicalSpecialNotesV17_90L237 =
                        collectInvoiceCanonicalSpecialNotesV17_90L237(
                          editingInvoice,
                          editOrderCtx.specialNotes,
                        );
                      const parsed = splitSpecialNotes(
                        canonicalSpecialNotesV17_90L237,
                      );
                      const rawHazards = uniqueInvoiceLines(
                        parsed.safetyWarnings || [],
                      );
                      const isContactInstruction = (line: string) =>
                        /\b(?:whatsapp|sms|e-?mail|mail|telefon|anruf|anrufen|rueckruf|rückruf|kontakt|melden|keine\s+anrufe?|nicht\s+anrufen)\b/i.test(
                          line,
                        );
                      const communicationHazards =
                        rawHazards.filter(isContactInstruction);
                      const hazards = rawHazards.filter(
                        (line) => !isContactInstruction(line),
                      );
                      const appointmentHintsV17_90L237 = editingInvoice
                        ? collectInvoiceAppointmentEntriesV17_90L177R(
                            editingInvoice,
                          ).map((entry) => entry.label)
                        : [];
                      const hasConcreteAppointmentV17_90L237 =
                        appointmentHintsV17_90L237.some((line) =>
                          /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(line),
                        );
                      const accessHintsV17_90L237 = extractInvoiceAccessLinesV17_90L237(
                        editingInvoice,
                        items.map((item) => String(item?.description || "")),
                      );
                      const serviceEvidenceV17_90L237 =
                        collectInvoiceServiceEvidenceLinesV17_90L237(
                          editingInvoice,
                        );
                      const allHints = uniquePreferredInvoiceInfoLinesV17_90L237([
                        ...accessHintsV17_90L237,
                        ...appointmentHintsV17_90L237,
                        ...(parsed.jobHints || []),
                        ...communicationHazards,
                      ]).filter(
                        (line) =>
                          !invoiceHintMatchesServiceEvidenceV17_90L237(
                            line,
                            serviceEvidenceV17_90L237,
                          ) &&
                          !(
                            hasConcreteAppointmentV17_90L237 &&
                            /termin\s+klären|termin\s+klaeren/i.test(line)
                          ),
                      );
                      const primaryHints = allHints.filter(
                        isPrimaryInvoiceInformationLine,
                      );
                      const primaryKeys = new Set(
                        primaryHints.map((line) =>
                          normalizeInvoiceServiceName(line),
                        ),
                      );
                      const otherHints = allHints.filter(
                        (line) =>
                          !primaryKeys.has(normalizeInvoiceServiceName(line)),
                      );
                      const customerMessageBlocks = (
                        editingInvoice?.orders || []
                      )
                        .map((order, index) => {
                          const sites = Array.isArray(order?.workSites)
                            ? [...order.workSites].sort(
                                (a, b) =>
                                  Number(Boolean(b?.isPrimary)) -
                                    Number(Boolean(a?.isPrimary)) ||
                                  Number(a?.sortOrder || 0) -
                                    Number(b?.sortOrder || 0),
                              )
                            : [];
                          const title =
                            sites[0]?.siteName ||
                            order?.siteName ||
                            order?.siteAddress ||
                            `Quellauftrag ${index + 1}`;
                          const message = String(
                            order?.notes || order?.audioTranscript || "",
                          ).trim();
                          return {
                            title,
                            message,
                            transcript: order?.audioTranscript || "",
                            order,
                          };
                        })
                        .filter(
                          (entry) =>
                            entry.message ||
                            entry.order?.mediaUrl ||
                            (entry.order?.imageUrls || []).length > 0,
                        );

                      return (
                        <div className="space-y-3">
                          {(primaryHints.length > 0 ||
                            hazards.length > 0 ||
                            otherHints.length > 0) && (
                            <div className="rounded-xl border p-3 sm:p-4">
                              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-base font-semibold">
                                  Besonderheiten
                                </h3>
                                <span className="text-xs text-muted-foreground">
                                  Intern – nicht automatisch im Kunden-PDF
                                </span>
                              </div>
                              <div className="space-y-3">
                                {primaryHints.length > 0 && (
                                  <div className="rounded-xl border border-blue-300 bg-blue-50 p-3 text-blue-950">
                                    <div className="font-semibold">
                                      Wichtige Informationen
                                    </div>
                                    <ul className="mt-1.5 space-y-1 text-sm">
                                      {primaryHints.map((line, index) => (
                                        <li key={`invoice-primary-${index}`}>
                                          • {line}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {hazards.length > 0 && (
                                  <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-950">
                                    <div className="font-semibold">
                                      Wichtige Gefahren / Warnhinweise
                                    </div>
                                    <ul className="mt-1.5 space-y-1 text-sm">
                                      {hazards.map((line, index) => (
                                        <li key={`invoice-hazard-${index}`}>
                                          • {line}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {otherHints.length > 0 && (
                                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
                                    <div className="font-semibold">
                                      Weitere Besonderheiten
                                    </div>
                                    <ul className="mt-1.5 space-y-1 text-sm">
                                      {otherHints.map((line, index) => (
                                        <li key={`invoice-hint-${index}`}>
                                          • {line}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {renderInvoiceServiceOverview()}

                          <details
                            className="rounded-xl border p-3 sm:p-4"
                            open
                          >
                            <summary className="cursor-pointer list-none text-base font-semibold [&::-webkit-details-marker]:hidden">
                              Kundennachrichten · {customerMessageBlocks.length}
                            </summary>
                            <div className="mt-3 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                              {customerMessageBlocks.length > 0 ? (
                                customerMessageBlocks.map((entry, index) => (
                                  <div
                                    key={`invoice-customer-message-${index}`}
                                    className="rounded-lg border bg-muted/20 p-3 text-sm"
                                  >
                                    <div className="mb-2 font-semibold text-sky-800">
                                      {index + 1}. {entry.title}
                                    </div>
                                    <CommunicationBlock
                                      data={entry.order as any}
                                      showChips={false}
                                      showSpecialNotes={false}
                                      showCustomerMessage
                                    />
                                  </div>
                                ))
                              ) : (
                                <div className="text-sm text-muted-foreground">
                                  Keine Kundennachricht vorhanden.
                                </div>
                              )}
                            </div>
                          </details>
                        </div>
                      );
                    })()}
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
                      if (!editingInvoice) return;
                      const oldCustomerId = form.customerId; // capture before overwrite
                      const res = await fetch(
                        `/api/invoices/${editingInvoice.id}`,
                        {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ customerId: match.id }),
                        },
                      );
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        toast.error(err?.error || "Fehler beim Kunden-Wechsel");
                        return;
                      }
                      setForm((f: any) => ({ ...f, customerId: match.id }));
                      setNewCust({
                        name: (match.name ?? "") as string,
                        address: (match.address ?? "") as string,
                        plz: (match.plz ?? "") as string,
                        city: (match.city ?? "") as string,
                        phone: (match.phone ?? "") as string,
                        email: (match.email ?? "") as string,
                        country: "CH",
                      });
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
                      setInvoices((prev: Invoice[]) =>
                        prev.map((inv) =>
                          inv.id === editingInvoice.id
                            ? {
                                ...inv,
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
                            : inv,
                        ),
                      );
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
                      setForm((f: any) => ({
                        ...f,
                        customerId: r.survivingCustomerId,
                      }));
                      // Stage F – Critical bug fix:
                      // Replace local `newCust` form state with the freshly
                      // merged customer so the visible "Kunde bearbeiten" form
                      // shows the user-selected values immediately.
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
                        setInvoices((prev) =>
                          prev.map((inv: any) =>
                            inv.customerId === m.id
                              ? { ...inv, customer: { ...inv.customer, ...m } }
                              : inv,
                          ),
                        );
                        setEditingCustomer(true);
                        setShowNewCustomer(true);
                      }
                      await load();
                    }}
                  />
                );
              })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Media / Gallery Dialog */}
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

      {/* Confirm action dialog */}
      <Dialog
        open={!!confirmDialog}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmDialog?.message}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDialog(null)}
            >
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                const action = confirmDialog?.action;
                setConfirmDialog(null);
                await action?.();
              }}
            >
              Bestätigen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
