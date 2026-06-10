"use client";
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
  Undo2,
  MessageCircle,
  MapPin,
  Pencil,
} from "lucide-react";
import { sendPdfToBusinessWhatsApp } from "@/lib/whatsapp-share";
import {
  CommunicationBlock,
  CommunicationChips,
  MergedContactReviewChip,
  buildMergedContactReviewEntries,
  resolveCommunicationData,
  stripForwardedMessage,
} from "@/components/communication-block";
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
    customer?: { name?: string | null; phone?: string | null; email?: string | null } | null;
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
      if (/^\s*\[(?:Titel|Title|Priorität|Prioritaet|Priority)\s*:/i.test(trimmed)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const isPrimaryInvoiceInformationLine = (value?: string | null) => {
  const text = normalizeInvoiceServiceName(value);
  if (!text) return false;
  return (
    /\b(?:termin|datum|uhr|kontakt|telefon|tel|sms|whatsapp|mail|email|anrufen|melden|arbeitsbeginn|ankunft|vor ort)\b/.test(text) ||
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
          (a, b) => Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) || Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
        )
      : [];
    workSites.forEach((site) => add({ ...site, sourceOrderId: site.sourceOrderId || order.id }));
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
    .join('|');

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
    const site = matchedSite ||
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
    const key = site ? `${site.sourceOrderId || ''}|${invoiceSiteKey(site)}` : 'general';
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
    if (!name || quantity <= 0 || unitPrice <= 0 || !unit || /(?:prüfen|pruefen|prufen)/i.test(unit))
      reasons.push("Preis, Menge oder Einheit prüfen");
    if (!matched) reasons.push("nicht im Leistungskatalog");
    if (matched) {
      const catalogPrice = Number(matched?.defaultPrice || 0);
      const catalogUnit = compactInvoiceValue(matched?.unit);
      if (catalogUnit && catalogUnit !== unit)
        reasons.push(`Einheit: ${unit || "–"} statt ${catalogUnit}`);
      if (Math.abs(catalogPrice - unitPrice) >= 0.001)
        reasons.push(`Preis: ${formatCurrency(unitPrice, currency)} statt ${formatCurrency(catalogPrice, currency)}`);
    }
    return reasons.length > 0 ? [`${name}
${reasons.join(" · ")}`] : [];
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
      category: sameUnit && samePrice ? ("catalog" as const) : ("deviation" as const),
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
    const description = compactInvoiceValue(item?.description) || "Unbenannte Leistung";
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
      return [{
        item,
        description,
        category: "blocker" as const,
        details: [...missingReasons, `Aktuell: ${currentCalculation}`],
      }];
    }
    if (!matchedService) {
      return [{
        item,
        description,
        category: "missing" as const,
        details: [`Aktuell: ${currentCalculation}`],
      }];
    }
    const catalogUnit = compactInvoiceValue(matchedService?.unit);
    const catalogPrice = Number(matchedService?.defaultPrice || 0);
    const sameUnit = catalogUnit === unit;
    const samePrice = Math.abs(catalogPrice - unitPrice) < 0.001;
    if (sameUnit && samePrice) return [];
    return [{
      item,
      description,
      category: "deviation" as const,
      details: [
        `Aktuell: ${currentCalculation}`,
        `Katalogpreis: ${formatCurrency(catalogPrice, currency)} / ${catalogUnit || "–"}`,
        ...[
          !sameUnit ? `Einheit weicht ab: ${unit || "–"} statt ${catalogUnit || "–"}` : "",
          !samePrice ? "Preis weicht vom Katalog ab." : "",
        ].filter(Boolean),
      ],
    }];
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
      Array.isArray(order.originOrderIds) ? order.originOrderIds.filter(Boolean).length : 0,
    ),
  );
  const hasMergeReason = (invoice.orders || []).some((order) =>
    (order.reviewReasons || []).some((reason) =>
      ['manual_order_merge', 'double_merge'].includes(String(reason || '')),
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

function formatInvoiceAppointmentLabel(invoice: Invoice): string {
  const formatParsedDate = (date: Date, raw: string) => {
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const appointmentDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    if (appointmentDay.getTime() < today.getTime()) return "";

    const dateLabel = date.toLocaleDateString("de-CH", {
      day: "2-digit",
      month: "2-digit",
    });
    const hasTime = /T\d{2}:\d{2}|\s\d{1,2}:\d{2}/.test(raw);
    const timeLabel = hasTime
      ? date.toLocaleTimeString("de-CH", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    return `Termin ${dateLabel}${timeLabel ? ` ${timeLabel}` : ""}`;
  };

  const parseAppointmentLine = (value?: string | null) => {
    const source = String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\[(?:HINWEIS|NOTE)\]\s*/gi, "");
    const line = source
      .split(/\n+/g)
      .map((entry) => entry.trim())
      .find((entry) =>
        /\b(?:termin|datum|zeitfenster|appointment|ausführung|ausfuehrung)\b/i.test(
          entry,
        ),
      );
    if (!line) return "";

    const dateMatch = line.match(
      /\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\b/,
    );
    const lineWithoutDate = dateMatch ? line.replace(dateMatch[0], " ") : line;
    const timeMatches = Array.from(
      lineWithoutDate.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g),
    );
    const times = timeMatches
      .map((match) => `${match[1].padStart(2, "0")}:${match[2]}`)
      .filter((time, index, all) => all.indexOf(time) === index);
    const timeLabel =
      times.length >= 2 ? `${times[0]}–${times[1]}` : times[0] || "";

    if (dateMatch) {
      const currentYear = new Date().getFullYear();
      const rawYear = dateMatch[3];
      const year = rawYear
        ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear)
        : currentYear;
      const month = Number(dateMatch[2]) - 1;
      const day = Number(dateMatch[1]);
      const firstTime = times[0]?.split(":") || [];
      const parsed = new Date(
        year,
        month,
        day,
        Number(firstTime[0] || 0),
        Number(firstTime[1] || 0),
      );
      const formatted = formatParsedDate(parsed, `${dateMatch[0]} ${times[0] || ""}`);
      if (!formatted) return "";
      const dateLabel = `${String(day).padStart(2, "0")}.${String(month + 1).padStart(2, "0")}.`;
      return `Termin ${dateLabel}${timeLabel ? ` ${timeLabel}` : ""}`;
    }

    if (timeLabel) return `Termin ${timeLabel}`;
    return line.length > 42 ? `${line.slice(0, 39).trim()}…` : line;
  };

  for (const order of invoice.orders || []) {
    const directRaw = compactInvoiceValue(order?.date);
    if (directRaw) {
      const directDate = new Date(directRaw);
      if (!Number.isNaN(directDate.getTime())) {
        const formatted = formatParsedDate(directDate, directRaw);
        if (formatted) return formatted;
      }
      const parsedDirect = parseAppointmentLine(directRaw);
      if (parsedDirect) return parsedDirect;
    }

    const parsedText = parseAppointmentLine(
      [order?.specialNotes, order?.notes, order?.description]
        .filter(Boolean)
        .join("\n"),
    );
    if (parsedText) return parsedText;
  }

  return "";
}

