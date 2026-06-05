"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  FileCheck,
  Plus,
  Download,
  Trash2,
  Loader2,
  Undo2,
  AlertTriangle,
  Volume2,
  ImageIcon,
  FileText,
  MoreVertical,
  Search,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  MapPin,
  Info,
  Pencil,
} from "lucide-react";
import { sendPdfToBusinessWhatsApp } from "@/lib/whatsapp-share";
import { TouchImageViewer } from "@/components/touch-image-viewer";
import {
  CommunicationChips,
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
import { MwStControl } from "@/components/mwst-control";
import { formatCurrency } from "@/lib/currency";
import { splitSpecialNotes } from "@/lib/special-notes-utils";
import { fetchAllJSON } from "@/lib/fetch-utils";
import { LoadErrorFallback } from "@/components/load-error-fallback";
import { OFFER_STATUS_STYLES, getStatusStyle } from "@/lib/status-colors";
import { useDialogBackGuard } from "@/lib/use-dialog-back-guard";
import {
  isCustomerDataIncomplete,
  isRequiredCustomerFieldMissing,
} from "@/lib/customer-links";
import { PlzOrtInput } from "@/components/plz-ort-input";
import { CustomerSearchCombobox } from "@/components/customer-search-combobox";
import { MissingCustomerDataBadge } from "@/components/missing-customer-data-badge";
import { MobileListShortcut } from "@/components/mobile-list-shortcut";

interface OfferItem {
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
interface OfferExecutionSite {
  siteName?: string | null;
  siteAddress?: string | null;
  sitePlz?: string | null;
  siteCity?: string | null;
  siteNote?: string | null;
  sourceOrderId?: string | null;
}

interface Offer {
  id: string;
  offerNumber: string;
  customerId: string;
  customer?: any;
  items: any[];
  orders?: {
    id: string;
    createdAt?: string | null;
    date?: string | null;
    description?: string | null;
    notes?: string | null;
    specialNotes?: string | null;
    needsReview?: boolean;
    hinweisLevel?: string;
    mediaUrl?: string | null;
    mediaType?: string | null;
    imageUrls?: string[];
    thumbnailUrls?: string[];
    audioTranscript?: string | null;
    audioDurationSec?: number | null;
    audioTranscriptionStatus?: string | null;
    siteAddressDifferent?: boolean;
    siteName?: string | null;
    siteAddress?: string | null;
    sitePlz?: string | null;
    siteCity?: string | null;
    siteNote?: string | null;
    workSites?: Array<
      OfferExecutionSite & {
        id?: string;
        isPrimary?: boolean;
        sortOrder?: number;
      }
    >;
  }[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  currency?: "CHF" | "EUR" | string | null;
  status: string;
  offerDate: string;
  createdAt?: string;
  validUntil: string | null;
  notes: string | null;
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

const statusColors: Record<string, string> = {
  Entwurf: "bg-gray-200 text-gray-800 border border-gray-300",
  Gesendet: "bg-blue-200 text-blue-900 border border-blue-300",
  Angenommen: "bg-green-200 text-green-900 border border-green-300",
  Abgelehnt: "bg-purple-200/60 text-purple-900 border border-purple-300",
  Erledigt: "bg-emerald-200 text-emerald-900 border border-emerald-300",
};

const offerStatuses = ["Entwurf", "Gesendet", "Angenommen", "Abgelehnt"];
/** Statuses that are considered "active" — used for default list view */
const ACTIVE_OFFER_STATUSES = ["Entwurf", "Gesendet"];

const compactOfferValue = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const offerSiteKey = (site: OfferExecutionSite) =>
  [site.siteName, site.siteAddress, site.sitePlz, site.siteCity, site.siteNote]
    .map((value) => compactOfferValue(value).toLowerCase())
    .join("|");

function collectOfferExecutionSites(offer: Offer): OfferExecutionSite[] {
  const sites: OfferExecutionSite[] = [];
  const addSite = (candidate?: OfferExecutionSite | null) => {
    if (!candidate) return;
    const site: OfferExecutionSite = {
      siteName: compactOfferValue(candidate.siteName) || null,
      siteAddress: compactOfferValue(candidate.siteAddress) || null,
      sitePlz: compactOfferValue(candidate.sitePlz) || null,
      siteCity: compactOfferValue(candidate.siteCity) || null,
      siteNote: compactOfferValue(candidate.siteNote) || null,
      sourceOrderId: compactOfferValue(candidate.sourceOrderId) || null,
    };
    if (
      !site.siteName &&
      !site.siteAddress &&
      !site.sitePlz &&
      !site.siteCity &&
      !site.siteNote
    )
      return;
    const key = offerSiteKey(site);
    if (!sites.some((existing) => offerSiteKey(existing) === key)) {
      sites.push(site);
    }
  };

  (offer.items || []).forEach((item: any) =>
    addSite({
      siteName: item?.siteName,
      siteAddress: item?.siteAddress,
      sitePlz: item?.sitePlz,
      siteCity: item?.siteCity,
      siteNote: item?.siteNote,
      sourceOrderId: item?.sourceOrderId,
    }),
  );

  (offer.orders || []).forEach((order) => {
    const workSites = Array.isArray(order.workSites)
      ? [...order.workSites].sort(
          (a, b) =>
            Number(Boolean(b?.isPrimary)) - Number(Boolean(a?.isPrimary)) ||
            Number(a?.sortOrder ?? 0) - Number(b?.sortOrder ?? 0),
        )
      : [];
    workSites.forEach((site) => addSite({ ...site, sourceOrderId: order.id }));

    if (workSites.length === 0 || order.siteAddressDifferent) {
      addSite({
        siteName: order.siteName,
        siteAddress: order.siteAddress,
        sitePlz: order.sitePlz,
        siteCity: order.siteCity,
        siteNote: order.siteNote,
        sourceOrderId: order.id,
      });
    }
  });

  return sites;
}

function getOfferValidDays(offer: Offer) {
  const start = offer.offerDate ? new Date(offer.offerDate) : null;
  const end = offer.validUntil ? new Date(offer.validUntil) : null;
  if (
    start &&
    end &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime())
  ) {
    return String(
      Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000)),
    );
  }
  return "14";
}

function buildOfferPdfTextSuggestion(offer: Offer) {
  const summaries = Array.from(
    new Set(
      (offer.orders || [])
        .map((order) => String(order?.description || "").trim())
        .filter(Boolean),
    ),
  );
  if (summaries.length > 0) return summaries.join("\n\n");

  const services = Array.from(
    new Set(
      (offer.items || [])
        .map((item: any) => String(item?.description || "").trim())
        .filter(Boolean),
    ),
  );
  return services.length > 0
    ? `Gerne bieten wir Ihnen die nachfolgend aufgeführten Leistungen an: ${services.join(", ")}.`
    : "Gerne unterbreiten wir Ihnen das nachfolgende Angebot.";
}

function cleanOfferPdfTextForEditor(
  offer: Offer,
  linkedOrder?: NonNullable<Offer["orders"]>[number],
) {
  const cleanNotes = stripForwardedMessage(
    offer.notes,
    linkedOrder?.notes,
  ).trim();
  if (!cleanNotes) return "";

  const automaticSummary = String(linkedOrder?.description || "").trim();
  const automaticSuggestion = buildOfferPdfTextSuggestion(offer).trim();
  if (automaticSummary && cleanNotes === automaticSummary) return "";
  if (automaticSuggestion && cleanNotes === automaticSuggestion) return "";
  return cleanNotes;
}

function applyExecutionSitesToOfferItems(
  sourceItems: OfferItem[],
  sites: OfferExecutionSite[],
): OfferItem[] {
  const cleanSites = sites.filter((site) =>
    Boolean(
      compactOfferValue(site.siteName) ||
      compactOfferValue(site.siteAddress) ||
      compactOfferValue(site.sitePlz) ||
      compactOfferValue(site.siteCity) ||
      compactOfferValue(site.siteNote),
    ),
  );

  if (cleanSites.length === 0) {
    return sourceItems.map((item) => ({
      ...item,
      siteName: null,
      siteAddress: null,
      sitePlz: null,
      siteCity: null,
      siteNote: null,
      sourceOrderId: item.sourceOrderId || null,
    }));
  }

  return sourceItems.map((item) => {
    const currentKey = offerSiteKey(item);
    const site =
      (item.sourceOrderId
        ? cleanSites.find(
            (candidate) => candidate.sourceOrderId === item.sourceOrderId,
          )
        : undefined) ||
      cleanSites.find((candidate) => offerSiteKey(candidate) === currentKey) ||
      (cleanSites.length === 1 ? cleanSites[0] : undefined);

    if (!site) return item;
    return {
      ...item,
      siteName: compactOfferValue(site.siteName) || null,
      siteAddress: compactOfferValue(site.siteAddress) || null,
      sitePlz: compactOfferValue(site.sitePlz) || null,
      siteCity: compactOfferValue(site.siteCity) || null,
      siteNote: compactOfferValue(site.siteNote) || null,
      sourceOrderId: site.sourceOrderId || item.sourceOrderId || null,
    };
  });
}

function extractOfferAppointmentLabel(value?: string | null): string {
  const source = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const line = source
    .split(/\n+/g)
    .map((entry) => entry.trim())
    .find((entry) =>
      /\b(?:termin|datum|zeitfenster|appointment)\b/i.test(entry),
    );
  if (!line) return "";

  const date = line.match(/\b(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\b/);
  const time = line.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (date) {
    const dateLabel = `${date[1].padStart(2, "0")}.${date[2].padStart(2, "0")}.`;
    return time
      ? `Termin ${dateLabel} ${time[1].padStart(2, "0")}:${time[2]}`
      : `Termin ${dateLabel}`;
  }

  return line.length > 38 ? `${line.slice(0, 35).trim()}…` : line;
}


const OFFER_PDF_META_PREFIX = "[[SMARTFLOW_OFFER_PDF_V1]]";

type OfferPdfMeta = {
  title: string;
  text: string;
};

function decodeOfferPdfMeta(value?: string | null): OfferPdfMeta {
  const raw = String(value ?? "").trim();
  if (!raw) return { title: "", text: "" };
  if (!raw.startsWith(OFFER_PDF_META_PREFIX)) {
    return { title: "", text: raw };
  }
  try {
    const parsed = JSON.parse(raw.slice(OFFER_PDF_META_PREFIX.length));
    return {
      title: String(parsed?.title ?? "").trim(),
      text: String(parsed?.text ?? "").trim(),
    };
  } catch {
    return { title: "", text: raw };
  }
}

function encodeOfferPdfMeta(title?: string | null, text?: string | null): string {
  const cleanTitle = String(title ?? "").trim();
  const cleanText = String(text ?? "").trim();
  if (!cleanTitle && !cleanText) return "";
  return `${OFFER_PDF_META_PREFIX}${JSON.stringify({
    title: cleanTitle,
    text: cleanText,
  })}`;
}

function normalizeOfferServiceName(value?: string | null): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function AngebotePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("Alle");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name" | "amount">(
    "newest",
  );
  const [visibleCount, setVisibleCount] = useState(30);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editOfferId, setEditOfferId] = useState<string | null>(null);
  const [form, setForm] = useState({
    customerId: "",
    offerDate: new Date().toISOString().split("T")[0],
    validDays: "14",
    pdfTitle: "",
    notes: "",
    status: "Entwurf",
  });
  const getEmptyItem = (): OfferItem => ({
    description: "",
    quantity: "",
    unit: "Stunde",
    unitPrice: "",
  });

  const [items, setItems] = useState<OfferItem[]>([getEmptyItem()]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [fromOrderId, setFromOrderId] = useState<string | null>(null);
  const [vatRate, setVatRate] = useState(8.1);
  const [defaultVatRate, setDefaultVatRate] = useState(8.1);
  const [currency, setCurrency] = useState<"CHF" | "EUR">("CHF");
  const [defaultCurrency, setDefaultCurrency] = useState<"CHF" | "EUR">("CHF");
  // Stage M.2: Business WhatsApp intake number used as recipient for
  // "PDF an WhatsApp senden". NEVER use Customer.phone for this feature.
  const [businessWhatsappNumber, setBusinessWhatsappNumber] = useState<
    string | null
  >(null);
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);

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
  // shortcut in list cards via openEditOffer({openCustomerSection:true}).
  const [pendingOpenCustomerEditor, setPendingOpenCustomerEditor] = useState<
    string | null
  >(null);
  const customerEditorRef = useRef<HTMLDivElement | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);

  // Android/browser back: close the edit dialog FIRST instead of jumping to the
  // previously visited module. Safe version — see lib/use-dialog-back-guard.ts.
  useDialogBackGuard(dialogOpen, () => setDialogOpen(false));

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

  const [executionSites, setExecutionSites] = useState<OfferExecutionSite[]>(
    [],
  );
  const [editingExecutionAddress, setEditingExecutionAddress] = useState(false);
  const [selectedChipDetail, setSelectedChipDetail] = useState<string | null>(
    null,
  );
  const executionAddressRef = useRef<HTMLDivElement | null>(null);
  const offerDetailsRef = useRef<HTMLDivElement | null>(null);

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
  // `openEditOffer()` because React state updates batch).
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
          // Also update nested customer in offers so list/cards refresh immediately
          setOffers((prev) =>
            prev.map((o) =>
              o.customerId === updated.id
                ? { ...o, customer: { ...o.customer, ...updated } }
                : o,
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

  // Media playback
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [dropdownOpenId, setDropdownOpenId] = useState<string | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpenId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-offer-dropdown]")) setDropdownOpenId(null);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [dropdownOpenId]);

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

  const openMedia = async (cloudPath: string, type: string) => {
    if (type === "audio") {
      const url = await resolveS3Url(cloudPath);
      setMediaUrl(url);
      setMediaType("audio");
      setGalleryUrls([]);
      setMediaDialogOpen(true);
      return;
    }
    const url = await resolveS3Url(cloudPath);
    setGalleryUrls([url]);
    setGalleryIdx(0);
    setMediaType("image");
    setMediaUrl(null);
    setMediaDialogOpen(true);
  };

  const openImageGallery = async (paths: string[]) => {
    const resolved = await Promise.all(paths.map((p) => resolveS3Url(p)));
    setGalleryUrls(resolved);
    setGalleryIdx(0);
    setMediaType("image");
    setMediaUrl(null);
    setMediaDialogOpen(true);
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const {
      results: [off, cust, svc, settings],
      errors,
    } = await fetchAllJSON<[any[], any[], any[], any]>([
      { url: "/api/offers", fallback: [] },
      { url: "/api/customers", fallback: [] },
      { url: "/api/services", fallback: [] },
      { url: "/api/settings", fallback: null },
    ]);
    // If most critical endpoints failed, show error state
    if (errors.length >= 2) {
      setLoadError(errors);
      setLoading(false);
      return;
    }
    // Merge customers from offers (they may be soft-deleted and not in /api/customers)
    const custMap = new Map<string, any>();
    (cust ?? []).forEach((c: any) => custMap.set(c.id, c));
    (off ?? []).forEach((o: any) => {
      if (o.customer && !custMap.has(o.customer.id))
        custMap.set(o.customer.id, o.customer);
    });
    setOffers(off ?? []);
    setCustomers(Array.from(custMap.values()) as any);
    setServices(svc ?? []);
    // Set default VAT rate from settings
    if (settings) {
      const settingsCurrency = settings.currency === "EUR" ? "EUR" : "CHF";
      setDefaultCurrency(settingsCurrency);

      if (!dialogOpen && !editOfferId) {
        setCurrency(settingsCurrency);
      }
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

  // Auto-open new offer dialog when navigated with ?new=1
  useEffect(() => {
    const isNew = searchParams?.get("new") === "1";
    const custId = searchParams?.get("customerId");
    if (isNew) {
      setEditOfferId(null);
      setVatRate(defaultVatRate);
      setCurrency(defaultCurrency);
      const newForm = {
        customerId: custId || "",
        offerDate: new Date().toISOString().split("T")[0],
        validDays: "14",
        pdfTitle: "",
        notes: "",
        status: "Entwurf",
      };
      setForm(newForm);
      setItems([getEmptyItem()]);
      setLinkedOrderData(null);
      setExecutionSites([]);
      setEditingExecutionAddress(false);
      setSelectedChipDetail(null);
      setShowNewCustomer(false);
      setEditingCustomer(false);
      setDialogOpen(true);
      router.replace("/angebote", { scroll: false });
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Package F: auto-open edit dialog when navigated with ?edit=<id>.
  // This is the SINGLE source-of-truth entry point for direct-open from the
  // customer detail page (or any deep link). It fetches the exact target offer
  // by id via /api/offers/<id> — so it works even if the offer is hidden by
  // the default 'Aktive' filter, not yet loaded into the in-memory list, or
  // the list failed to load. Never shows an unrelated filtered list state.
  useEffect(() => {
    const editId = searchParams?.get("edit");
    if (!editId || dialogOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/offers/${editId}`);
        if (cancelled) return;
        if (!res.ok) {
          toast.error(
            res.status === 404
              ? "Angebot nicht gefunden"
              : "Fehler beim Öffnen",
          );
          router.replace("/angebote", { scroll: false });
          return;
        }
        const off = await res.json();
        if (cancelled) return;
        openEditOffer(off);
        router.replace("/angebote", { scroll: false });
      } catch {
        if (!cancelled) {
          toast.error("Fehler beim Öffnen");
          router.replace("/angebote", { scroll: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // fromOrder auto-open removed — small dropdown now creates directly via API

  const addItem = () => setItems([...items, getEmptyItem()]);
  const removeItem = (i: number) =>
    setItems(items?.filter((_: any, idx: number) => idx !== i) ?? []);
  const updateItem = (i: number, field: string, value: string) => {
    const updated = [...(items ?? [])];
    if (updated[i]) (updated[i] as any)[field] = value;
    setItems(updated);
  };

  const addServiceItem = (svc: any) => {
    setItems([
      ...items,
      {
        description: svc?.name ?? "",
        quantity: "1",
        unit: svc?.unit ?? "Stunde",
        unitPrice: String(svc?.defaultPrice ?? 0),
      },
    ]);
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

  const subtotal =
    items?.reduce(
      (sum: number, item: OfferItem) =>
        sum + Number(item?.quantity ?? 0) * Number(item?.unitPrice ?? 0),
      0,
    ) ?? 0;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;
  const parsedLinkedSpecialNotes = splitSpecialNotes(
    linkedOrderData?.specialNotes,
  );
  const linkedSafetyWarnings = parsedLinkedSpecialNotes.safetyWarnings;
  const linkedJobHints = parsedLinkedSpecialNotes.jobHints;

  const updateExecutionSite = (
    index: number,
    field: keyof OfferExecutionSite,
    value: string,
  ) => {
    setExecutionSites((current) => {
      const next = [...current];
      const existing = next[index] || {};
      next[index] = {
        ...existing,
        [field]: value,
      };
      return next;
    });
  };

  const setExecutionAddressEnabled = (enabled: boolean) => {
    if (enabled) {
      setExecutionSites((current) =>
        current.length > 0
          ? current
          : [
              {
                siteName: "",
                siteAddress: "",
                sitePlz: "",
                siteCity: "",
                siteNote: "",
                sourceOrderId: fromOrderId || null,
              },
            ],
      );
      setEditingExecutionAddress(true);
      requestAnimationFrame(() =>
        executionAddressRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
      return;
    }

    setExecutionSites([]);
    setEditingExecutionAddress(false);
  };

  const openOfferSection = (
    off: Offer,
    section: "execution" | "details",
    detail?: string,
  ) => {
    openEditOffer(off);
    setSelectedChipDetail(detail || null);
    window.setTimeout(() => {
      const target =
        section === "execution"
          ? executionAddressRef.current
          : offerDetailsRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 160);
  };

  /**
   * Opens the offer edit dialog. With `opts.openCustomerSection: true`
   * the customer-edit panel is auto-expanded with fresh customer data —
   * used by the list-card "Kundendaten unvollständig" chip so the user
   * lands directly inside the editor with one tap.
   */
  const openEditOffer = (
    off: Offer,
    opts?: { openCustomerSection?: boolean },
  ) => {
    setEditOfferId(off.id);
    setDupCheckOpen(false);
    setEditingExecutionAddress(false);
    setSelectedChipDetail(null);
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
    setVatRate(off.vatRate != null ? Number(off.vatRate) : defaultVatRate);
    setCurrency(
      off.currency === "EUR"
        ? "EUR"
        : off.currency === "CHF"
          ? "CHF"
          : defaultCurrency,
    );
    // Set linked order data for Original-Nachricht / Besonderheiten
    const lo = off.orders?.[0];
    const offerExecutionSites = collectOfferExecutionSites(off);
    const singleExecutionSite =
      offerExecutionSites.length === 1 ? offerExecutionSites[0] : null;
    setExecutionSites(offerExecutionSites);
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
    // Strip forwarded customer message from the customer-visible PDF text.
    // Existing offers without their own text receive a safe, editable suggestion
    // from the linked order summary — never from the raw customer message.
    const decodedPdfMeta = decodeOfferPdfMeta(off.notes);
    const cleanNotes = decodedPdfMeta.text || cleanOfferPdfTextForEditor(off, lo);
    setForm({
      customerId: off.customerId ?? "",
      offerDate: off.offerDate
        ? new Date(off.offerDate).toISOString().split("T")[0]
        : "",
      validDays: getOfferValidDays(off),
      pdfTitle: decodedPdfMeta.title,
      notes: cleanNotes,
      status: off.status ?? "Entwurf",
    });
    if (off.items && off.items.length > 0) {
      setItems(
        off.items.map((i: any) => ({
          description: i.description ?? "",
          quantity: String(i.quantity ?? 0),
          unit: i.unit ?? "Stunde",
          unitPrice: String(i.unitPrice ?? 0),
          siteName: i.siteName || singleExecutionSite?.siteName || null,
          siteAddress:
            i.siteAddress || singleExecutionSite?.siteAddress || null,
          sitePlz: i.sitePlz || singleExecutionSite?.sitePlz || null,
          siteCity: i.siteCity || singleExecutionSite?.siteCity || null,
          siteNote: i.siteNote || singleExecutionSite?.siteNote || null,
          sourceOrderId:
            i.sourceOrderId || singleExecutionSite?.sourceOrderId || null,
        })),
      );
    } else {
      setItems([getEmptyItem()]);
    }
    if (opts?.openCustomerSection && off.customerId) {
      // Stage E (deterministic flow): mark a pending request; the effect below
      // picks it up once dialog is open AND form.customerId === pendingId.
      // This avoids the React batching race where the async fetch in
      // openCustomerEditor could complete before the dialog had even mounted.
      setPendingOpenCustomerEditor(off.customerId);
      // We intentionally DO NOT reset showNewCustomer / editingCustomer here.
    } else {
      setShowNewCustomer(false);
      setEditingCustomer(false);
      setPendingOpenCustomerEditor(null);
    }
    setDialogOpen(true);
    // Auto-fill: extract missing customer data from notes and update DB
    if (off.customerId) autoFillCustomer(off.customerId);
  };

  // Stage E (deterministic chip flow): runs AFTER the dialog has actually
  // opened AND the form is populated. Cannot be raced by openEditOffer's
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

  const openNewOffer = () => {
    setEditOfferId(null);
    setVatRate(defaultVatRate);
    setCurrency(defaultCurrency);
    setForm({
      customerId: "",
      offerDate: new Date().toISOString().split("T")[0],
      validDays: "14",
      pdfTitle: "",
      notes: "",
      status: "Entwurf",
    });
    setItems([getEmptyItem()]);
    setLinkedOrderData(null);
    setExecutionSites([]);
    setEditingExecutionAddress(false);
    setSelectedChipDetail(null);
    setShowNewCustomer(false);
    setEditingCustomer(false);
    setDialogOpen(true);
  };

  // Core save — returns saved offer or null
  const saveOffer = async (): Promise<any | null> => {
    if (!form?.customerId) {
      toast.error("Bitte Kunde wählen");
      return null;
    }
    if (!items?.length || !items[0]?.description?.trim()) {
      toast.error("Mindestens eine Position");
      return null;
    }

    const itemsForSave = applyExecutionSitesToOfferItems(items, executionSites);

    if (editOfferId) {
      const res = await fetch(`/api/offers/${editOfferId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          notes: encodeOfferPdfMeta(form.pdfTitle, form.notes),
          items: itemsForSave,
          vatRate,
          currency,
        }),
      });
      if (res.ok) return await res.json();
      toast.error("Fehler beim Speichern");
      return null;
    } else {
      const payload: any = {
        ...form,
        notes: encodeOfferPdfMeta(form.pdfTitle, form.notes),
        items: itemsForSave,
        vatRate,
        currency,
      };
      if (fromOrderId) payload.orderIds = [fromOrderId];
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return await res.json();
      toast.error("Fehler beim Erstellen");
      return null;
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveOffer();
      if (saved) {
        toast.success(
          editOfferId
            ? "Angebot aktualisiert"
            : `Angebot ${saved?.offerNumber ?? ""} erstellt`,
        );
        setDialogOpen(false);
        setFromOrderId(null);
        load();
      }
    } catch {
      toast.error("Fehler");
    } finally {
      setSaving(false);
    }
  };

  // Save + Create Invoice → navigate to /rechnungen
  const saveAndCreateInvoice = async () => {
    setSaving(true);
    try {
      const saved = await saveOffer();
      if (!saved) {
        setSaving(false);
        return;
      }
      toast.success(
        editOfferId
          ? "Angebot aktualisiert"
          : `Angebot ${saved?.offerNumber ?? ""} erstellt`,
      );

      // Determine offer ID (could be new or existing)
      const offerId = saved.id || editOfferId;
      // Get items from saved response or current form
      const offerItems =
        saved.items && saved.items.length > 0
          ? saved.items.map((i: any) => ({
              description: i.description ?? "",
              quantity: String(i.quantity ?? 0),
              unit: i.unit ?? "Stunde",
              unitPrice: String(i.unitPrice ?? 0),
              siteName: i.siteName || null,
              siteAddress: i.siteAddress || null,
              sitePlz: i.sitePlz || null,
              siteCity: i.siteCity || null,
              siteNote: i.siteNote || null,
              sourceOrderId: i.sourceOrderId || null,
            }))
          : items;

      // Carry over linked order IDs so intake time & communication data are preserved
      const linkedOrderIds =
        saved.orders?.map((o: any) => o.id).filter(Boolean) ?? [];
      // Also check current offer's linked orders from the list state
      const currentOffer = offers.find((o) => o.id === offerId);
      const allOrderIds =
        linkedOrderIds.length > 0
          ? linkedOrderIds
          : (currentOffer?.orders?.map((o) => o.id).filter(Boolean) ?? []);

      // Create invoice from offer data
      const invRes = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: saved.customerId || form.customerId,
          items: offerItems,
          vatRate: saved.vatRate ?? vatRate,
          currency: saved.currency === "EUR" ? "EUR" : currency,
          sourceOfferId: offerId,
          ...(allOrderIds.length > 0 ? { orderIds: allOrderIds } : {}),
        }),
      });
      if (invRes.ok) {
        const invoice = await invRes.json();
        if (invoice.existed) {
          toast.info(
            `Rechnung ${invoice.invoiceNumber} existiert bereits — wird geöffnet`,
          );
        } else {
          toast.success(`Rechnung ${invoice.invoiceNumber} erstellt`);
        }

        // Update offer status to "Angenommen"
        if (offerId) {
          await fetch(`/api/offers/${offerId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "Angenommen" }),
          });
        }

        setDialogOpen(false);
        setFromOrderId(null);
        window.location.href = "/rechnungen";
      } else {
        const errData = await invRes.json().catch(() => null);
        toast.error(errData?.error || "Rechnung konnte nicht erstellt werden");
      }
    } catch (err) {
      console.error("saveAndCreateInvoice error:", err);
      toast.error("Fehler beim Erstellen der Rechnung");
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async (id: string) => {
    window.open(
      `/api/offers/${id}/pdf?_t=${Date.now()}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const sendPdfToWhatsApp = async (off: Offer) => {
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
    setDownloading(off.id);
    const sendingToast = toast.loading(
      "PDF wird erstellt und an Ihre WhatsApp gesendet …",
    );
    try {
      const result = await sendPdfToBusinessWhatsApp({
        kind: "offer",
        id: off.id,
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
      console.error("[angebote] sendPdfToWhatsApp failed", err);
      toast.error("Fehler beim Senden an WhatsApp.");
    } finally {
      setDownloading(null);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    await fetch(`/api/offers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    toast.success("Status aktualisiert");
    load();
  };

  const remove = (id: string) => {
    setConfirmDialog({
      title: "In Papierkorb verschieben?",
      message: "Das Angebot wird in den Papierkorb verschoben.",
      action: async () => {
        await fetch(`/api/offers/${id}`, { method: "DELETE" });
        toast.success("Angebot in Papierkorb verschoben");
        load();
      },
    });
  };

  const moveBackToOrders = (off: Offer) => {
    setConfirmDialog({
      title: "Zurück zu Aufträge?",
      message: "Angebot löschen und Auftrag zurück zu Aufträge verschieben?",
      action: async () => {
        await fetch(`/api/offers/${off.id}`, { method: "DELETE" });
        toast.success("Auftrag zurück zu Aufträge verschoben");
        load();
      },
    });
  };

  const revertToOrder = (off: Offer) => {
    setConfirmDialog({
      title: "Angebot zurücksetzen?",
      message: `Angebot ${off.offerNumber} zurück zu Aufträgen verschieben? Das Angebot wird gelöscht und die verknüpften Aufträge werden wieder aktiv.`,
      action: async () => {
        try {
          const res = await fetch(`/api/offers/${off.id}/revert`, {
            method: "POST",
          });
          if (res.ok) {
            const data = await res.json();
            toast.success(
              `Angebot zurückgesetzt — ${data.revertedOrders || 0} Auftrag/Aufträge wieder aktiv`,
            );
            window.location.href = "/auftraege";
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

  const createInvoiceDirectly = async (off: Offer) => {
    // Direkt Rechnung erstellen via API — kein Extra-Dialog
    const invoiceItems =
      off.items?.map((it: any) => ({
        description: it.description ?? "",
        quantity: String(it.quantity ?? 1),
        unit: it.unit ?? "Stunde",
        unitPrice: String(it.unitPrice ?? 0),
        siteName: it.siteName || null,
        siteAddress: it.siteAddress || null,
        sitePlz: it.sitePlz || null,
        siteCity: it.siteCity || null,
        siteNote: it.siteNote || null,
        sourceOrderId: it.sourceOrderId || null,
      })) ?? [];
    try {
      // Carry over linked order IDs so intake time is preserved on the invoice
      const linkedOrderIds = off.orders?.map((o) => o.id).filter(Boolean) ?? [];
      const invRes = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: off.customerId,
          items: invoiceItems,
          vatRate: off.vatRate ?? defaultVatRate,
          currency: off.currency === "EUR" ? "EUR" : "CHF",
          sourceOfferId: off.id,
          ...(linkedOrderIds.length > 0 ? { orderIds: linkedOrderIds } : {}),
        }),
      });
      if (invRes.ok) {
        const invoice = await invRes.json();
        // Angebot-Status auf "Angenommen" setzen
        await fetch(`/api/offers/${off.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Angenommen" }),
        });
        if (invoice.existed) {
          toast.info(
            `Rechnung ${invoice.invoiceNumber} existiert bereits — wird geöffnet`,
          );
        } else {
          toast.success(
            `Rechnung ${invoice.invoiceNumber} erstellt — Angebot als Angenommen markiert`,
          );
        }
        window.location.href = "/rechnungen";
      } else {
        toast.error("Rechnung konnte nicht erstellt werden");
      }
    } catch {
      toast.error("Fehler beim Erstellen der Rechnung");
    }
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
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileCheck className="w-7 h-7 text-primary" /> Angebote
          </h1>
          <p className="text-muted-foreground mt-1">
            {offers?.filter((o: Offer) => o.status !== "Angenommen").length ??
              0}{" "}
            Angebote
          </p>
        </div>
        <Button onClick={openNewOffer}>
          <Plus className="w-4 h-4 mr-1" />
          Neues Angebot
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Name, Ort, Leistung, Angebots-Nr…"
            className="pl-10 h-9 text-sm"
            value={searchText}
            onChange={(e: any) => setSearchText(e?.target?.value ?? "")}
          />
        </div>
        <select
          className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
          value={statusFilter}
          onChange={(e: any) => setStatusFilter(e?.target?.value ?? "Alle")}
        >
          <option value="Alle">Status: Alle</option>
          <option value="Entwurf">Entwurf</option>
          <option value="Gesendet">Gesendet</option>
          <option value="Angenommen">Angenommen</option>
          <option value="Abgelehnt">Abgelehnt</option>
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
          const filteredOffers = offers
            .filter((off: Offer) => {
              // "Alle" = active workflow offers only (matches Dashboard count logic).
              // "Angenommen" offers have been forwarded to Rechnungen — hide them
              // from the default view but keep them accessible via explicit filter.
              if (statusFilter === "Alle" && off.status === "Angenommen")
                return false;
              if (statusFilter !== "Alle" && off.status !== statusFilter)
                return false;
              const s = searchText?.toLowerCase() ?? "";
              if (!s) return true;
              const itemNames =
                off.items
                  ?.map((it: any) => it.description)
                  .filter(Boolean)
                  .join(" ") || "";
              return (
                off?.customer?.name?.toLowerCase()?.includes(s) ||
                off?.customer?.city?.toLowerCase()?.includes(s) ||
                itemNames.toLowerCase().includes(s) ||
                off?.offerNumber?.toLowerCase()?.includes(s) ||
                off?.customer?.customerNumber?.toLowerCase()?.includes(s)
              );
            })
            .sort((a: Offer, b: Offer) => {
              switch (sortBy) {
                case "oldest":
                  return (
                    new Date(a.createdAt ?? a.offerDate ?? 0).getTime() -
                    new Date(b.createdAt ?? b.offerDate ?? 0).getTime()
                  );
                case "name":
                  return (a.customer?.name ?? "").localeCompare(
                    b.customer?.name ?? "",
                  );
                case "amount":
                  return (Number(b.total) || 0) - (Number(a.total) || 0);
                default:
                  return (
                    new Date(b.createdAt ?? b.offerDate ?? 0).getTime() -
                    new Date(a.createdAt ?? a.offerDate ?? 0).getTime()
                  );
              }
            });
          return filteredOffers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Keine Angebote gefunden
            </p>
          ) : (
            <>
              {filteredOffers
                .slice(0, visibleCount)
                .map((off: Offer, i: number) => {
                  const itemNames =
                    off.items
                      ?.map((it: any) => it.description)
                      .filter(Boolean)
                      .join(" + ") || "";
                  const isSonstiges = off.items?.some(
                    (it: any) =>
                      (it.description ?? "").toLowerCase() === "sonstiges",
                  );
                  const orderCtx = resolveCommunicationData(null, off.orders);
                  const offerExecutionSites = collectOfferExecutionSites(off);
                  const primaryExecutionSite = offerExecutionSites[0] || null;
                  const parsedOfferNotes = splitSpecialNotes(
                    orderCtx.specialNotes,
                  );
                  const offerInfoLines = [
                    ...parsedOfferNotes.safetyWarnings,
                    ...parsedOfferNotes.jobHints,
                  ].filter(Boolean);
                  const appointmentLabel = extractOfferAppointmentLabel(
                    [orderCtx.specialNotes, orderCtx.notes]
                      .filter(Boolean)
                      .join("\n"),
                  );
                  return (
                    <motion.div
                      key={off?.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.015 }}
                    >
                      <Card
                        className="border-2 border-slate-300 hover:border-slate-400 hover:shadow-sm transition-all cursor-pointer tap-safe rounded-xl"
                        onClick={() => openEditOffer(off)}
                      >
                        <CardContent className="px-3 py-2">
                          <div className="flex items-start gap-2">
                            {/* Left: 3-dot menu */}
                            <div
                              className="relative shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDropdownOpenId(
                                    dropdownOpenId === off.id ? null : off.id,
                                  );
                                }}
                                className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                                title="Aktionen"
                              >
                                <MoreVertical className="w-3.5 h-3.5" />
                              </button>
                              {dropdownOpenId === off.id && (
                                <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-900 border rounded-lg shadow-lg py-1 min-w-[180px]">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDropdownOpenId(null);
                                      openEditOffer(off);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                  >
                                    <FileCheck className="w-3.5 h-3.5 text-primary" />
                                    Bearbeiten
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDropdownOpenId(null);
                                      createInvoiceDirectly(off);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                  >
                                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                                    Zur Rechnung
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDropdownOpenId(null);
                                      downloadPdf(off.id);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                  >
                                    <Download className="w-3.5 h-3.5 text-green-600" />
                                    PDF herunterladen
                                  </button>
                                  {whatsappEnabled && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDropdownOpenId(null);
                                        sendPdfToWhatsApp(off);
                                      }}
                                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                    >
                                      <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                                      PDF an WhatsApp senden
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDropdownOpenId(null);
                                      revertToOrder(off);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
                                  >
                                    <Undo2 className="w-3.5 h-3.5 text-amber-600" />
                                    Zurück zu Auftrag
                                  </button>
                                  <div className="border-t my-0.5" />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDropdownOpenId(null);
                                      remove(off.id);
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
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="text-muted-foreground shrink-0">
                                  {(() => {
                                    const dt =
                                      off.orders?.[0]?.createdAt ||
                                      off.createdAt;
                                    return dt
                                      ? new Date(dt).toLocaleDateString(
                                          "de-CH",
                                          { day: "2-digit", month: "2-digit" },
                                        ) +
                                          " " +
                                          new Date(dt).toLocaleTimeString(
                                            "de-CH",
                                            {
                                              hour: "2-digit",
                                              minute: "2-digit",
                                            },
                                          )
                                      : "";
                                  })()}
                                </span>
                                <span className="text-muted-foreground">·</span>
                                <span className="font-medium text-foreground truncate">
                                  {isFallbackCustomerName(off?.customer?.name)
                                    ? "⚠️ Kunde nicht zugeordnet"
                                    : off?.customer?.name || "–"}
                                </span>
                                {off?.customer?.customerNumber && (
                                  <span className="text-muted-foreground shrink-0">
                                    ({off.customer.customerNumber})
                                  </span>
                                )}
                                {primaryExecutionSite && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openOfferSection(off, "execution");
                                    }}
                                    className="inline-flex max-w-[15rem] items-center gap-1 rounded-full border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-800 hover:bg-cyan-100"
                                    title={[
                                      primaryExecutionSite.siteName,
                                      primaryExecutionSite.siteAddress,
                                      [
                                        primaryExecutionSite.sitePlz,
                                        primaryExecutionSite.siteCity,
                                      ]
                                        .filter(Boolean)
                                        .join(" "),
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  >
                                    <MapPin className="h-3 w-3 shrink-0" />
                                    <span className="truncate">
                                      {primaryExecutionSite.siteName ||
                                        primaryExecutionSite.siteAddress ||
                                        "Ausführungsadresse"}
                                    </span>
                                  </button>
                                )}
                                {isCustomerDataIncomplete(off.customer) && (
                                  <MissingCustomerDataBadge
                                    variant="compact"
                                    onClick={() =>
                                      openEditOffer(off, {
                                        openCustomerSection: true,
                                      })
                                    }
                                  />
                                )}
                              </div>
                              <p
                                className={`text-sm font-medium mt-0.5 line-clamp-2 ${isSonstiges ? "text-red-600 dark:text-red-400" : "text-foreground"}`}
                              >
                                {isSonstiges && "⚠ "}
                                {itemNames}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <select
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] border rounded px-1.5 py-0.5 font-medium"
                                  style={getStatusStyle(
                                    OFFER_STATUS_STYLES,
                                    off?.status ?? "",
                                  )}
                                  value={off?.status ?? ""}
                                  onChange={(e: any) => {
                                    e.stopPropagation();
                                    updateStatus(
                                      off?.id,
                                      e?.target?.value ?? "",
                                    );
                                  }}
                                >
                                  {offerStatuses.map((s) => (
                                    <option
                                      key={s}
                                      style={getStatusStyle(
                                        OFFER_STATUS_STYLES,
                                        s,
                                      )}
                                    >
                                      {s}
                                    </option>
                                  ))}
                                </select>
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {off?.offerNumber ?? ""}
                                </span>

                                {off.items?.some(
                                  (it: any) =>
                                    Number(it.quantity) <= 0 ||
                                    Number(it.unitPrice) <= 0,
                                ) && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[11px] px-2 py-0.5 bg-red-200 text-red-800 border border-red-300"
                                  >
                                    Preis/Menge prüfen
                                  </Badge>
                                )}

                                <div
                                  className="contents"
                                  onClickCapture={(event) => {
                                    const element = (
                                      event.target as HTMLElement
                                    ).closest<HTMLElement>(
                                      "[aria-label], [title], button, a",
                                    );
                                    const detail =
                                      element?.getAttribute("aria-label") ||
                                      element?.getAttribute("title") ||
                                      "Kontakt oder Besonderheit";
                                    event.preventDefault();
                                    event.stopPropagation();
                                    element?.blur();
                                    openOfferSection(off, "details", detail);
                                  }}
                                >
                                  <CommunicationChips
                                    data={orderCtx}
                                    compact
                                    onAudioClick={() =>
                                      orderCtx.mediaUrl &&
                                      openMedia(orderCtx.mediaUrl, "audio")
                                    }
                                    onImageClick={() => {
                                      const imgs = orderCtx.imageUrls;
                                      if (imgs && imgs.length > 0)
                                        openImageGallery(imgs);
                                      else if (orderCtx.mediaUrl)
                                        openMedia(orderCtx.mediaUrl, "image");
                                    }}
                                  />
                                </div>
                                {offerInfoLines.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openOfferSection(
                                        off,
                                        "details",
                                        offerInfoLines.join("\n"),
                                      );
                                    }}
                                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                    aria-label="Besonderheiten anzeigen"
                                    title="Besonderheiten anzeigen"
                                  >
                                    <Info className="h-4 w-4" />
                                  </button>
                                )}
                                {parsedOfferNotes.safetyWarnings.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openOfferSection(
                                        off,
                                        "details",
                                        parsedOfferNotes.safetyWarnings.join("\n"),
                                      );
                                    }}
                                    className="inline-flex shrink-0 items-center rounded-full border border-red-300 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                                  >
                                    Achtung · {parsedOfferNotes.safetyWarnings.length}
                                  </button>
                                )}
                                {appointmentLabel && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openOfferSection(
                                        off,
                                        "details",
                                        appointmentLabel,
                                      );
                                    }}
                                    className="inline-flex shrink-0 items-center rounded-full border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
                                  >
                                    {appointmentLabel}
                                  </button>
                                )}
                                <span className="font-mono font-bold text-sm whitespace-nowrap shrink-0 ml-auto tabular-nums">
                                  {formatCurrency(
                                    Number(off?.total ?? 0),
                                    off.currency === "EUR" ? "EUR" : "CHF",
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              {filteredOffers.length > visibleCount && (
                <div className="text-center pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount((v) => v + 30)}
                  >
                    Mehr laden ({filteredOffers.length - visibleCount} weitere)
                  </Button>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Mobile-only navigation shortcut → Rechnungen.
          NOT a conversion. NOT a "new invoice" action. Pure navigation.
          Hidden on md+ (desktop has the sidebar). */}
      <MobileListShortcut
        href="/rechnungen"
        label="Rechnungen"
        ariaLabel="Zu Rechnungen"
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className={`${dupCheckOpen ? "max-w-5xl w-[96vw]" : "max-w-3xl w-[calc(100vw-0.75rem)] sm:w-[95vw]"} max-h-[94vh] scroll-pt-20 overflow-y-auto overflow-x-hidden transition-all`}
        >
          <DialogHeader>
            <DialogTitle>
              {editOfferId ? "Angebot bearbeiten" : "Neues Angebot"}
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
                    {editOfferId && form.customerId ? (
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
                            className="rounded-xl border-2 border-emerald-300 bg-emerald-50/80 p-2 sm:p-3 space-y-1.5 min-w-0 cursor-pointer hover:bg-emerald-100/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                          >
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
                              <>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-semibold">
                                    👤 {cust.customerNumber || ""}
                                    {cust.customerNumber ? " · " : ""}
                                  </span>
                                  <span
                                    className={`text-sm font-semibold ${reqMiss(cust.name) ? "text-red-500 border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                  >
                                    {cust.name || "Name fehlt"}
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
                              </>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <>
                        <div className="flex gap-2">
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
                            return (
                              <div className="mt-2 rounded-xl border-2 border-emerald-300 bg-emerald-50/80 p-2 sm:p-3 space-y-1.5 min-w-0">
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
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm font-semibold">
                                      👤 {cust.customerNumber || ""}
                                      {cust.customerNumber ? " · " : ""}
                                    </span>
                                    <span
                                      className={`text-sm font-semibold ${reqMiss(cust.name) ? "text-red-500 border-b border-red-400 border-dashed pb-0.5 italic" : ""}`}
                                    >
                                      {cust.name || "Name fehlt"}
                                    </span>
                                  </div>
                                )}
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
                    className="rounded-xl border-2 p-2 sm:p-3 space-y-2 bg-blue-50/50 dark:bg-blue-900/10 border-blue-300 dark:border-blue-800 min-w-0"
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
                        Zurück zum Angebot
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {/* Form fields — collapsed when dupCheck open */}
              {dupCheckOpen ? (
                <div className="p-2 bg-muted/40 rounded border border-dashed text-xs text-muted-foreground flex items-center justify-between">
                  <span>
                    {items?.filter((i: OfferItem) => i.description).length || 0}{" "}
                    Leistung(en) · {formatCurrency(total, currency)} ·{" "}
                    {form.offerDate || "—"} · {form.status}
                  </span>
                  <span className="text-[10px] italic">
                    Duplikat-Prüfung aktiv — Form eingeklappt
                  </span>
                </div>
              ) : (
                <>
                  <div
                    ref={executionAddressRef}
                    className="scroll-mt-20 rounded-xl border-2 border-sky-300 bg-sky-50/70 p-3 sm:p-4 dark:bg-sky-950/20"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-slate-400"
                          checked={executionSites.length > 0}
                          onChange={(event) =>
                            setExecutionAddressEnabled(event.target.checked)
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
                      {executionSites.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0"
                          onClick={() =>
                            setEditingExecutionAddress((current) => !current)
                          }
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          {editingExecutionAddress ? "Fertig" : "Bearbeiten"}
                        </Button>
                      )}
                    </div>

                    {executionSites.length === 0 ? (
                      <div className="mt-3 rounded-lg border border-dashed border-sky-300 bg-background px-3 py-2 text-sm text-muted-foreground">
                        Die Rechnungsadresse gilt auch als Ausführungsadresse.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {executionSites.map((site, index) => (
                          <div
                            key={`${site.sourceOrderId || "site"}-${index}`}
                            className="rounded-xl border-2 border-sky-200 bg-white p-3 shadow-sm"
                          >
                            {editingExecutionAddress ? (
                              <div className="space-y-3">
                                <div>
                                  <Label className="text-xs">
                                    Objekt / Bereich
                                  </Label>
                                  <Input
                                    value={site.siteName || ""}
                                    placeholder="z.B. Wohnpark Limmat, Serverraum"
                                    onChange={(event) =>
                                      updateExecutionSite(
                                        index,
                                        "siteName",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">
                                    Strasse + Hausnummer
                                  </Label>
                                  <Input
                                    value={site.siteAddress || ""}
                                    placeholder="Strasse + Hausnummer"
                                    onChange={(event) =>
                                      updateExecutionSite(
                                        index,
                                        "siteAddress",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr]">
                                  <div>
                                    <Label className="text-xs">PLZ</Label>
                                    <Input
                                      value={site.sitePlz || ""}
                                      placeholder="PLZ"
                                      onChange={(event) =>
                                        updateExecutionSite(
                                          index,
                                          "sitePlz",
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">Ort</Label>
                                    <Input
                                      value={site.siteCity || ""}
                                      placeholder="Ort"
                                      onChange={(event) =>
                                        updateExecutionSite(
                                          index,
                                          "siteCity",
                                          event.target.value,
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
                                    value={site.siteNote || ""}
                                    placeholder="Optionaler interner Hinweis"
                                    onChange={(event) =>
                                      updateExecutionSite(
                                        index,
                                        "siteNote",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start gap-2">
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold">
                                    {site.siteName ||
                                      (executionSites.length > 1
                                        ? `Ausführungsort ${index + 1}`
                                        : "Ausführungsadresse")}
                                  </div>
                                  <div className="mt-1 grid grid-cols-[74px_1fr] gap-x-2 gap-y-1 text-sm">
                                    <span className="text-muted-foreground">
                                      Strasse:
                                    </span>
                                    <span className="break-words">
                                      {site.siteAddress || "–"}
                                    </span>
                                    <span className="text-muted-foreground">
                                      PLZ / Ort:
                                    </span>
                                    <span className="break-words">
                                      {[site.sitePlz, site.siteCity]
                                        .filter(Boolean)
                                        .join(" ") || "–"}
                                    </span>
                                    {site.siteNote && (
                                      <>
                                        <span className="text-muted-foreground">
                                          Hinweis:
                                        </span>
                                        <span className="break-words">
                                          {site.siteNote}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <Label className="block text-sm font-semibold">
                          Leistungen *
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Gleich aufgebaut wie im Auftrag: kompakte Karten,
                          klare Prüfung und ruhige Standard-Ansicht.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-2"
                        onClick={addItem}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Leistung hinzufügen
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {items?.map((item: OfferItem, idx: number) => {
                        const lineTotal =
                          Number(item?.unitPrice ?? 0) *
                          Number(item?.quantity ?? 0);
                        const matchedService = (services || []).find(
                          (svc: any) =>
                            normalizeOfferServiceName(svc?.name) ===
                            normalizeOfferServiceName(item?.description),
                        ) as any;
                        const hasCatalogMatch = Boolean(matchedService);
                        const hasValidPrice = Number(item?.unitPrice ?? 0) > 0;
                        const hasValidQuantity = Number(item?.quantity ?? 0) > 0;
                        const catalogUnit = String(matchedService?.unit ?? "").trim();
                        const catalogPrice = Number(matchedService?.defaultPrice ?? 0);
                        const sameUnit =
                          !hasCatalogMatch ||
                          !catalogUnit ||
                          String(item?.unit ?? "").trim() === catalogUnit;
                        const samePrice =
                          !hasCatalogMatch ||
                          Number.isNaN(catalogPrice) ||
                          Math.abs(Number(item?.unitPrice ?? 0) - catalogPrice) < 0.001;
                        const needsReview =
                          !hasValidPrice ||
                          !hasValidQuantity ||
                          !hasCatalogMatch ||
                          !sameUnit ||
                          !samePrice;
                        return (
                          <div
                            key={idx}
                            className={`min-w-0 space-y-3 rounded-xl border-2 p-3 shadow-sm ${
                              needsReview
                                ? "border-amber-300 bg-amber-50/70"
                                : "border-slate-300 bg-slate-50/70"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
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
                                  contextLabel="Angebot"
                                />
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Total
                                </div>
                                <div className="font-mono text-sm font-bold tabular-nums">
                                  {formatCurrency(lineTotal, currency)}
                                </div>
                              </div>
                              {items?.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeItem(idx)}
                                  className="shrink-0 rounded-md p-1 text-destructive hover:bg-red-50 hover:text-destructive/80"
                                  title="Leistung entfernen"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                              <div>
                                <Label className="text-xs">Einheit</Label>
                                <select
                                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                                  value={item?.unit ?? "Stunde"}
                                  onChange={(event) =>
                                    updateItem(
                                      idx,
                                      "unit",
                                      event.target.value || "Stunde",
                                    )
                                  }
                                >
                                  <option value="Stunde">Stunde</option>
                                  <option value="Tag">Tag</option>
                                  <option value="Pauschal">Pauschal</option>
                                  <option value="Meter">Meter</option>
                                  <option value="Quadratmeter">
                                    Quadratmeter
                                  </option>
                                  <option value="Kubikmeter">Kubikmeter</option>
                                  <option value="Stück">Stück</option>
                                  <option value="Kilogramm">Kilogramm</option>
                                  <option value="Tonne">Tonne</option>
                                  <option value="Liter">Liter</option>
                                </select>
                              </div>
                              <div>
                                <Label className="text-xs">
                                  Preis ({currency})
                                </Label>
                                <Input
                                  type="number"
                                  step="0.05"
                                  placeholder="prüfen"
                                  className={`h-9 ${
                                    Number(item?.unitPrice ?? 0) <= 0
                                      ? "border-red-500 bg-red-50"
                                      : ""
                                  }`}
                                  value={
                                    Number(item?.unitPrice ?? 0) <= 0
                                      ? ""
                                      : (item?.unitPrice ?? "")
                                  }
                                  onChange={(event) =>
                                    updateItem(
                                      idx,
                                      "unitPrice",
                                      event.target.value || "0",
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Menge</Label>
                                <Input
                                  type="number"
                                  step="0.25"
                                  placeholder="prüfen"
                                  className={`h-9 ${
                                    Number(item?.quantity ?? 0) <= 0
                                      ? "border-red-500 bg-red-50"
                                      : ""
                                  }`}
                                  value={
                                    Number(item?.quantity ?? 0) <= 0
                                      ? ""
                                      : (item?.quantity ?? "")
                                  }
                                  onChange={(event) =>
                                    updateItem(
                                      idx,
                                      "quantity",
                                      event.target.value || "0",
                                    )
                                  }
                                />
                              </div>
                            </div>

                            {item?.description?.trim() && needsReview && (
                              <div className="rounded-lg border border-amber-300 bg-amber-100/60 px-3 py-2 text-sm text-amber-900">
                                <div className="font-semibold">⚠ Manuell prüfen</div>
                                {!hasCatalogMatch ? (
                                  <div className="mt-1 text-xs">
                                    Nicht im Leistungskatalog. Optional später in
                                    den Katalog übernehmen.
                                  </div>
                                ) : (
                                  <div className="mt-1 space-y-1 text-xs">
                                    <div>
                                      Katalog: {catalogUnit || "—"} · {formatCurrency(catalogPrice, currency)}
                                    </div>
                                    {!sameUnit && (
                                      <div>Einheit weicht vom Katalog ab.</div>
                                    )}
                                    {!samePrice && (
                                      <div>Preis weicht vom Katalog ab.</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }) ?? []}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full border-2"
                      onClick={addItem}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Weitere Leistung hinzufügen
                    </Button>
                  </div>
                  <div className="min-w-0 space-y-4 rounded-xl border-2 border-slate-300 bg-slate-50/80 p-3 sm:p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                      <div>
                        <Label>Angebotsdatum</Label>
                        <Input
                          type="date"
                          value={form.offerDate}
                          onChange={(event) =>
                            setForm({ ...form, offerDate: event.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label>Gültig (Tage)</Label>
                        <Input
                          type="number"
                          min="0"
                          value={form.validDays}
                          onChange={(event) =>
                            setForm({ ...form, validDays: event.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label>Status</Label>
                        <select
                          className="flex h-10 w-full rounded-md border border-input px-3 py-2 text-sm"
                          style={getStatusStyle(
                            OFFER_STATUS_STYLES,
                            form.status,
                          )}
                          value={form.status}
                          onChange={(event) =>
                            setForm({ ...form, status: event.target.value })
                          }
                        >
                          {offerStatuses.map((status) => (
                            <option
                              key={status}
                              style={getStatusStyle(
                                OFFER_STATUS_STYLES,
                                status,
                              )}
                            >
                              {status}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label>Währung</Label>
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={currency}
                          onChange={(event) =>
                            setCurrency(
                              event.target.value === "EUR" ? "EUR" : "CHF",
                            )
                          }
                        >
                          <option value="CHF">CHF</option>
                          <option value="EUR">EUR</option>
                        </select>
                      </div>
                    </div>

                    <MwStControl vatRate={vatRate} onChange={setVatRate} />
                    <div className="min-w-0 space-y-1 border-t-2 border-slate-300 pt-3 text-sm">
                      <div className="flex min-w-0 justify-between">
                        <span className="shrink-0">Netto</span>
                        <span className="font-mono tabular-nums">
                          {formatCurrency(subtotal, currency)}
                        </span>
                      </div>
                      {vatRate > 0 && (
                        <div className="flex min-w-0 justify-between">
                          <span className="shrink-0">MwSt. {vatRate}%</span>
                          <span className="font-mono tabular-nums">
                            {formatCurrency(vatAmount, currency)}
                          </span>
                        </div>
                      )}
                      <div className="flex min-w-0 justify-between border-t-2 border-slate-300 pt-2 text-base font-bold">
                        <span className="shrink-0">Total</span>
                        <span className="font-mono text-primary tabular-nums">
                          {formatCurrency(total, currency)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {!showNewCustomer && (
                    <div className="mb-1 flex flex-wrap justify-center gap-2 sm:justify-end">
                      <Button
                        variant="outline"
                        onClick={() => setDialogOpen(false)}
                      >
                        Abbrechen
                      </Button>
                      <Button onClick={save} disabled={saving}>
                        {saving
                          ? "Speichern..."
                          : editOfferId
                            ? "Speichern"
                            : "Angebot erstellen"}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={saveAndCreateInvoice}
                        disabled={saving}
                        className="border border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                      >
                        <FileText className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />→
                        Rechnung
                      </Button>
                    </div>
                  )}

                  <div className="space-y-3 rounded-xl border-2 border-slate-300 bg-background p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <Label className="font-semibold">
                          Text für Angebot / PDF
                        </Label>
                        <div className="text-xs text-muted-foreground">
                          Kunden-Sicht im PDF. Getrennter Titel oben, Text darunter.
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Titel im Angebots-PDF</Label>
                      <Input
                        placeholder="z.B. Angebot für Reinigungsarbeiten im Wohnpark Limmat"
                        value={form.pdfTitle}
                        onChange={(event) =>
                          setForm({ ...form, pdfTitle: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Text im Angebots-PDF</Label>
                      <textarea
                        className="flex min-h-[110px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                        rows={5}
                        placeholder="Optionaler Einleitungstext, Zusammenfassung oder Zusatz für das Angebots-PDF..."
                        value={form.notes}
                        onChange={(event) =>
                          setForm({ ...form, notes: event.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div
                    ref={offerDetailsRef}
                    className="scroll-mt-20 space-y-3 rounded-xl border-2 border-slate-300 bg-background p-3 sm:p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Label className="font-semibold">Besonderheiten</Label>
                      <span className="text-xs text-muted-foreground">
                        Intern – nicht automatisch im Kunden-PDF
                      </span>
                    </div>

                    {selectedChipDetail && (
                      <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
                        <div className="mb-1 flex items-center gap-2 font-semibold">
                          <Info className="h-4 w-4" />
                          Ausgewählter Hinweis
                        </div>
                        <div className="whitespace-pre-wrap break-words">
                          {selectedChipDetail}
                        </div>
                      </div>
                    )}

                    {linkedSafetyWarnings.length > 0 && (
                      <div className="space-y-1 rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm text-red-800">
                        <div className="flex items-center gap-2 font-semibold">
                          <AlertTriangle className="h-4 w-4" />
                          Wichtige Gefahren / Warnhinweise
                        </div>
                        <ul className="list-disc pl-5">
                          {linkedSafetyWarnings.map((line, index) => (
                            <li key={`${line}-${index}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {linkedJobHints.length > 0 && (
                      <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                        <div className="mb-2 font-semibold">Weitere Besonderheiten</div>
                        <div className="space-y-1">
                          {linkedJobHints.map((line, index) => (
                            <div
                              key={`${line}-${index}`}
                              className="whitespace-pre-wrap break-words"
                            >
                              {line}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {linkedOrderData && (
                      <div className="space-y-2 rounded-lg border border-slate-300 bg-slate-50/70 p-3 text-sm">
                        <div className="font-semibold">Kundennachricht</div>
                        {linkedOrderData.audioTranscript && (
                          <div className="rounded-md border bg-background p-2">
                            <div className="mb-1 text-xs font-medium text-muted-foreground">
                              Transkription
                            </div>
                            <div className="whitespace-pre-wrap break-words">
                              {linkedOrderData.audioTranscript}
                            </div>
                          </div>
                        )}
                        {stripForwardedMessage(String(linkedOrderData.notes || "")).trim() ? (
                          <div className="max-h-[320px] overflow-auto rounded-md border bg-background p-2 whitespace-pre-wrap break-words">
                            {stripForwardedMessage(String(linkedOrderData.notes || "")).trim()}
                          </div>
                        ) : linkedOrderData.mediaUrl ? (
                          <div className="rounded-md border bg-background p-2 text-muted-foreground">
                            Medienhinweis vorhanden.
                          </div>
                        ) : (
                          <div className="rounded-md border bg-background p-2 text-muted-foreground">
                            Keine Kundennachricht gespeichert.
                          </div>
                        )}
                      </div>
                    )}
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
                      if (!editOfferId) return;
                      const oldCustomerId = form.customerId; // capture before overwrite
                      const res = await fetch(`/api/offers/${editOfferId}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ customerId: match.id }),
                      });
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
                      setOffers((prev: Offer[]) =>
                        prev.map((o) =>
                          o.id === editOfferId
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
                        setOffers((prev) =>
                          prev.map((o: any) =>
                            o.customerId === m.id
                              ? { ...o, customer: { ...o.customer, ...m } }
                              : o,
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
          {/* Mobile hotfix: the old sticky "Weiter zu Rechnung" bottom-bar
              inside this edit dialog was removed. The dialog already has
              the regular desktop action buttons ("→ Rechnung", "Speichern").
              Navigation between main lists now happens via the small
              mobile-only shortcut rendered at the END of the list page
              (see <MobileListShortcut /> below). */}
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
                await confirmDialog?.action();
                setConfirmDialog(null);
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
