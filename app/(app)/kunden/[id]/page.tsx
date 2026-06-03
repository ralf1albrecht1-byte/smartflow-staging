'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Phone, Mail, MapPin, ClipboardList, FileCheck, FileText, Loader2, Search, AlertTriangle, Pencil, Save, Archive, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import CustomerDuplicateCheck from '@/components/customer-duplicate-check';
import { useDialogBackGuard } from '@/lib/use-dialog-back-guard';
import { isCustomerDataIncomplete, isRequiredCustomerFieldMissing } from '@/lib/customer-links';
import { cn } from '@/lib/utils';
import { PlzOrtInput } from '@/components/plz-ort-input';
import { MissingCustomerDataBadge } from '@/components/missing-customer-data-badge';
import { formatCurrency } from '@/lib/currency';

interface OrderItem {
  id?: string;
  serviceName?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
}

interface Order {
  id: string;
  description: string;
  serviceName: string | null;
  status: string;
  date: string;
  totalPrice: number;
  currency?: string | null;
  specialNotes: string | null;
  needsReview: boolean;
  reviewReasons?: string[] | null;
  items?: OrderItem[] | null;
  hinweisLevel?: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  imageUrls?: string[];
  audioTranscript?: string | null;
  audioDurationSec?: number | null;
  audioTranscriptionStatus?: string | null;
  createdAt?: string;
  // Package E transparency: these tell the UI if the order has been converted
  // to an offer or invoice. Converted orders are hidden in /auftraege by
  // default, but are still shown here so the user can always see the full
  // customer history (matches the strict delete-block rule).
  offerId?: string | null;
  invoiceId?: string | null;
  offer?: { id: string; offerNumber: string; status: string } | null;
  invoice?: { id: string; invoiceNumber: string; status: string } | null;
}

interface Offer {
  id: string;
  offerNumber: string;
  status: string;
  offerDate: string;
  total: number;
  notes: string | null;
  createdAt?: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  invoiceDate: string;
  dueDate: string | null;
  total: number;
  notes: string | null;
  createdAt?: string;
}

interface CustomerExecutionAddress {
  id: string;
  siteName: string | null;
  siteAddress: string;
  sitePlz: string;
  siteCity: string;
  siteNote: string | null;
  country?: string | null;
  usageCount?: number | null;
  lastUsedAt?: string | null;
}

interface Customer {
  id: string;
  customerNumber: string | null;
  name: string;
  address: string | null;
  plz: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  executionAddresses?: CustomerExecutionAddress[];
  orders: Order[];
  offers: Offer[];
  invoices: Invoice[];
}


const formatDate = (d: string | null) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const formatDateTime = (d: string | null | undefined) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + dt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
};

const orderStatusColor: Record<string, string> = {
  'Offen': 'bg-amber-100 text-amber-800',
  'In Bearbeitung': 'bg-blue-100 text-blue-800',
  'Erledigt': 'bg-green-100 text-green-800',
};

const offerStatusColor: Record<string, string> = {
  'Entwurf': 'bg-gray-100 text-gray-800',
  'Gesendet': 'bg-blue-100 text-blue-800',
  'Angenommen': 'bg-green-100 text-green-800',
  'Abgelehnt': 'bg-red-100 text-red-800',
};

const invoiceStatusColor: Record<string, string> = {
  'Entwurf': 'bg-gray-100 text-gray-800',
  'Offen': 'bg-amber-100 text-amber-800',
  'Gesendet': 'bg-blue-100 text-blue-800',
  'Bezahlt': 'bg-green-100 text-green-800',
  'Erledigt': 'bg-green-100 text-green-800',
};