function InvoiceViewportTooltip({
  children,
  preferredWidth = 420,
}: {
  children: any;
  preferredWidth?: number;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);

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
    const desiredHeight = 320;
    const openBelow =
      availableAbove >= desiredHeight
        ? false
        : availableBelow >= desiredHeight
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
  const openTooltipImmediately = () => {
    clearOpenTimer();
    clearHideTimer();
    const next = calculatePosition();
    if (next) setPosition(next);
    setOpen(true);
  };
  const scheduleShowTooltip = () => {
    clearHideTimer();
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      const next = calculatePosition();
      if (next) setPosition(next);
      setOpen(true);
    }, 300);
  };
  const scheduleHide = () => {
    clearOpenTimer();
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setOpen(false), 500);
  };

  useEffect(() => {
    const trigger = anchorRef.current?.parentElement as HTMLElement | null;
    if (!trigger) return;
    const focusOut = (event: FocusEvent) => {
      if (!trigger.contains(event.relatedTarget as Node | null)) scheduleHide();
    };
    trigger.addEventListener("pointerenter", scheduleShowTooltip);
    trigger.addEventListener("pointerleave", scheduleHide);
    trigger.addEventListener("focusin", openTooltipImmediately);
    trigger.addEventListener("focusout", focusOut);
    return () => {
      trigger.removeEventListener("pointerenter", scheduleShowTooltip);
      trigger.removeEventListener("pointerleave", scheduleHide);
      trigger.removeEventListener("focusin", openTooltipImmediately);
      trigger.removeEventListener("focusout", focusOut);
      clearOpenTimer();
      clearHideTimer();
    };
  }, [preferredWidth]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, preferredWidth]);

  return (
    <>
      <span ref={anchorRef} className="hidden" aria-hidden="true" />
      {open && position && (
        <span
          role="tooltip"
          onPointerEnter={clearHideTimer}
          onPointerLeave={scheduleHide}
          style={{
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            top: position.top,
            bottom: position.bottom,
          }}
          className="fixed z-[14000] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-3 text-left text-[11px] font-medium leading-snug text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {children}
        </span>
      )}
    </>
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
        const sectionItems = entries.filter((entry) => entry.category === section.key);
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
                className={`block ${
                  itemIndex > 0 ? "mt-2" : ""
                }`}
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
                      {index + 1}. {
                        group.site?.siteName ||
                        group.site?.siteAddress ||
                        `Ausführungsort ${index + 1}`
                      }
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
}: {
  total: number;
  entries: InvoiceServiceReviewEntry[];
  siteGroups?: InvoiceServiceReviewSiteGroup[];
}) {
  const [activeSiteKey, setActiveSiteKey] = useState<string | null>(null);
  const multipleSites = siteGroups.length > 1;
  return (
    <span className="block text-left font-normal">
      <span className="mb-2 block text-sm font-bold text-slate-950 dark:text-slate-50">
        Leistungen prüfen · {total}
      </span>
      {multipleSites ? (
        <span className="block space-y-2">
          {siteGroups.map((group, index) => {
            const active = activeSiteKey === group.key;
            const address = [
              group.site?.siteAddress,
              [group.site?.sitePlz, group.site?.siteCity].filter(Boolean).join(" "),
            ].filter(Boolean).join(" · ") || "Adresse nicht angegeben";
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
                  setActiveSiteKey((current) => current === group.key ? null : group.key);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setActiveSiteKey((current) => current === group.key ? null : group.key);
                }}
                className={`block cursor-pointer overflow-hidden rounded-lg border bg-white outline-none dark:bg-slate-900 ${
                  active
                    ? "border-cyan-300 dark:border-cyan-800"
                    : "border-slate-200 hover:border-cyan-200 dark:border-slate-700"
                }`}
              >
                <span className={`flex items-start justify-between gap-3 p-2 ${
                  active
                    ? "bg-cyan-50 dark:bg-cyan-950/30"
                    : "bg-slate-50 hover:bg-cyan-50/60 dark:bg-slate-900"
                }`}>
                  <span className="min-w-0">
                    <span className="block font-bold text-slate-950 dark:text-slate-50">
                      {index + 1}. {group.site?.siteName || group.site?.siteAddress || `Ausführungsort ${index + 1}`}
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
                    <InvoiceServiceReviewSectionsV17_90L135G entries={group.entries} />
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
  const [form, setForm] = useState({
    customerId: "",
    invoiceDate: new Date().toISOString().split("T")[0],
    paymentDays: "30",
    pdfTitle: "",
    notes: "",
    orderIds: [] as string[],
  });
  const getEmptyItem = (): InvoiceItem => ({
    description: "",
    quantity: "",
    unit: "Stunde",
    unitPrice: "",
  });

  const [items, setItems] = useState<InvoiceItem[]>([getEmptyItem()]);
  const [expandedItemIndex, setExpandedItemIndex] = useState<number | null>(null);
  const [serviceActionMenuIndex, setServiceActionMenuIndex] = useState<number | null>(null);
  const [editingExecutionAddress, setEditingExecutionAddress] = useState(false);
  const [expandedInvoiceSiteKeys, setExpandedInvoiceSiteKeys] = useState<Set<string>>(new Set());
  const [newInvoiceItemSiteKey, setNewInvoiceItemSiteKey] = useState<string>("");
  const [expandedInvoiceCardIds, setExpandedInvoiceCardIds] = useState<Set<string>>(new Set());
  const [invoiceCardExpansionRestored, setInvoiceCardExpansionRestored] = useState(false);
  const [invoiceCardInitialStateApplied, setInvoiceCardInitialStateApplied] = useState(false);
  const [expandedInvoiceServiceCardIds, setExpandedInvoiceServiceCardIds] = useState<Set<string>>(new Set());


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
  const [editingInvoiceSiteKey, setEditingInvoiceSiteKey] = useState<string | null>(null);
  const [newInvoiceExecutionSite, setNewInvoiceExecutionSite] =
    useState<InvoiceExecutionSite | null>(null);
  const [saving, setSaving] = useState(false);

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
              inv.customerId === updated.id
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

  const load = async () => {
    setLoading(true);
    setLoadError(null);
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
    // If most critical endpoints failed, show error state
    if (errors.length >= 2) {
      setLoadError(errors);
      setLoading(false);
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
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

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
    setEditingInvoice(null);
    setVatRate(defaultVatRate);
    setCurrency(currency === "EUR" ? "EUR" : "CHF");
    setForm({
      customerId: "",
      invoiceDate: new Date().toISOString().split("T")[0],
      paymentDays: "30",
      pdfTitle: "",
      notes: "",
      orderIds: [],
    });
    setItems([getEmptyItem()]);
    setExpandedItemIndex(0);
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
    opts?: { openCustomerSection?: boolean; focusStatus?: boolean },
  ) => {
    setEditingInvoice(inv);
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
    setForm({
      customerId: inv.customerId,
      invoiceDate: inv.invoiceDate
        ? new Date(inv.invoiceDate).toISOString().split("T")[0]
        : "",
      paymentDays: "30",
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
    // Auto-fill: extract missing customer data from notes and update DB
    if (inv.customerId) autoFillCustomer(inv.customerId);
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

  const setNewInvoiceExecutionAddressEnabled = (enabled: boolean) => {
    if (!enabled) {
      setNewInvoiceExecutionSite(null);
      setEditingExecutionAddress(false);
      return;
    }
    setNewInvoiceExecutionSite((current) => current || getEmptyInvoiceExecutionSite());
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
      setExpandedInvoiceSiteKeys((current) =>
        new Set([...current, requestedKey]),
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
      current === i ? null : current != null && current > i ? current - 1 : current,
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
      // Rechnungen starten bewusst ohne automatisch übernommenen Katalogpreis.
      // Der Preis muss für diese konkrete Rechnung bestätigt/eingetragen werden.
      updateItem(idx, "unitPrice", "0");
      updateItem(idx, "unit", svc.unit ?? "Stunde");
    } else if (!name) {
      updateItem(idx, "description", "");
      updateItem(idx, "unitPrice", "");
      updateItem(idx, "quantity", "");
      updateItem(idx, "unit", "Stunde");
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
      setExpandedInvoiceSiteKeys((current) =>
        new Set([...current, unfinishedKey]),
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
      serviceItemsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
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
    setSaving(true);
    try {
      const itemsForCreate = newInvoiceExecutionSite
        ? items.map((item) => ({
            ...item,
            siteName: compactInvoiceValue(newInvoiceExecutionSite.siteName) || null,
            siteAddress:
              compactInvoiceValue(newInvoiceExecutionSite.siteAddress) || null,
            sitePlz: compactInvoiceValue(newInvoiceExecutionSite.sitePlz) || null,
            siteCity: compactInvoiceValue(newInvoiceExecutionSite.siteCity) || null,
            siteNote: compactInvoiceValue(newInvoiceExecutionSite.siteNote) || null,
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
          setEditingExecutionAddress(false);
          setForm({
            customerId: "",
            invoiceDate: new Date().toISOString().split("T")[0],
            paymentDays: "30",
            pdfTitle: "",
            notes: "",
            orderIds: [],
          });
        } else if (createdInvoice?.id) {
          setEditingInvoice(createdInvoice);
          setItems(Array.isArray(createdInvoice.items) ? createdInvoice.items : itemsForCreate);
          setNewInvoiceExecutionSite(null);
          setEditingExecutionAddress(false);
        }
        return true;
      } else {
        const errorData = await res.json().catch(() => null);
        toast.error(errorData?.error || "Rechnung konnte nicht erstellt werden");
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
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${editingInvoice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editingInvoice.status,
          notes: joinInvoicePdfText(form.pdfTitle, form.notes),
          invoiceDate: form.invoiceDate,
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
    if (saved) setEditingExecutionAddress(false);
  };

  // Save + Archive → set status Erledigt + back to list
  const saveAndArchive = async () => {
    if (!editingInvoice) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${editingInvoice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "Erledigt",
          notes: joinInvoicePdfText(form.pdfTitle, form.notes),
          invoiceDate: form.invoiceDate,
          items,
          vatRate,
          currency,
        }),
      });
      if (res.ok) {
        toast.success("Rechnung erledigt und archiviert");
        setDialogOpen(false);
        setEditingInvoice(null);
        load();
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

  const updateStatus = async (
    e: React.MouseEvent | React.ChangeEvent,
    id: string,
    status: string,
  ) => {
    if ("stopPropagation" in e) e.stopPropagation();
    const previousStatus = invoices.find((invoice) => invoice.id === id)?.status;
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === id ? { ...invoice, status } : invoice,
      ),
    );
    try {
      const response = await fetch(`/api/invoices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("status_update_failed");
      toast.success("Status aktualisiert");
    } catch {
      setInvoices((current) =>
        current.map((invoice) =>
          invoice.id === id
            ? { ...invoice, status: previousStatus || invoice.status }
            : invoice,
        ),
      );
      toast.error("Status konnte nicht gespeichert werden");
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
  const visibleInvoiceIds = sorted.slice(0, visibleCount).map((invoice) => invoice.id);
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
      <div className="pointer-events-none fixed left-16 top-0 z-40 flex h-14 items-center">
        <span className="font-display text-sm font-bold sm:text-base">Rechnungen</span>
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
              {allVisibleInvoiceCardsExpanded ? "Alle schließen" : "Alle öffnen"}
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
                  const invoiceExecutionSites = collectInvoiceExecutionSites(inv);
                  const executionSite = invoiceExecutionSites[0] || null;
                  const visibleItems = (inv.items || []).filter((item: any) =>
                    Boolean(String(item?.description || "").trim()),
                  );
                  const invoiceCardExpanded = expandedInvoiceCardIds.has(inv.id);
                  const invoiceServicesExpanded =
                    expandedInvoiceServiceCardIds.has(inv.id);
                  const displayedInvoiceItems = invoiceServicesExpanded
                    ? visibleItems
                    : visibleItems.slice(0, 6);
                  const dueLabel = formatInvoiceDateLabel(inv.dueDate);
                  const invoiceAppointmentLabel = formatInvoiceAppointmentLabel(inv);
                  const invoiceAppointmentDisplayLabel =
                    invoiceAppointmentLabel || "Termin klären";
                  const invoiceContactData = buildInvoiceCommunicationData(inv);
                  const mergedCount = getInvoiceMergedCount(inv);
                  const mergedContactEntries = buildMergedContactReviewEntries(
                    (inv.orders || []) as any,
                  );
                  const hasMergedContactReview =
                    mergedCount > 1 && mergedContactEntries.length > 1;

                  const renderInvoiceCompactFunctionalChips = () => (
                    <div
                      className="mr-1 inline-flex min-w-0 flex-wrap items-center gap-1.5 border-r border-slate-200 pr-2 empty:hidden dark:border-slate-700 [&_svg]:h-[18px] [&_svg]:w-[18px]"
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

                  const renderInvoiceServicesChip = () =>
                    visibleItems.length > 0 ? (
                      <span className="inline-flex lg:ml-auto">
                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onTouchStart={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openEditInvoice(inv);
                            setExpandedItemIndex(0);
                          }}
                          className="group relative inline-flex h-7 items-center rounded-full border border-amber-300 bg-amber-100 px-2.5 text-[10px] font-semibold text-amber-900 shadow-sm hover:bg-amber-200"
                          aria-label={`Leistungen anzeigen · ${visibleItems.length}`}
                        >
                          Leistungen · {visibleItems.length}
                          <InvoiceViewportTooltip preferredWidth={432}>
                            <InvoiceServiceDisplayTooltipContentV17_90L136
                              total={visibleItems.length}
                              entries={invoiceServiceDisplayEntries}
                              siteGroups={invoiceServiceDisplaySiteGroups}
                            />
                          </InvoiceViewportTooltip>
                        </button>
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
                        className="transition-shadow hover:shadow-md tap-safe"
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
                              <div className="hidden group-open:block absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-900 border rounded-lg shadow-lg py-1 min-w-[190px]">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu =
                                      e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement)
                                      menu.open = false;
                                    openEditInvoice(inv);
                                  }}
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                >
                                  <FileText className="w-3.5 h-3.5 text-primary" />{" "}
                                  Bearbeiten
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu =
                                      e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement)
                                      menu.open = false;
                                    downloadPdf(
                                      { stopPropagation: () => {} } as any,
                                      inv.id,
                                    );
                                  }}
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                >
                                  <Download className="w-3.5 h-3.5 text-green-600" />{" "}
                                  PDF herunterladen
                                </button>
                                {whatsappEnabled && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const menu =
                                        e.currentTarget.closest("details");
                                      if (menu instanceof HTMLDetailsElement)
                                        menu.open = false;
                                      sendPdfToWhatsApp(inv);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />{" "}
                                    PDF an WhatsApp senden
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const menu =
                                      e.currentTarget.closest("details");
                                    if (menu instanceof HTMLDetailsElement)
                                      menu.open = false;
                                    updateStatus(e, inv.id, "Erledigt");
                                  }}
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                >
                                  <Archive className="w-3.5 h-3.5 text-amber-600" />{" "}
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
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                >
                                  <Undo2 className="w-3.5 h-3.5 text-amber-600" />{" "}
                                  {inv.sourceOfferId
                                    ? "Zurück zu Angebot"
                                    : "Zurück zu Auftrag"}
                                </button>
                                <div className="border-t my-1" />
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
                                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Papierkorb
                                </button>
                              </div>
                            </details>

                            {!invoiceCardExpanded && (
                              <div
                                className={`min-w-0 flex-1 cursor-pointer ${isPaid ? "opacity-80" : ""}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleInvoiceCard(inv.id);
                                }}
                              >
                                <div className="grid min-w-0 grid-cols-1 items-start gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible">
                                      <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground sm:text-[11px]">
                                        {(() => {
                                          const dt =
                                            inv.orders?.[0]?.createdAt ||
                                            inv.createdAt ||
                                            inv.invoiceDate;
                                          return dt
                                            ? `${new Date(dt).toLocaleDateString("de-CH", {
                                                day: "2-digit",
                                                month: "2-digit",
                                              })} ${new Date(dt).toLocaleTimeString("de-CH", {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                              })}`
                                            : "";
                                        })()}
                                      </span>
                                      <span className="min-w-0 truncate text-sm font-semibold">
                                        {isFallbackCustomerName(inv?.customer?.name)
                                          ? "Kunde nicht zugeordnet"
                                          : inv?.customer?.name || "–"}
                                      </span>
                                      {invoiceExecutionSites.length > 0 && (
                                        <button
                                          type="button"
                                          onPointerDown={(event) => event.stopPropagation()}
                                          onTouchStart={(event) => event.stopPropagation()}
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            openEditInvoice(inv);
                                            window.setTimeout(
                                              () => setEditingExecutionAddress(true),
                                              120,
                                            );
                                          }}
                                          className="group relative inline-flex min-w-0 basis-full max-w-full shrink items-center gap-1 rounded-full border border-cyan-300 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800 hover:bg-cyan-100 sm:basis-auto sm:max-w-[18rem]"
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
                                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible border-t border-slate-200 pt-2 dark:border-slate-700">
                                      <select
                                        value={effectiveStatus}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onPointerUp={(event) => event.stopPropagation()}
                                        onTouchStart={(event) => event.stopPropagation()}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={(event) =>
                                          updateStatus(event, inv.id, event.target.value)
                                        }
                                        className="h-7 rounded-full border px-2 text-[10px] font-semibold outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                                        style={getStatusStyle(
                                          INVOICE_STATUS_STYLES,
                                          effectiveStatus,
                                        )}
                                        aria-label={`Status bearbeiten: ${effectiveStatus}`}
                                      >
                                        {invoiceStatuses.map((status) => (
                                          <option key={status} value={status}>
                                            {status}
                                          </option>
                                        ))}
                                      </select>
                                      {renderInvoiceCompactFunctionalChips()}
                                      {renderInvoiceServicesChip()}
                                    </div>
                                  </div>
                                  <div className="flex min-w-0 items-center justify-end gap-2 pr-3 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:shrink-0 sm:pr-5">
                                    <button
                                      type="button"
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onTouchStart={(event) => event.stopPropagation()}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                      }}
                                      className="relative inline-flex min-h-9 min-w-0 max-w-[10rem] shrink items-center sm:max-w-[14rem] rounded-full border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-100"
                                      aria-label={invoiceAppointmentDisplayLabel}
                                    >
                                      <span className="truncate">
                                        {invoiceAppointmentDisplayLabel}
                                      </span>
                                      <InvoiceViewportTooltip preferredWidth={300}>
                                        <span className="block text-xs font-semibold text-violet-900 dark:text-violet-200">
                                          Ausführungstermin
                                        </span>
                                        <span className="mt-1 block text-sm font-medium text-slate-900 dark:text-slate-100">
                                          {invoiceAppointmentDisplayLabel}
                                        </span>
                                      </InvoiceViewportTooltip>
                                    </button>
                                    <div className="shrink-0 whitespace-nowrap text-right font-mono text-sm font-bold tabular-nums">
                                      {formatCurrency(
                                        Number(inv?.total ?? 0),
                                        inv.currency === "EUR" ? "EUR" : "CHF",
                                      )}
                                    </div>
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  </div>
                                </div>
                              </div>
                            )}
                            <div
                              className={`flex-1 min-w-0 ${isPaid ? "opacity-80" : ""} ${invoiceCardExpanded ? "" : "hidden"}`}
                            >
                              <div
                                className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1"
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
                                <span className="font-semibold text-sm sm:text-base text-foreground truncate">
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
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onTouchStart={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      openEditInvoice(inv);
                                      window.setTimeout(
                                        () => setEditingExecutionAddress(true),
                                        120,
                                      );
                                    }}
                                    className="group relative inline-flex max-w-full items-center gap-1 rounded-full border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-xs text-cyan-800 hover:bg-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
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
                                <span className="ml-auto font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                                  {inv?.invoiceNumber ?? ""}
                                </span>
                              </div>

                              <div
                                className="mt-3 cursor-pointer rounded-xl border bg-muted/20 p-3 transition-colors hover:bg-muted/35"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEditInvoice(inv);
                                  setExpandedItemIndex(0);
                                }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    openEditInvoice(inv);
                                    setExpandedItemIndex(0);
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
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onTouchStart={(event) => event.stopPropagation()}
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

                              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible">
                                <select
                                  onClick={(event) => event.stopPropagation()}
                                  className="h-8 shrink-0 rounded-lg border px-2 text-[11px] font-medium"
                                  style={getStatusStyle(
                                    INVOICE_STATUS_STYLES,
                                    effectiveStatus,
                                  )}
                                  value={effectiveStatus}
                                  onChange={(event) =>
                                    updateStatus(event, inv.id, event.target.value)
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
                                {renderInvoiceServicesChip()}
                              </div>

                              <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                                <div className="ml-auto flex min-w-0 items-end gap-3">
                                  <button
                                    type="button"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onTouchStart={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                    className="relative inline-flex min-h-9 min-w-0 max-w-[14rem] shrink items-center rounded-full border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-100"
                                    aria-label={invoiceAppointmentDisplayLabel}
                                  >
                                    <span className="truncate">
                                      {invoiceAppointmentDisplayLabel}
                                    </span>
                                    <InvoiceViewportTooltip preferredWidth={300}>
                                      <span className="block text-xs font-semibold text-violet-900 dark:text-violet-200">
                                        Ausführungstermin
                                      </span>
                                      <span className="mt-1 block text-sm font-medium text-slate-900 dark:text-slate-100">
                                        {invoiceAppointmentDisplayLabel}
                                      </span>
                                    </InvoiceViewportTooltip>
                                  </button>
                                  <div className="shrink-0 text-right">
                                    {dueLabel && (
                                      <div className="text-xs text-muted-foreground">
                                        Fällig {dueLabel}
                                      </div>
                                    )}
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
          className={`${dupCheckOpen ? "max-w-5xl w-[96vw]" : "max-w-4xl w-[95vw]"} max-h-[90vh] overflow-y-auto overflow-x-hidden transition-all`}
        >
          <DialogHeader>
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
                const cust = form.customerId
                  ? customers.find((c: Customer) => c.id === form.customerId)
                  : null;
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
                  <Label>Kunde *</Label>
                  {!showNewCustomer && form.customerId && (
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
                        const cust = customers.find(
                          (c: Customer) => c.id === form.customerId,
                        );
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
                            const cust = customers.find(
                              (c: Customer) => c.id === form.customerId,
                            );
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
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-slate-400"
                        checked={Boolean(newInvoiceExecutionSite)}
                        onChange={(event) =>
                          setNewInvoiceExecutionAddressEnabled(
                            event.target.checked,
                          )
                        }
                      />
                      <span>
                        <span className="block text-sm font-semibold">
                          Ausführungsadresse abweichend von Rechnungsadresse
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Nur aktivieren, wenn die Arbeit an einem anderen Ort
                          ausgeführt wird.
                        </span>
                      </span>
                    </label>
                    {newInvoiceExecutionSite && !editingExecutionAddress && (
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-xs"
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
                          className="h-7 shrink-0 px-2 text-xs"
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

              {!dupCheckOpen && editingInvoice &&
                collectInvoiceExecutionSites({ items, orders: editingInvoice?.orders || [] }).length <= 1 &&
                (() => {
                  const executionSite = collectInvoiceExecutionSites({
                    items,
                    orders: editingInvoice?.orders || [],
                  })[0];
                  if (!executionSite) return null;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!editingExecutionAddress)
                          setEditingExecutionAddress(true);
                      }}
                      onKeyDown={(event) => {
                        if (
                          !editingExecutionAddress &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          setEditingExecutionAddress(true);
                        }
                      }}
                      className={`rounded-xl border border-cyan-200 bg-cyan-50/40 p-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400 sm:p-3 dark:border-cyan-900/60 dark:bg-cyan-950/20 ${
                        editingExecutionAddress
                          ? ""
                          : "cursor-pointer hover:bg-cyan-50/50"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
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
                            <div className="font-semibold">
                              Ausführungsadresse abweichend von Rechnungsadresse
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Nur aktivieren, wenn die Arbeit an einem anderen Ort ausgeführt wird.
                            </p>
                          </div>
                        </div>
                        {!editingExecutionAddress && (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                addInvoiceExecutionSite();
                              }}
                              disabled={saving}
                              className="inline-flex h-7 shrink-0 items-center rounded-md border border-slate-200 bg-white px-2 text-xs font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50"
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
                              className="inline-flex h-7 shrink-0 items-center rounded-md border border-slate-200 bg-white px-2 text-xs font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50"
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
                              <Label className="text-xs">Objekt / Bereich</Label>
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
                                <span className="text-muted-foreground">Strasse:</span>
                                <span className="break-words">
                                  {executionSite.siteAddress || "–"}
                                </span>
                                <span className="text-muted-foreground">PLZ / Ort:</span>
                                <span className="break-words">
                                  {[executionSite.sitePlz, executionSite.siteCity]
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
                  <div ref={serviceItemsRef} className="scroll-mt-24 space-y-3 rounded-xl border bg-background p-3 sm:p-4">
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
                                  <Button variant="outline" size="sm" onClick={toggleAllInvoiceSites}>
                                    {expandedInvoiceSiteKeys.size ===
                                    groupInvoiceItemsByExecutionSite(items || [], currentSites).length
                                      ? "Übersicht"
                                      : "Alle öffnen"}
                                  </Button>
                                )}
                                <Button variant="outline" size="sm" onClick={addItem}>
                                  <Plus className="mr-1 h-4 w-4" /> Leistung hinzufügen
                                </Button>
                              </div>
                            </div>
                            {multiSite ? (
                              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                <span className="min-w-0 truncate">
                                  {currentSites.length} Arbeitsorte · {items?.length || 0} Leistungen
                                </span>
                                <span className="shrink-0 font-mono font-medium text-foreground">
                                  {formatCurrency(subtotal, currency)}
                                </span>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Kompakte Übersicht. Zum Bearbeiten die Leistung aufklappen.
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
                                Number(matchedService.defaultPrice || 0) - unitPrice,
                              ) >= 0.001),
                        );
                        const itemNeedsReview =
                          hasMissingValues || !matchedService || catalogMismatch;
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
                              isExpanded
                                ? "border-sky-200 bg-sky-50/40 ring-1 ring-sky-100"
                                : itemNeedsReview
                                  ? "border-amber-200 bg-amber-50/20"
                                  : "border-slate-200 bg-background"
                            }`}
                          >
                            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2.5">
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
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate font-medium">
                                    {item?.description || "Neue Leistung"}
                                  </span>
                                  {itemNeedsReview && (
                                    <span className="shrink-0 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                      {itemReviewReasonV17_90L134}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                  {quantity > 0 ? quantity : "prüfen"} {item?.unit || "Einheit prüfen"} × {" "}
                                  {unitPrice > 0
                                    ? formatCurrency(unitPrice, currency)
                                    : "Preis prüfen"}
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
                                    onClick={(event) => event.stopPropagation()}
                                    className="absolute bottom-full right-0 z-50 mb-1 w-60 rounded-md border bg-background py-1 text-sm shadow-xl"
                                  >
                                    {compactInvoiceValue(item?.description) && (
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
                              <div className="space-y-3 border-t border-sky-100 p-3">
                                {collectInvoiceExecutionSites({
                                  items,
                                  orders: editingInvoice?.orders || [],
                                }).length > 1 && (
                                  <div className="rounded-lg border border-cyan-200 bg-cyan-50/60 p-2">
                                    <Label className="text-xs">Arbeitsort</Label>
                                    <select
                                      className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                      value={(() => {
                                        const sites = collectInvoiceExecutionSites({
                                          items,
                                          orders: editingInvoice?.orders || [],
                                        });
                                        const matched = sites.find(
                                          (site) => invoiceSiteKey(site) === invoiceSiteKey(item),
                                        );
                                        return matched ? invoiceGroupKeyForSite(matched) : "";
                                      })()}
                                      onChange={(event) =>
                                        assignInvoiceItemToSite(idx, event.target.value)
                                      }
                                    >
                                      <option value="">Arbeitsort wählen…</option>
                                      {collectInvoiceExecutionSites({
                                        items,
                                        orders: editingInvoice?.orders || [],
                                      }).map((site, siteIndex) => {
                                        const key = invoiceGroupKeyForSite(site);
                                        return (
                                          <option key={`${key}-${siteIndex}`} value={key}>
                                            {siteIndex + 1}. {site.siteName || site.siteAddress || "Neuer Arbeitsort"}
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
                                    <Label className="text-xs">Einheit</Label>
                                    <select
                                      className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                      value={item?.unit ?? "Stunde"}
                                      onChange={(event: any) =>
                                        updateItem(
                                          idx,
                                          "unit",
                                          event?.target?.value ?? "Stunde",
                                        )
                                      }
                                    >
                                      <option value="Stunde">Stunde</option>
                                      <option value="Tag">Tag</option>
                                      <option value="Pauschal">Pauschal</option>
                                      <option value="Meter">Meter</option>
                                      <option value="Quadratmeter">Quadratmeter</option>
                                      <option value="Kubikmeter">Kubikmeter</option>
                                      <option value="Stück">Stück</option>
                                      <option value="Kilogramm">Kilogramm</option>
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
                                      value={quantity <= 0 ? "" : item?.quantity ?? ""}
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
                                    <Label className="text-xs">Preis ({currency})</Label>
                                    <Input
                                      type="number"
                                      step="0.05"
                                      placeholder="prüfen"
                                      className={`h-9 ${unitPrice <= 0 ? "border-red-500 bg-red-50" : ""}`}
                                      value={unitPrice <= 0 ? "" : item?.unitPrice ?? ""}
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
                                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                    <div className="font-semibold">Manuell prüfen</div>
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
                            className="overflow-visible rounded-xl border-2 border-cyan-300 bg-cyan-50/60"
                          >
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-t-xl border-b border-cyan-200 bg-cyan-50/80 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">
                                  📍 {groupIndex + 1}. {group.site?.siteName || group.site?.siteAddress || `Ausführungsort ${groupIndex + 1}`}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                  {[group.site?.siteAddress, [group.site?.sitePlz, group.site?.siteCity].filter(Boolean).join(" ")]
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
                                  if (groupReviewEntries.length === 0) return null;
                                  return (
                                    <span
                                      className="relative mt-1 inline-flex rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
                                      role="button"
                                      tabIndex={0}
                                      onClick={(event) => event.stopPropagation()}
                                      onPointerDown={(event) => event.stopPropagation()}
                                    >
                                      Leistungen prüfen · {groupReviewEntries.length}
                                      <InvoiceViewportTooltip preferredWidth={432}>
                                        <InvoiceServiceReviewTooltipContentV17_90L135G
                                          total={groupReviewEntries.length}
                                          entries={groupReviewEntries}
                                        />
                                      </InvoiceViewportTooltip>
                                    </span>
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
                                    setExpandedInvoiceSiteKeys((current) =>
                                      new Set([...current, group.key]),
                                    );
                                  }}
                                >
                                  Arbeitsort bearbeiten
                                </button>
                              </div>
                            </summary>
                            {editingInvoiceSiteKey === group.key && group.site && (
                              <div className="grid grid-cols-1 gap-2 border-b border-slate-200 bg-cyan-50/50 p-3 sm:grid-cols-2">
                                <div className="sm:col-span-2">
                                  <Label className="text-xs">Objekt / Bereich</Label>
                                  <Input value={group.site.siteName || ""} onChange={(event) => updateInvoiceGroupSite(group.key, "siteName", event.target.value)} />
                                </div>
                                <div className="sm:col-span-2">
                                  <Label className="text-xs">Strasse</Label>
                                  <Input value={group.site.siteAddress || ""} onChange={(event) => updateInvoiceGroupSite(group.key, "siteAddress", event.target.value)} />
                                </div>
                                <div>
                                  <Label className="text-xs">PLZ</Label>
                                  <Input value={group.site.sitePlz || ""} onChange={(event) => updateInvoiceGroupSite(group.key, "sitePlz", event.target.value)} />
                                </div>
                                <div>
                                  <Label className="text-xs">Ort</Label>
                                  <Input value={group.site.siteCity || ""} onChange={(event) => updateInvoiceGroupSite(group.key, "siteCity", event.target.value)} />
                                </div>
                                <div className="sm:col-span-2 flex justify-end">
                                  {!group.site.sourceOrderId && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                      onClick={() => removeInvoiceExecutionSite(group.key)}
                                    >
                                      Arbeitsort löschen
                                    </Button>
                                  )}
                                  <Button type="button" size="sm" variant="outline" onClick={() => setEditingInvoiceSiteKey(null)}>Fertig</Button>
                                </div>
                              </div>
                            )}
                            <div className="space-y-2 p-2">
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
                          onChange={(e: any) =>
                            setForm({
                              ...form,
                              invoiceDate: e?.target?.value ?? "",
                            })
                          }
                        />
                      </div>
                      {!editingInvoice ? (
                        <div>
                          <Label>Zahlungsziel (Tage)</Label>
                          <Input
                            type="number"
                            value={form.paymentDays}
                            onChange={(e: any) =>
                              setForm({
                                ...form,
                                paymentDays: e?.target?.value ?? "30",
                              })
                            }
                          />
                        </div>
                      ) : (
                        <div>
                          <Label>Fälligkeitsdatum</Label>
                          <div className="flex h-10 items-center rounded-md border bg-background px-3 text-sm">
                            {formatInvoiceDateLabel(editingInvoice.dueDate) ||
                              "—"}
                          </div>
                        </div>
                      )}
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

                  {!showNewCustomer && (
                    <div className="rounded-xl border bg-background p-2 sm:p-3">
                      <div
                        className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${
                          editingInvoice ? "lg:grid-cols-3" : ""
                        }`}
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
                              {saving ? "Speichern..." : "Speichern & schließen"}
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
                              {saving ? "Speichern..." : "Speichern & schließen"}
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
                  )}

                  <div className="rounded-xl border p-3 sm:p-4">
                    <h3 className="text-base font-semibold">
                      Text für Rechnung / PDF
                    </h3>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Nur für den Kunden sichtbar. Beide Felder sind optional.
                    </p>
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs">Titel im Rechnungs-PDF</Label>
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

                  {editOrderCtx && (() => {
                    const parsed = splitSpecialNotes(editOrderCtx.specialNotes);
                    const rawHazards = uniqueInvoiceLines(parsed.safetyWarnings || []);
                    const isContactInstruction = (line: string) =>
                      /\b(?:whatsapp|sms|e-?mail|mail|telefon|anruf|anrufen|rueckruf|rückruf|kontakt|melden|keine\s+anrufe?|nicht\s+anrufen)\b/i.test(line);
                    const communicationHazards = rawHazards.filter(isContactInstruction);
                    const hazards = rawHazards.filter((line) => !isContactInstruction(line));
                    const allHints = uniqueInvoiceLines([
                      ...(parsed.jobHints || []),
                      ...communicationHazards,
                    ]);
                    const primaryHints = allHints.filter(isPrimaryInvoiceInformationLine);
                    const primaryKeys = new Set(
                      primaryHints.map((line) => normalizeInvoiceServiceName(line)),
                    );
                    const otherHints = allHints.filter(
                      (line) => !primaryKeys.has(normalizeInvoiceServiceName(line)),
                    );
                    const customerMessageBlocks = (editingInvoice?.orders || [])
                      .map((order, index) => {
                        const sites = Array.isArray(order?.workSites)
                          ? [...order.workSites].sort(
                              (a, b) =>
                                Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
                                Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0),
                            )
                          : [];
                        const title =
                          sites[0]?.siteName ||
                          order?.siteName ||
                          order?.siteAddress ||
                          `Quellauftrag ${index + 1}`;
                        const message = String(order?.notes || order?.audioTranscript || "").trim();
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
                        {(primaryHints.length > 0 || hazards.length > 0 || otherHints.length > 0) && (
                          <div className="rounded-xl border p-3 sm:p-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <h3 className="text-base font-semibold">Besonderheiten</h3>
                              <span className="text-xs text-muted-foreground">
                                Intern – nicht automatisch im Kunden-PDF
                              </span>
                            </div>
                            <div className="space-y-3">
                              {primaryHints.length > 0 && (
                                <div className="rounded-xl border border-blue-300 bg-blue-50 p-3 text-blue-950">
                                  <div className="font-semibold">Wichtige Informationen</div>
                                  <ul className="mt-1.5 space-y-1 text-sm">
                                    {primaryHints.map((line, index) => (
                                      <li key={`invoice-primary-${index}`}>• {line}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {hazards.length > 0 && (
                                <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-950">
                                  <div className="font-semibold">Wichtige Gefahren / Warnhinweise</div>
                                  <ul className="mt-1.5 space-y-1 text-sm">
                                    {hazards.map((line, index) => (
                                      <li key={`invoice-hazard-${index}`}>• {line}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {otherHints.length > 0 && (
                                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
                                  <div className="font-semibold">Weitere Besonderheiten</div>
                                  <ul className="mt-1.5 space-y-1 text-sm">
                                    {otherHints.map((line, index) => (
                                      <li key={`invoice-hint-${index}`}>• {line}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <details className="rounded-xl border p-3 sm:p-4" open>
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