export default function KundenDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerId = params?.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  // Package G/H: dedicated 'historie' tab for consolidated view of
  // weitergeführte (converted) orders, abgeschlossene (Angenommen/Abgelehnt/
  // Abgelaufen) offers, and erledigte/archivierte invoices. Pairs with the
  // "N Historie" chip in the customer list.
  const tabFromUrl = searchParams?.get('tab') as 'auftraege' | 'angebote' | 'rechnungen' | 'historie' | 'archiv' | null;
  const [activeTab, setActiveTab] = useState<'auftraege' | 'angebote' | 'rechnungen' | 'historie' | 'archiv'>(tabFromUrl || 'auftraege');
  const [tabInitialized, setTabInitialized] = useState(!!tabFromUrl);

  // Edit customer state
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', address: '', plz: '', city: '', country: 'CH', phone: '', email: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState(false);
  const [deletingExecutionAddressId, setDeletingExecutionAddressId] = useState<string | null>(null);

  // Duplicate check state (new shared component)
  const [dupCheckOpen, setDupCheckOpen] = useState(false);

  // Paket J: read-only "ansehen" dialog for historical records. Clicking a
  // completed item in the Historie tab must NOT open the normal active edit
  // dialog at /auftraege?edit= /angebote?edit= /rechnungen?edit= — that would
  // let the user mutate a finalized record. Instead we show a local banner
  // dialog with just the key data + an escape-hatch link to the actual
  // downstream record (linked offer/invoice or /archiv).
  const [historyView, setHistoryView] = useState<
    | { type: 'order'; data: Order }
    | { type: 'offer'; data: Offer }
    | { type: 'invoice'; data: Invoice }
    | null
  >(null);
  const [openOrderReviewTooltipId, setOpenOrderReviewTooltipId] = useState<string | null>(null);

  // Android/browser back: close the duplicate-check dialog FIRST instead of jumping
  // to the previously visited module. Safe version — see lib/use-dialog-back-guard.ts.
  useDialogBackGuard(dupCheckOpen, () => setDupCheckOpen(false));
  // Back-guard for the history-view dialog (Paket J)
  useDialogBackGuard(!!historyView, () => setHistoryView(null));

  const loadCustomer = useCallback(async () => {
    try {
      const res = await fetch(`/api/customers/${customerId}/details`);
      if (res.ok) {
        let loadedCustomer: Customer = await res.json();

        // V17.69: Kundenbasierte Ausführungsorte auf der Detailseite sichtbar
        // machen. Bestehende Detail-API beibehalten; falls sie die neue Relation
        // noch nicht mitliefert, gezielt über die Kunden-API nachladen.
        if (!Array.isArray(loadedCustomer.executionAddresses)) {
          const enrichedRes = await fetch(`/api/customers/${customerId}`);
          if (enrichedRes.ok) {
            const enrichedCustomer = await enrichedRes.json();
            loadedCustomer = {
              ...loadedCustomer,
              executionAddresses: Array.isArray(enrichedCustomer?.executionAddresses)
                ? enrichedCustomer.executionAddresses
                : [],
            };
          } else {
            loadedCustomer = { ...loadedCustomer, executionAddresses: [] };
          }
        }

        setCustomer(loadedCustomer);
      } else {
        toast.error('Kunde nicht gefunden');
        router.push('/kunden');
      }
    } catch {
      toast.error('Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [customerId, router]);

  useEffect(() => { loadCustomer(); }, [loadCustomer]);

  // Smart default tab: if no URL tab specified and customer loaded, pick best tab
  useEffect(() => {
    if (customer && !tabInitialized) {
      setTabInitialized(true);
      if (customer.orders.length === 0 && customer.offers.length > 0) {
        setActiveTab('angebote');
      } else if (customer.orders.length === 0 && customer.offers.length === 0 && customer.invoices.length > 0) {
        setActiveTab('rechnungen');
      }
    }
  }, [customer, tabInitialized]);

  // Sync tab from URL on navigation
  useEffect(() => {
    if (tabFromUrl && ['auftraege', 'angebote', 'rechnungen', 'historie', 'archiv'].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  // Open edit mode
  const startEdit = () => {
    if (!customer) return;
    setEditForm({
      name: customer.name || '',
      address: customer.address || '',
      plz: customer.plz || '',
      city: customer.city || '',
      country: customer.country || 'CH',
      phone: customer.phone || '',
      email: customer.email || '',
    });
    setEditMode(true);
  };

  // Save customer edits + trigger re-check
  const saveEdit = async () => {
    if (!editForm.name.trim()) { toast.error('Name erforderlich'); return; }
    setSavingEdit(true);
    try {
      // Phase 2f: compute fieldsToClear = fields user intentionally emptied.
      const fieldsToClear: string[] = [];
      if (customer) {
        (['name', 'phone', 'email', 'address', 'plz', 'city'] as const).forEach((k) => {
          const was = (customer as any)[k];
          const now = (editForm as any)[k];
          if (was && String(was).trim() && !String(now || '').trim()) fieldsToClear.push(k);
        });
      }
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, fieldsToClear }),
      });
      if (res.ok) {
        toast.success('Kunde aktualisiert – Re-Check durchgeführt');
        setEditMode(false);
        loadCustomer(); // Reload to reflect changes + cleared warnings
      } else {
        const err = await res.json().catch(() => ({} as any));
        if (err?.reason === 'would_clear_existing_value') toast.error(err?.error || 'Feld kann nicht geleert werden.');
        else toast.error('Fehler beim Speichern');
      }
    } catch {
      toast.error('Netzwerkfehler');
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteExecutionAddress = async (addr: CustomerExecutionAddress) => {
    if (!customer) return;
    const label = addr.siteName?.trim() || [addr.siteAddress, addr.sitePlz, addr.siteCity].filter(Boolean).join(' ');
    if (!window.confirm(`Ausführungsort "${label}" wirklich entfernen?`)) return;

    setDeletingExecutionAddressId(addr.id);
    try {
      const res = await fetch(`/api/customers/${customerId}/execution-addresses/${addr.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Ausführungsort wurde aus dem Kundenprofil entfernt.');
        await loadCustomer();
      } else {
        const err = await res.json().catch(() => ({} as any));
        toast.error(err?.error || 'Ausführungsort konnte nicht entfernt werden');
      }
    } catch {
      toast.error('Netzwerkfehler beim Entfernen des Ausführungsorts');
    } finally {
      setDeletingExecutionAddressId(null);
    }
  };

  const deleteCustomer = async () => {
    if (!customer) return;
    const label = customer.name?.trim() || customer.customerNumber || 'diesen Kunden';
    if (!window.confirm(`Kunden "${label}" wirklich löschen? Aktive Aufträge, Angebote, Rechnungen oder archivierte Rechnungen können das Löschen blockieren.`)) return;

    setDeletingCustomer(true);
    try {
      const res = await fetch(`/api/customers/${customerId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Kunde gelöscht');
        router.push('/kunden');
      } else {
        const err = await res.json().catch(() => ({} as any));
        toast.error(err?.error || 'Kunde konnte nicht gelöscht werden');
      }
    } catch {
      toast.error('Netzwerkfehler beim Löschen');
    } finally {
      setDeletingCustomer(false);
    }
  };

  const isOverdue = (inv: Invoice) => {
    if (inv.status === 'Bezahlt' || inv.status === 'Erledigt') return false;
    if (!inv.dueDate) return false;
    return new Date(inv.dueDate) < new Date();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!customer) return null;

  // Package G — Active vs History classification (must match /lib/customer-links.ts):
  //   Aktiver Auftrag:   NICHT konvertiert (kein offerId, kein invoiceId)
  //   Historisch Auftrag: konvertiert zu Angebot ODER Rechnung
  //   Aktives Angebot:    Status in {Entwurf, Gesendet}
  //   Historisch Angebot: Status in {Angenommen, Abgelehnt, Abgelaufen}
  //   Aktive Rechnung:    Status != Erledigt
  //   Historisch Rechnung: Status == Erledigt (archiviert)
  const isOrderActive = (o: Order) => !o.offerId && !o.invoiceId && o.status !== 'Erledigt';
  const isOfferActive = (o: Offer) => o.status === 'Entwurf' || o.status === 'Gesendet';
  const isInvoiceActive = (i: Invoice) => i.status !== 'Erledigt';

  const customerCoreDataIncomplete = isCustomerDataIncomplete(customer);
  const activeOrders = customer.orders.filter(isOrderActive);
  const historicalOrders = customer.orders.filter(o => !isOrderActive(o));
  const activeOffers = customer.offers.filter(isOfferActive);
  const historicalOffers = customer.offers.filter(o => !isOfferActive(o));
  const activeInvoices = customer.invoices.filter(isInvoiceActive);
  const historicalInvoices = customer.invoices.filter(i => !isInvoiceActive(i));
  const archivedInvoices = historicalInvoices;
  const historieCount = historicalOrders.length + historicalOffers.length;
  const archiveCount = archivedInvoices.length;
  const savedExecutionAddresses = Array.isArray(customer.executionAddresses)
    ? customer.executionAddresses.filter((addr) =>
        Boolean(addr?.siteAddress?.trim() && addr?.sitePlz?.trim() && addr?.siteCity?.trim()),
      )
    : [];

  const formatOrderItemLine = (item: OrderItem, currency = 'CHF') => {
    const name = String(item.serviceName || item.description || 'Position').trim();
    const quantity = Number(item.quantity || 0);
    const unit = String(item.unit || '').trim();
    const unitPrice = Number(item.unitPrice || 0);
    const total = Number(item.totalPrice || (quantity > 0 && unitPrice > 0 ? quantity * unitPrice : 0));
    const quantityText = quantity > 0 ? (Number.isInteger(quantity) ? quantity.toFixed(0) : String(quantity)) : '';
    const priceText = unitPrice > 0 ? `${currency} ${unitPrice.toFixed(2)}` : '';
    const totalText = total > 0 ? ` = ${currency} ${total.toFixed(2)}` : '';
    const calc = [quantityText, unit, priceText ? `× ${priceText}` : ''].filter(Boolean).join(' ');
    return `• ${name}${calc ? ` — ${calc}${totalText}` : ''}`;
  };

  const buildCustomerOrderReviewTooltip = (
    order: Order,
    mode: 'customer' | 'address' | 'currency' | 'hard_amount' | 'service_soft' | 'fallback_soft',
  ) => {
    const currency = String((order as any).currency || 'CHF');
    const items = Array.isArray(order.items) ? order.items : [];
    const itemLines = items.slice(0, 6).map((item) => formatOrderItemLine(item, currency));

    if (mode === 'customer') {
      return 'Kundendaten prüfen\nPflichtangaben fehlen: Name, Strasse, PLZ oder Ort.';
    }
    if (mode === 'address') {
      return 'Adresse prüfen\nAdressrolle oder Ausführungsadresse ist noch zu prüfen.';
    }
    if (mode === 'currency') {
      return 'Währung prüfen\nWährung im Kundentext oder in einzelnen Positionen ist zu prüfen.';
    }
    if (mode === 'hard_amount') {
      return 'Preis/Menge prüfen\nPreis, Menge oder Einheit fehlt und muss vor Angebot/Rechnung geprüft werden.';
    }

    const header = mode === 'service_soft'
      ? 'Leistungen prüfen\nPreisabweichung oder Nicht-im-Katalog-Hinweis. Textpreis wurde übernommen.'
      : 'Leistungen prüfen\nDieser Auftrag hat weiche Leistungs-Hinweise, aber keinen harten Blocker.';

    return [header, itemLines.length > 0 ? itemLines.join('\n') : 'Details im Auftrag öffnen.']
      .filter(Boolean)
      .join('\n\n');
  };

  const getCustomerOrderReviewBadge = (order: Order) => {
    if (!order.needsReview) return null;

    const reasons = Array.isArray(order.reviewReasons)
      ? order.reviewReasons.map((reason) => String(reason || '').toLowerCase()).filter(Boolean)
      : [];

    const hasReason = (matcher: (reason: string) => boolean) => reasons.some(matcher);

    if (customerCoreDataIncomplete) {
      return {
        label: 'Kundendaten unvollständig',
        mobileLabel: 'Prüfen',
        className: 'border-red-300 text-red-600 bg-red-50',
        title: buildCustomerOrderReviewTooltip(order, 'customer'),
      };
    }

    if (hasReason((reason) =>
      reason === 'address_role_uncertain' ||
      reason.includes('customer_address_quarantined') ||
      reason.includes('ambiguous_role') ||
      reason.includes('execution_address_incomplete') ||
      reason.startsWith('intake_address:'),
    )) {
      return {
        label: 'Adresse prüfen',
        mobileLabel: 'Adresse',
        className: 'border-red-300 text-red-600 bg-red-50',
        title: buildCustomerOrderReviewTooltip(order, 'address'),
      };
    }

    if (hasReason((reason) =>
      reason.startsWith('currency_') ||
      reason.startsWith('item_currency_mismatch:') ||
      reason.startsWith('currency_conflict_item:'),
    )) {
      return {
        label: 'Währung prüfen',
        mobileLabel: 'Währung',
        className: 'border-red-300 text-red-600 bg-red-50',
        title: buildCustomerOrderReviewTooltip(order, 'currency'),
      };
    }

    if (hasReason((reason) =>
      reason.startsWith('unit_missing_in_text:') ||
      reason.includes('price_missing') ||
      reason.includes('quantity_missing') ||
      reason.includes('amount_missing') ||
      reason.includes('price_quantity'),
    )) {
      return {
        label: 'Preis/Menge prüfen',
        mobileLabel: 'Betrag',
        className: 'border-red-300 text-red-600 bg-red-50',
        title: buildCustomerOrderReviewTooltip(order, 'hard_amount'),
      };
    }

    if (hasReason((reason) =>
      reason.startsWith('price_override:') ||
      reason.startsWith('unit_mismatch:') ||
      reason.includes('catalog') ||
      reason.includes('nicht_im_katalog') ||
      reason.includes('not_in_catalog'),
    )) {
      return {
        label: 'Leistungen prüfen',
        mobileLabel: 'Leistungen',
        className: 'border-yellow-400 text-yellow-900 bg-yellow-50',
        title: buildCustomerOrderReviewTooltip(order, 'service_soft'),
      };
    }

    // V17.75: Wenn `needsReview` gesetzt ist, aber keine harte konkrete
    // ReviewReason mitgeliefert wurde, darf das Kundenprofil nicht pauschal rot
    // "Auftrag prüfen" zeigen. In den getesteten Fällen sind das weiche
    // Leistungs-Hinweise wie Preisabweichung / Nicht im Katalog.
    return {
      label: 'Leistungen prüfen',
      mobileLabel: 'Leistungen',
      className: 'border-yellow-400 text-yellow-900 bg-yellow-50',
      title: buildCustomerOrderReviewTooltip(order, 'fallback_soft'),
    };
  };

  const renderCustomerOrderReviewBadge = (order: Order) => {
    const reviewBadge = getCustomerOrderReviewBadge(order);
    if (!reviewBadge) return null;
    const isOpen = openOrderReviewTooltipId === order.id;

    return (
      <span
        className="relative inline-flex shrink-0"
        onMouseEnter={() => setOpenOrderReviewTooltipId(order.id)}
        onMouseLeave={() => setOpenOrderReviewTooltipId((current) => current === order.id ? null : current)}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpenOrderReviewTooltipId((current) => current === order.id ? null : order.id);
          }}
          className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] leading-5 ${reviewBadge.className}`}
          aria-label={reviewBadge.title}
        >
          ⚠ <span className="sm:hidden ml-1">{reviewBadge.mobileLabel}</span><span className="hidden sm:inline ml-1">{reviewBadge.label}</span>
        </button>
        {isOpen && (
          <span
            className="fixed left-4 right-4 top-[18vh] z-[100] max-h-[58vh] w-auto overflow-auto rounded-md border bg-white p-3 text-left text-xs leading-relaxed text-slate-900 shadow-xl whitespace-pre-line dark:bg-slate-950 dark:text-slate-100 sm:absolute sm:bottom-full sm:left-0 sm:right-auto sm:top-auto sm:z-50 sm:mb-2 sm:max-h-[60vh] sm:w-[min(340px,calc(100vw-2rem))]"
            onClick={(event) => event.stopPropagation()}
          >
            {reviewBadge.title}
          </span>
        )}
      </span>
    );
  };

  const tabs = [
    { key: 'auftraege' as const, label: 'Aufträge', count: activeOrders.length, icon: ClipboardList, historic: historicalOrders.length },
    { key: 'angebote' as const, label: 'Angebote', count: activeOffers.length, icon: FileCheck, historic: historicalOffers.length },
    { key: 'rechnungen' as const, label: 'Rechnungen', count: activeInvoices.length, icon: FileText, historic: archiveCount },
    { key: 'historie' as const, label: 'Historie', count: historieCount, icon: Archive, historic: 0 },
    { key: 'archiv' as const, label: 'Archiv', count: archiveCount, icon: Archive, historic: 0 },
  ];

  // Stage I — On desktop the "→ Historie" hints inside the empty-state cards
  // switch tabs. On mobile (where all four sections render stacked under each
  // other) we additionally smooth-scroll the user down to the Historie section
  // so the click feels meaningful. setActiveTab is a no-op for the mobile
  // layout but keeps desktop behaviour unchanged.
  const goToHistorie = () => {
    setActiveTab('historie');
    if (typeof document !== 'undefined') {
      document.getElementById('mobile-section-historie')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const goToArchiv = () => {
    setActiveTab('archiv');
    if (typeof document !== 'undefined') {
      document.getElementById('mobile-section-archiv')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Stage I — Section JSX extracted into local variables so the same content
  // is rendered both inside the desktop tab system and stacked on mobile,
  // without code duplication.
  const auftraegeSection = (
    <div className="space-y-2">
      {/* Package G: Only active (non-converted) orders live here. */}
      {activeOrders.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Keine aktiven Aufträge
            {historicalOrders.length > 0 && (
              <span className="block mt-1 text-xs">
                {historicalOrders.length} historische{historicalOrders.length === 1 ? 'r' : ''} Auftrag{historicalOrders.length === 1 ? '' : 'e'} in
                <button
                  onClick={goToHistorie}
                  className="ml-1 underline decoration-dotted hover:text-foreground"
                >
                  Historie
                </button>
              </span>
            )}
          </CardContent>
        </Card>
      ) : (
        activeOrders.map(order => (
          <Card key={order.id} className="hover:shadow-md transition-shadow cursor-pointer tap-safe" onClick={() => router.push(`/auftraege?edit=${order.id}`)}>
            <CardContent className="py-3 px-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm truncate">{order.serviceName || order.description}</p>
                    {renderCustomerOrderReviewBadge(order)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(order.date)}
                    {order.createdAt && <span className="ml-2 opacity-60">· Erstellt: {formatDateTime(order.createdAt)}</span>}
                  </p>
                </div>
                <div className="flex w-full items-center justify-between gap-3 border-t pt-2 sm:w-auto sm:justify-start sm:border-t-0 sm:pt-0">
<span className="text-sm font-medium">{formatCurrency((order as any).total || order.totalPrice || 0)}</span><Badge className={`text-xs ${orderStatusColor[order.status] || 'bg-gray-100 text-gray-800'}`}>
                    {order.status}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );

  const angeboteSection = (
    <div className="space-y-2">
      {/* Package G: Only active offers ({Entwurf, Gesendet}) live here. */}
      {activeOffers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Keine aktiven Angebote
            {historicalOffers.length > 0 && (
              <span className="block mt-1 text-xs">
                {historicalOffers.length} abgeschlossene{historicalOffers.length === 1 ? 's' : ''} Angebot{historicalOffers.length === 1 ? '' : 'e'} in
                <button
                  onClick={goToHistorie}
                  className="ml-1 underline decoration-dotted hover:text-foreground"
                >
                  Historie
                </button>
              </span>
            )}
          </CardContent>
        </Card>
      ) : (
        activeOffers.map(offer => (
          <Card key={offer.id} className="hover:shadow-md transition-shadow cursor-pointer tap-safe" onClick={() => router.push(`/angebote?edit=${offer.id}`)}>
            <CardContent className="py-3 px-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{offer.offerNumber}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(offer.offerDate)}
                    {offer.createdAt && <span className="ml-2 opacity-60">· Erstellt: {formatDateTime(offer.createdAt)}</span>}
                  </p>
                  {offer.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{offer.notes}</p>}
                </div>
                <div className="flex w-full items-center justify-between gap-3 border-t pt-2 sm:w-auto sm:justify-start sm:border-t-0 sm:pt-0">
                  <span className="text-sm font-medium">{formatCurrency(offer.total)}</span>
                  <Badge className={`text-xs ${offerStatusColor[offer.status] || 'bg-gray-100 text-gray-800'}`}>
                    {offer.status}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );

  const rechnungenSection = (
    <div className="space-y-2">
      {/* Package G: Only active invoices (Status != Erledigt) live here. */}
      {activeInvoices.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Keine aktiven Rechnungen
            {historicalInvoices.length > 0 && (
              <span className="block mt-1 text-xs">
                {archivedInvoices.length} archivierte Rechnung{archivedInvoices.length === 1 ? '' : 'en'} in
                <button
                  onClick={goToArchiv}
                  className="ml-1 underline decoration-dotted hover:text-foreground"
                >
                  Archiv
                </button>
              </span>
            )}
          </CardContent>
        </Card>
      ) : (
        activeInvoices.map(inv => (
          <Card key={inv.id} className="hover:shadow-md transition-shadow cursor-pointer tap-safe" onClick={() => router.push(`/rechnungen?edit=${inv.id}`)}>
            <CardContent className="py-3 px-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{inv.invoiceNumber}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(inv.invoiceDate)}{inv.dueDate ? ` • Fällig: ${formatDate(inv.dueDate)}` : ''}
                    {inv.createdAt && <span className="ml-2 opacity-60">· Erstellt: {formatDateTime(inv.createdAt)}</span>}
                  </p>
                  {inv.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{inv.notes}</p>}
                </div>
                <div className="flex w-full items-center justify-between gap-3 border-t pt-2 sm:w-auto sm:justify-start sm:border-t-0 sm:pt-0">
                  <span className="text-sm font-medium">{formatCurrency(inv.total)}</span>
                  {isOverdue(inv) ? (
                    <Badge className="text-xs bg-red-100 text-red-800">Überfällig</Badge>
                  ) : (
                    <Badge className={`text-xs ${invoiceStatusColor[inv.status] || 'bg-gray-100 text-gray-800'}`}>
                      {inv.status}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );

  // Package G — Historie tab: consolidated view of all completed/converted/archived
  // records for this customer. Grouped by type with clear "Historisch" badges.
  const historieSection = (
    <div className="space-y-6">
      {historieCount === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Keine historischen Einträge
            <span className="block mt-1 text-xs">
              Hier erscheinen weitergeführte Aufträge und abgeschlossene Angebote
            </span>
          </CardContent>
        </Card>
      ) : (
        <>
          {historicalOrders.length > 0 && (
            <div>
              {/* Package H: user-friendly wording — "Weitergeführte Aufträge" with a
                  simple non-technical tooltip so users understand the concept at a
                  glance (instead of the technical "Konvertierte Aufträge"). */}
              <h3
                className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"
                title="Diese Aufträge wurden weitergeführt oder erledigt/archiviert."
              >
                <ClipboardList className="w-3.5 h-3.5" /> Historische Aufträge ({historicalOrders.length})
              </h3>
              <div className="space-y-2">
                {historicalOrders.map(order => {
                  const convertedLabel = order.invoice
                    ? `→ Rechnung ${order.invoice.invoiceNumber}`
                    : order.offer
                      ? `→ Angebot ${order.offer.offerNumber}`
                      : null;
                  return (
                    <Card key={order.id} className="hover:shadow-md transition-shadow cursor-pointer tap-safe opacity-90" onClick={() => setHistoryView({ type: 'order', data: order })}>
                      <CardContent className="py-3 px-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm truncate">{order.serviceName || order.description}</p>
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-gray-400 text-gray-600 shrink-0"
                                title="Dieser Auftrag wurde weitergeführt oder erledigt/archiviert."
                              >
                                Weitergeführt
                              </Badge>
                              {convertedLabel && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-700 shrink-0">{convertedLabel}</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatDate(order.date)}
                              {order.createdAt && <span className="ml-2 opacity-60">· Erstellt: {formatDateTime(order.createdAt)}</span>}
                            </p>
                          </div>
                          <div className="flex w-full items-center justify-between gap-3 border-t pt-2 sm:w-auto sm:justify-start sm:border-t-0 sm:pt-0">
                           <span className="text-sm font-medium">{formatCurrency((order as any).total || order.totalPrice || 0)}</span>
                            <Badge className={`text-xs ${orderStatusColor[order.status] || 'bg-gray-100 text-gray-800'}`}>
                              {order.status}
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {historicalOffers.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5" /> Abgeschlossene Angebote ({historicalOffers.length})
              </h3>
              <div className="space-y-2">
                {historicalOffers.map(offer => (
                  <Card key={offer.id} className="hover:shadow-md transition-shadow cursor-pointer tap-safe opacity-90" onClick={() => setHistoryView({ type: 'offer', data: offer })}>
                    <CardContent className="py-3 px-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-sm">{offer.offerNumber}</p>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-gray-400 text-gray-600 shrink-0">Historisch</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDate(offer.offerDate)}
                            {offer.createdAt && <span className="ml-2 opacity-60">· Erstellt: {formatDateTime(offer.createdAt)}</span>}
                          </p>
                          {offer.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{offer.notes}</p>}
                        </div>
                        <div className="flex w-full items-center justify-between gap-3 border-t pt-2 sm:w-auto sm:justify-start sm:border-t-0 sm:pt-0">
                          <span className="text-sm font-medium">{formatCurrency(offer.total)}</span>
                          <Badge className={`text-xs ${offerStatusColor[offer.status] || 'bg-gray-100 text-gray-800'}`}>
                            {offer.status}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  const archivSection = (
    <div className="space-y-2">
      {archivedInvoices.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Keine archivierten Rechnungen
            <span className="block mt-1 text-xs">
              Erledigte Rechnungen aus dem Archiv werden hier beim Kunden angezeigt.
            </span>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {archivedInvoices.map(inv => (
            <Card key={inv.id} className="hover:shadow-md transition-shadow cursor-pointer tap-safe opacity-90" onClick={() => setHistoryView({ type: 'invoice', data: inv })}>
              <CardContent className="py-3 px-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{inv.invoiceNumber}</p>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-gray-400 text-gray-600 shrink-0">Archiv</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(inv.invoiceDate)}{inv.dueDate ? ` • Fällig: ${formatDate(inv.dueDate)}` : ''}
                      {inv.createdAt && <span className="ml-2 opacity-60">· Erstellt: {formatDateTime(inv.createdAt)}</span>}
                    </p>
                    {inv.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{inv.notes}</p>}
                  </div>
                  <div className="flex w-full items-center justify-between gap-3 border-t pt-2 sm:w-auto sm:justify-start sm:border-t-0 sm:pt-0">
                    <span className="text-sm font-medium">{formatCurrency(inv.total)}</span>
                    <Badge className={`text-xs ${invoiceStatusColor[inv.status] || 'bg-gray-100 text-gray-800'}`}>
                      {inv.status}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex justify-end pt-1">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => router.push('/archiv')}>
              Archiv öffnen
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Back + Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <Button variant="ghost" size="sm" onClick={() => router.push('/kunden')} className="mb-4 -ml-2 gap-2 text-muted-foreground">
          <ArrowLeft className="w-4 h-4" /> Zurück
        </Button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                <span className="text-lg font-bold text-primary">{(customer.name || '?').charAt(0).toUpperCase()}</span>
              </div>
              <div>
                <h2 className={cn('text-xl font-bold', isRequiredCustomerFieldMissing(customer.name) && 'text-red-500 italic')}>
                  {customer.name?.trim() ? customer.name : 'Name fehlt'}
                </h2>
                <p className="text-sm text-muted-foreground">{customer.customerNumber || 'Ohne Nummer'}</p>
              </div>
            </div>

            {/* "Kundendaten fehlen" warning badge — mirrors the badge in list view/dialogs.
                Appears only when required fields (Name, Strasse, PLZ, Ort) are missing. */}
            {isCustomerDataIncomplete(customer) && !editMode && (
              <div className="mt-2">
                <span title="Pflichtangaben fehlen — Name, Strasse, PLZ oder Ort sind nicht erfasst">
                  <MissingCustomerDataBadge variant="standard" />
                </span>
              </div>
            )}

            {!editMode && (
              <div className="flex flex-wrap gap-4 mt-3 text-sm">
                {/* Required-field display rule: missing required (Strasse / PLZ / Ort)
                    → red dashed italic; phone/email stay black (optional). */}
                <span className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5" />
                  <span className={cn(isRequiredCustomerFieldMissing(customer.address) && 'text-red-500 italic border-b border-red-400 border-dashed')}>
                    {customer.address?.trim() ? customer.address : 'Strasse fehlt'}
                  </span>
                  <span>·</span>
                  <span className={cn(isRequiredCustomerFieldMissing(customer.plz) && 'text-red-500 italic border-b border-red-400 border-dashed')}>
                    {customer.plz?.trim() ? customer.plz : 'PLZ fehlt'}
                  </span>
                  <span className={cn(isRequiredCustomerFieldMissing(customer.city) && 'text-red-500 italic border-b border-red-400 border-dashed')}>
                    {customer.city?.trim() ? customer.city : 'Ort fehlt'}
                  </span>
                </span>
                {customer.phone && <span className="flex items-center gap-1 text-muted-foreground"><Phone className="w-3.5 h-3.5" /> {customer.phone}</span>}
                {customer.email && <span className="flex items-center gap-1 text-muted-foreground"><Mail className="w-3.5 h-3.5" /> {customer.email}</span>}
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="gap-2" onClick={startEdit}>
              <Pencil className="w-4 h-4" /> Kunde bearbeiten
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => router.push(`/auftraege?new=1&customerId=${customer.id}`)}>
              <ClipboardList className="w-4 h-4" /> Neuer Auftrag
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setDupCheckOpen(true)}>
              <Search className="w-4 h-4" /> Duplikate prüfen
            </Button>
            <Button variant="outline" size="sm" className="gap-2 border-red-200 text-red-700 hover:bg-red-50" onClick={deleteCustomer} disabled={deletingCustomer}>
              {deletingCustomer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Kunde löschen
            </Button>
          </div>
        </div>

        {/* Inline Edit Form */}
        {editMode && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 border rounded-lg p-4 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 space-y-3">
            <p className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> Kundendaten bearbeiten</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="text-xs">Name *</Label><Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><Label className="text-xs">Telefon</Label><Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></div>
              <div><Label className="text-xs">Strasse + Hausnr. *</Label><Input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} /></div>
              <div><Label className="text-xs">E-Mail</Label><Input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} /></div>
            </div>
            {/* Paket N + O: shared Land/PLZ/Ort input with country-aware autocomplete. */}
            <PlzOrtInput
              country={editForm.country}
              onCountryChange={(country) => setEditForm(f => ({ ...f, country }))}
              plzValue={editForm.plz}
              ortValue={editForm.city}
              onPlzChange={(plz) => setEditForm(f => ({ ...f, plz }))}
              onOrtChange={(city) => setEditForm(f => ({ ...f, city }))}
              onBothChange={(plz, city) => setEditForm(f => ({ ...f, plz, city }))}
              required
              compact
            />
            <p className="text-xs text-muted-foreground">Pflichtfelder: Name, Strasse, PLZ, Ort (Telefon und E-Mail sind optional).</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={savingEdit} className="gap-1.5">
                {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {savingEdit ? 'Speichern...' : 'Speichern'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>Abbrechen</Button>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* V17.69 — gespeicherte kundenbasierte Ausführungsorte sichtbar machen.
          Read-only: Bearbeiten/Löschen kommt erst später, wenn fachlich nötig. */}
      <Card>
        <CardContent className="py-4 px-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Gespeicherte Ausführungsorte</h3>
            </div>
            <Badge variant="outline" className="text-xs">{savedExecutionAddresses.length}</Badge>
          </div>

          {savedExecutionAddresses.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Noch keine Ausführungsorte bei diesem Kunden gespeichert. Vollständige Ausführungsadressen aus neuen Aufträgen werden hier angezeigt.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {savedExecutionAddresses.map((addr) => (
                <div
                  key={addr.id}
                  className="rounded-lg border bg-muted/20 px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium break-words">
                        {addr.siteName?.trim() || 'Ausführungsort'}
                      </p>
                      <p className="text-muted-foreground break-words">
                        {addr.siteAddress}
                      </p>
                      <p className="text-muted-foreground break-words">
                        {addr.sitePlz} {addr.siteCity}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() => deleteExecutionAddress(addr)}
                      disabled={deletingExecutionAddressId === addr.id}
                      aria-label="Ausführungsort entfernen"
                      title="Ausführungsort entfernen"
                    >
                      {deletingExecutionAddressId === addr.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                  {addr.siteNote?.trim() && (
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">
                      {addr.siteNote}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-muted-foreground">
                    {addr.usageCount != null && <span>{addr.usageCount}× verwendet</span>}
                    {addr.lastUsedAt && <span>Zuletzt: {formatDate(addr.lastUsedAt)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Stage I — Customer detail mobile/desktop split (no mobile tabs) ===
          Mobile (md:hidden): all four sections (Aufträge, Angebote, Rechnungen,
          Historie) render stacked vertically under each other with clear
          headings. No tabs, no tab buttons, no activeTab state dependency on
          the visible layout, no horizontal scroll bar, no 2x2 grid, no motion
          tricks.
          Desktop (hidden md:block): original horizontal tab bar preserved
          unchanged — the activeTab state is still used here. */}

      {/* Desktop: original horizontal tab bar + only the active tab's section. */}
      <div className="hidden md:block space-y-4">
        <div className="flex border-b border-border overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-label={
                tab.key === 'historie'
                  ? 'Historie — abgeschlossene, weitergeführte oder archivierte Einträge'
                  : `Aktive ${tab.label}${tab.historic > 0 ? ` — ${tab.historic} weitere im Historie-Tab` : ''}`
              }
              aria-pressed={activeTab === tab.key}
              className={`tap-safe min-h-[44px] flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap select-none ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === tab.key ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>
        <div>
          {activeTab === 'auftraege' && auftraegeSection}
          {activeTab === 'angebote' && angeboteSection}
          {activeTab === 'rechnungen' && rechnungenSection}
          {activeTab === 'historie' && historieSection}
          {activeTab === 'archiv' && archivSection}
        </div>
      </div>

      {/* Mobile: stacked sections, no tabs. Each section has a clear heading
          and renders directly — no tap needed to access sections. */}
      <div className="md:hidden space-y-6">
        <section id="mobile-section-auftraege">
          <h3 className="text-base font-bold mb-3 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary" />
            Aufträge
            <span className="text-xs font-normal text-muted-foreground">({activeOrders.length})</span>
          </h3>
          {auftraegeSection}
        </section>
        <section id="mobile-section-angebote">
          <h3 className="text-base font-bold mb-3 flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-primary" />
            Angebote
            <span className="text-xs font-normal text-muted-foreground">({activeOffers.length})</span>
          </h3>
          {angeboteSection}
        </section>
        <section id="mobile-section-rechnungen">
          <h3 className="text-base font-bold mb-3 flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Rechnungen
            <span className="text-xs font-normal text-muted-foreground">({activeInvoices.length})</span>
          </h3>
          {rechnungenSection}
        </section>
        <section id="mobile-section-historie">
          <h3 className="text-base font-bold mb-3 flex items-center gap-2">
            <Archive className="w-5 h-5 text-primary" />
            Historie
            <span className="text-xs font-normal text-muted-foreground">({historieCount})</span>
          </h3>
          {historieSection}
        </section>
        <section id="mobile-section-archiv">
          <h3 className="text-base font-bold mb-3 flex items-center gap-2">
            <Archive className="w-5 h-5 text-primary" />
            Archiv
            <span className="text-xs font-normal text-muted-foreground">({archiveCount})</span>
          </h3>
          {archivSection}
        </section>
      </div>

      {/* Duplicate Check Dialog (shared component) */}
      {customer && (
        <CustomerDuplicateCheck
          customer={customer}
          open={dupCheckOpen}
          onOpenChange={setDupCheckOpen}
          activeFormName={editMode ? editForm.name : undefined}
          activeFormAddress={editMode ? editForm.address : undefined}
          activeFormCity={editMode ? editForm.city : undefined}
          activeFormPlz={editMode ? editForm.plz : undefined}
          onApplyPlzSuggestion={editMode ? ((plz) => setEditForm((f) => ({ ...f, plz: plz ?? '' }))) : undefined}
          onMergeComplete={async (r) => {
            // Backend keeps the customer with the LOWER customerNumber. If the
            // currently-viewed page is the archived one, navigate to the
            // survivor to avoid rendering a stale/deleted record.
            const currentId = Array.isArray(params?.id) ? params.id[0] : (params?.id as string | undefined);
            if (currentId && r.survivingCustomerId && r.survivingCustomerId !== currentId) {
              router.replace(`/kunden/${r.survivingCustomerId}`);
              return;
            }
            // Stage F – Critical bug fix:
            // If the user is currently editing the customer, replace the
            // local `editForm` state with the freshly merged customer so
            // the visible edit form shows the user-selected values
            // immediately. Otherwise saveEdit() would diff against stale
            // form state and clear the just-merged values via
            // `fieldsToClear`.
            if (editMode && r.mergedCustomer) {
              const m = r.mergedCustomer;
              setEditForm({
                name:    (m.name    ?? '') as string,
                address: (m.address ?? '') as string,
                plz:     (m.plz     ?? '') as string,
                city:    (m.city    ?? '') as string,
                country: (m.country ?? 'CH') as string,
                phone:   (m.phone   ?? '') as string,
                email:   (m.email   ?? '') as string,
              });
            }
            await loadCustomer();
          }}
        />
      )}

      {/* Paket J: Read-only history-view dialog.
          Shown when user clicks a completed/converted item in the Historie tab.
          It shows the finalized data WITHOUT editing UI, plus a clearly labeled
          banner and (where sensible) an escape-hatch button to the downstream
          record. The closed/archived source record itself stays read-only. */}
      <Dialog open={!!historyView} onOpenChange={(open) => { if (!open) setHistoryView(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {historyView?.type === 'order' && <><ClipboardList className="w-4 h-4 shrink-0" /><span>Auftrag ansehen</span></>}
              {historyView?.type === 'offer' && <><FileCheck className="w-4 h-4 shrink-0" /><span>Angebot ansehen</span></>}
              {historyView?.type === 'invoice' && <><FileText className="w-4 h-4 shrink-0" /><span>Rechnung ansehen</span></>}
            </DialogTitle>
          </DialogHeader>
          {historyView && (
            <div className="space-y-4">
              {/* Banner: clearly labels this as a historical (read-only) record */}
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-3 py-2 text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-amber-900 dark:text-amber-100">Historien-Eintrag · Nur Einsicht</p>
                  <p className="text-amber-800 dark:text-amber-200 mt-0.5">
                    {historyView.type === 'order' && 'Dieser Auftrag wurde bereits zu einem Angebot oder einer Rechnung weitergeführt und ist daher schreibgeschützt.'}
                    {historyView.type === 'offer' && 'Dieses Angebot ist bereits abgeschlossen (angenommen, abgelehnt oder abgelaufen) und ist daher schreibgeschützt.'}
                    {historyView.type === 'invoice' && 'Diese Rechnung ist erledigt und im Archiv abgelegt. Sie ist daher schreibgeschützt.'}
                  </p>
                </div>
              </div>

              {/* Read-only data block */}
              {historyView.type === 'order' && (() => {
                const o = historyView.data;
                const convertedLabel = o.invoice
                  ? `→ Rechnung ${o.invoice.invoiceNumber}`
                  : o.offer
                    ? `→ Angebot ${o.offer.offerNumber}`
                    : null;
                // If the linked invoice is Erledigt, route to /archiv instead
                const linkedInvoiceArchived = o.invoice?.status === 'Erledigt';
                return (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Datum</Label>
                        <p className="font-medium">{formatDate(o.date)}</p>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Status</Label>
                        <div className="mt-0.5"><Badge className={`text-xs ${orderStatusColor[o.status] || 'bg-gray-100 text-gray-800'}`}>{o.status}</Badge></div>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-[11px] text-muted-foreground">Leistung / Beschreibung</Label>
                        <p className="font-medium break-words">{o.serviceName || o.description || '-'}</p>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Gesamtbetrag</Label>
                        <p className="font-medium">{formatCurrency((o as any).total || o.totalPrice || 0)}</p>
                      </div>
                      {convertedLabel && (
                        <div>
                          <Label className="text-[11px] text-muted-foreground">Weitergeführt als</Label>
                          <p className="font-medium text-blue-700 dark:text-blue-400">{convertedLabel}</p>
                        </div>
                      )}
                      {o.specialNotes && (
                        <div className="col-span-2">
                          <Label className="text-[11px] text-muted-foreground">Notizen</Label>
                          <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">{o.specialNotes}</p>
                        </div>
                      )}
                    </div>
                    {/* Escape-hatch buttons to the downstream record */}
                    {(o.invoice || o.offer) && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {o.invoice && (
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
                            setHistoryView(null);
                            if (linkedInvoiceArchived) router.push('/archiv');
                            else router.push(`/rechnungen?edit=${o.invoice!.id}`);
                          }}>
                            {linkedInvoiceArchived ? `→ Im Archiv öffnen` : `→ Rechnung ${o.invoice.invoiceNumber} öffnen`}
                          </Button>
                        )}
                        {!o.invoice && o.offer && (
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
                            setHistoryView(null);
                            router.push(`/angebote?edit=${o.offer!.id}`);
                          }}>
                            → Angebot {o.offer.offerNumber} öffnen
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}

              {historyView.type === 'offer' && (() => {
                const o = historyView.data;
                return (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Angebots-Nr.</Label>
                      <p className="font-medium">{o.offerNumber}</p>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Status</Label>
                      <div className="mt-0.5"><Badge className={`text-xs ${offerStatusColor[o.status] || 'bg-gray-100 text-gray-800'}`}>{o.status}</Badge></div>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Angebotsdatum</Label>
                      <p className="font-medium">{formatDate(o.offerDate)}</p>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Gesamtbetrag</Label>
                      <p className="font-medium">{formatCurrency(o.total)}</p>
                    </div>
                    {o.notes && (
                      <div className="col-span-2">
                        <Label className="text-[11px] text-muted-foreground">Notizen</Label>
                        <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">{o.notes}</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {historyView.type === 'invoice' && (() => {
                const i = historyView.data;
                return (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Rechnungs-Nr.</Label>
                        <p className="font-medium">{i.invoiceNumber}</p>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Status</Label>
                        <div className="mt-0.5"><Badge className={`text-xs ${invoiceStatusColor[i.status] || 'bg-gray-100 text-gray-800'}`}>{i.status}</Badge></div>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Rechnungsdatum</Label>
                        <p className="font-medium">{formatDate(i.invoiceDate)}</p>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Fällig am</Label>
                        <p className="font-medium">{formatDate(i.dueDate)}</p>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Gesamtbetrag</Label>
                        <p className="font-medium">{formatCurrency(i.total)}</p>
                      </div>
                      {i.notes && (
                        <div className="col-span-2">
                          <Label className="text-[11px] text-muted-foreground">Notizen</Label>
                          <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">{i.notes}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setHistoryView(null); router.push('/archiv'); }}>
                        → Im Archiv öffnen
                      </Button>
                    </div>
                  </>
                );
              })()}

              <div className="flex justify-end pt-2 border-t">
                <Button variant="outline" onClick={() => setHistoryView(null)}>Schliessen</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}