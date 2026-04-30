'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ClipboardList, Plus, Trash2, Search, Loader2, AlertTriangle, FileText, FileCheck, Volume2, ImageIcon, X, Mail, MoreVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import { TouchImageViewer } from '@/components/touch-image-viewer';
import { CommunicationBlock, CommunicationChips } from '@/components/communication-block';
import { ServiceCombobox, ServiceOption } from '@/components/service-combobox';
import { autoFillCustomerFromNotes } from '@/lib/extract-from-notes';
import { mergeCustomerIntoForm, isFallbackCustomerName } from '@/lib/customer-form';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { DuplicateCheckPanel, type DuplicateMatch } from '@/components/customer-duplicate-check';
import { splitSpecialNotes } from '@/lib/special-notes-utils';
import { fetchAllJSON } from '@/lib/fetch-utils';
import { LoadErrorFallback } from '@/components/load-error-fallback';
import { ORDER_STATUS_STYLES, getStatusStyle } from '@/lib/status-colors';
import { useDialogBackGuard } from '@/lib/use-dialog-back-guard';
import { isCustomerDataIncomplete, isRequiredCustomerFieldMissing } from '@/lib/customer-links';
import { MwStControl } from '@/components/mwst-control';
import { PlzOrtInput } from '@/components/plz-ort-input';
import { CustomerSearchCombobox } from '@/components/customer-search-combobox';
import { AutoReuseBanner } from '@/components/auto-reuse-banner';
import { MissingCustomerDataBadge } from '@/components/missing-customer-data-badge';
import { MobileListShortcut } from '@/components/mobile-list-shortcut';

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
  id: string; customerId: string; description: string; serviceName: string | null;
  status: string; priceType: string; unitPrice: number; quantity: number; totalPrice: number;
  date: string; createdAt?: string; notes: string | null; specialNotes: string | null; needsReview?: boolean;
  reviewReasons?: string[] | null;
  hinweisLevel?: string; mediaUrl: string | null; mediaType: string | null;
  imageUrls?: string[]; audioTranscript?: string | null;
  audioDurationSec?: number | null; audioTranscriptionStatus?: string | null;
  offerId?: string | null; invoiceId?: string | null;
  vatRate?: number | null; vatAmount?: number | null; total?: number | null;
  customer?: { name: string; phone?: string | null; email?: string | null; address?: string | null; plz?: string | null; city?: string | null; customerNumber?: string | null };
  items?: OrderItem[];
}
interface Customer { id: string; name: string; customerNumber?: string | null; address?: string | null; plz?: string | null; city?: string | null; country?: string | null; phone?: string | null; email?: string | null; }
interface ServiceDef { id: string; name: string; defaultPrice: number; unit: string; }

const statuses = ['Alle', 'Offen', 'Erledigt'];
const orderStatuses = ['Offen', 'Erledigt'];
const statusColors: Record<string, string> = {
  'Offen': 'bg-orange-200 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200 border border-orange-300',
  'Erledigt': 'bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-200 border border-green-300',
};

const priceTypes = ['Stunde', 'Pauschal', 'Meter', 'Stück'];

interface FormItem {
  key: string; // client-side key for React
  serviceName: string;
  unit: string;
  unitPrice: string;
  quantity: string;
}

const createEmptyItem = (): FormItem => ({
  key: Math.random().toString(36).slice(2),
  serviceName: '',
  unit: 'Stunde',
  unitPrice: '',
  quantity: '',
});

const emptyForm = {
  customerId: '',
  description: '',
  status: 'Offen',
  date: new Date().toISOString().split('T')[0],
  notes: '',
  specialNotes: '',
};

export default function AuftraegePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<ServiceDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string[] | null>(null);
  const [statusFilter, setStatusFilter] = useState('Alle');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'amount' | 'review'>('newest');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Phase 2d (Stage 3): read-only info line shown in the edit dialog after an
  // Undo of auto-reuse, to give back the previously visible address context
  // without writing anything into the new minimal customer master record.
  const [undoPreviousAddress, setUndoPreviousAddress] = useState<
    { address: string | null; plz: string | null; city: string | null } | null
  >(null);
  const [formItems, setFormItems] = useState<FormItem[]>([createEmptyItem()]);
  // Persisted MwSt on Auftrag — saved on the Order itself (see app/api/orders)
  // and forwarded to the derived Offer/Invoice when converting.
  const [orderVatRate, setOrderVatRate] = useState(8.1);
  const [defaultVatRate, setDefaultVatRate] = useState(8.1);
  const [saving, setSaving] = useState(false);

  // New customer inline / edit customer
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [newCust, setNewCust] = useState({ name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' });
  const [savingCust, setSavingCust] = useState(false);

  // Stage E (deterministic chip flow): pending customerId waiting for the dialog
  // to mount + form to be populated before the customer-edit section is opened.
  // Set by `openEdit(o, { openCustomerSection: true })` when the user taps the
  // "Kundendaten unvollständig" / "Prüfen" chip in a list card. The effect
  // below picks it up once `dialogOpen && form.customerId === pendingId`,
  // loads fresh customer data and reveals the editor — guaranteed to run
  // AFTER the dialog has opened and the form is in sync, so it can never
  // race against `openEdit`'s own resets.
  const [pendingOpenCustomerEditor, setPendingOpenCustomerEditor] = useState<string | null>(null);
  const customerEditorRef = useRef<HTMLDivElement | null>(null);

  // New duplicate check (Phase C — Sheet-based)
  const [dupCheckOpen, setDupCheckOpen] = useState(false);

  // ISSUE 2 — Inline PLZ/city suggestion from exact duplicate matches.
  // Shown directly in the customer section without requiring "Duplikate prüfen".
  const [inlineSuggestion, setInlineSuggestion] = useState<{ type: 'plz' | 'city'; value: string; sourceName: string } | null>(null);
  const inlineSuggestionFetchRef = useRef(0);

  // Android/browser back: close the edit dialog FIRST instead of jumping to the
  // previously visited module. Safe version — see lib/use-dialog-back-guard.ts.
  useDialogBackGuard(dialogOpen, () => setDialogOpen(false));

  // Auto-fill customer data from order notes when dialog opens
  const autoFillCustomer = async (customerId: string) => {
    if (!customerId) return;
    try {
      const res = await fetch(`/api/customers/${customerId}/auto-fill`, { method: 'POST' });
      if (res.ok) {
        const updated = await res.json();
        setCustomers(prev => {
          const exists = prev.some(c => c.id === updated.id);
          if (exists) return prev.map(c => c.id === updated.id ? { ...c, ...updated } : c);
          return [...prev, updated];
        });
      }
    } catch {}
  };

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
  const openCustomerEditor = async (customerIdOverride?: string, noteOverride?: string | null) => {
    const targetId = customerIdOverride || form.customerId;
    if (!targetId) return;
    let freshCust: Customer | null = customers.find((c: Customer) => c.id === targetId) || null;
    try {
      const res = await fetch(`/api/customers/${targetId}`);
      if (res.ok) {
        const fetched = await res.json();
        if (fetched && fetched.id) {
          freshCust = fetched;
          setCustomers(prev => prev.map(c => c.id === fetched.id ? { ...c, ...fetched } : c));
        }
      }
    } catch {}
    if (freshCust) {
      const currentOrder = editId ? orders.find((o: Order) => o.id === editId) : null;
      const noteSource = noteOverride !== undefined ? noteOverride : currentOrder?.notes;
      // ─── CRITICAL: Use a blank form as the base for merging, NOT the
      // potentially stale `newCust` state. This prevents data from a
      // previously viewed order/customer from leaking into the editor.
      // The customer's actual DB values are the sole source of truth.
      const blankForm = { name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' };
      const merged = mergeCustomerIntoForm(blankForm, freshCust as any, noteSource);
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

  // Dropdown menu for create offer/invoice
  const [dropdownOpenId, setDropdownOpenId] = useState<string | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpenId) return;
    const handler = () => setDropdownOpenId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [dropdownOpenId]);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const { results: [o, c, s, settings], errors } = await fetchAllJSON<[Order[], Customer[], ServiceDef[], any]>([
      { url: '/api/orders', fallback: [] },
      { url: '/api/customers', fallback: [] },
      { url: '/api/services', fallback: [] },
      { url: '/api/settings', fallback: null },
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
    setOrders(o ?? []); setCustomers(Array.from(custMap.values())); setServices(s ?? []);
    // Default VAT rate: from CompanySettings (mwstAktiv/mwstSatz) if available, else 8.1
    if (settings) {
      if (settings.mwstAktiv && settings.mwstSatz != null) {
        setDefaultVatRate(Number(settings.mwstSatz));
      } else if (settings.mwstAktiv === false) {
        setDefaultVatRate(0);
      }
    }
    // Show partial-failure toast if some requests failed but data is usable
    if (errors.length > 0) toast.error('Einige Daten konnten nicht vollständig geladen werden');
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Paket L: keep list fresh when user returns to this page.
  // When an order is forwarded to Angebot/Rechnung, we navigate away
  // (router.push('/angebote'|'/rechnungen')). If the user navigates back
  // via the sidebar, Next.js' Router Cache / browser bfcache may restore
  // the previous React tree without re-triggering the mount-only load().
  // This listener forces a re-fetch whenever the tab becomes visible again
  // (sidebar navigation, tab switch, Safari bfcache restore, etc.) so the
  // active Orders list always reflects backend state immediately.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', refreshIfVisible);
    window.addEventListener('pageshow', refreshIfVisible);
    window.addEventListener('focus', refreshIfVisible);
    return () => {
      document.removeEventListener('visibilitychange', refreshIfVisible);
      window.removeEventListener('pageshow', refreshIfVisible);
      window.removeEventListener('focus', refreshIfVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Support ?kunde= filter from Kunden page, with optional autoEdit
  useEffect(() => {
    const kundeFilter = searchParams?.get('kunde');
    const autoEdit = searchParams?.get('autoEdit');
    if (kundeFilter) {
      setSearch(kundeFilter);
      if (autoEdit === '1' && orders.length > 0) {
        const match = orders.find((o: Order) => o.customer?.name?.toLowerCase() === kundeFilter.toLowerCase());
        if (match) openEdit(match);
      }
      router.replace('/auftraege', { scroll: false });
    }
  }, [orders]);

  useEffect(() => {
    const isNew = searchParams?.get('new') === '1';
    const custId = searchParams?.get('customerId');
    const editOrderId = searchParams?.get('edit');
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
            toast.error(res.status === 404 ? 'Auftrag nicht gefunden' : 'Fehler beim Öffnen');
            router.replace('/auftraege', { scroll: false });
            return;
          }
          const order = await res.json();
          if (cancelled) return;
          openEdit(order);
          router.replace('/auftraege', { scroll: false });
        } catch {
          if (!cancelled) {
            toast.error('Fehler beim Öffnen');
            router.replace('/auftraege', { scroll: false });
          }
        }
      })();
      return () => { cancelled = true; };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Only show orders NOT linked to an offer or invoice (they've been "moved")
  const unlinked = orders?.filter((o: Order) => !o.offerId && !o.invoiceId) ?? [];
  const filtered = unlinked.filter((o: Order) => {
    if (statusFilter === 'Offen' && o.status === 'Erledigt') return false;
    if (statusFilter === 'Erledigt' && o.status !== 'Erledigt') return false;
    const s = search?.toLowerCase() ?? '';
    if (!s) return true;
    const svcLine = o.items && o.items.length > 0 ? o.items.map(it => it.serviceName).join(' ') : (o.serviceName ?? '');
    return o?.description?.toLowerCase()?.includes(s) || o?.customer?.name?.toLowerCase()?.includes(s) || svcLine.toLowerCase().includes(s) || o?.customer?.city?.toLowerCase()?.includes(s) || o?.customer?.customerNumber?.toLowerCase()?.includes(s);
  }).sort((a: Order, b: Order) => {
    switch (sortBy) {
      case 'oldest': return new Date(a.createdAt ?? a.date ?? 0).getTime() - new Date(b.createdAt ?? b.date ?? 0).getTime();
      case 'name': return (a.customer?.name ?? '').localeCompare(b.customer?.name ?? '');
      case 'amount': return (Number(b.totalPrice) || 0) - (Number(a.totalPrice) || 0);
      case 'review': return (b.needsReview ? 1 : 0) - (a.needsReview ? 1 : 0) || new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
      default: return new Date(b.createdAt ?? b.date ?? 0).getTime() - new Date(a.createdAt ?? a.date ?? 0).getTime();
    }
  });

  const openNew = () => {
    setEditId(null);
    setForm(emptyForm);
    setFormItems([createEmptyItem()]);
    setShowNewCustomer(false);
    setEditingCustomer(false);
    setOrderVatRate(defaultVatRate);
    setUndoPreviousAddress(null);
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
    setDupCheckOpen(false);
    setUndoPreviousAddress(null);
    // ─── CRITICAL: Reset customer form to blank state BEFORE anything else.
    // Without this, stale customer data from a previously opened order leaks
    // into the merge logic of openCustomerEditor() and appears in the
    // customer editor for fallback / empty customers.
    setNewCust({ name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' });
    setForm({
      customerId: o.customerId ?? '',
      description: o.description ?? '',
      status: o.status ?? 'Offen',
      date: o.date ? new Date(o.date).toISOString().split('T')[0] : '',
      notes: o.notes ?? '',
      specialNotes: splitSpecialNotes(o.specialNotes).jobHints.join('\n'),
    });
    // Populate items from order
    if (o.items && o.items.length > 0) {
      setFormItems(o.items.map(item => ({
        key: Math.random().toString(36).slice(2),
        serviceName: item.serviceName ?? '',
        unit: item.unit ?? 'Stunde',
        unitPrice: String(item.unitPrice ?? 0),
        quantity: String(item.quantity ?? 0),
      })));
    } else {
      setFormItems([{
        key: Math.random().toString(36).slice(2),
        serviceName: o.serviceName ?? '',
        unit: o.priceType ?? 'Stunde',
        unitPrice: String(o.unitPrice ?? 0),
        quantity: String(o.quantity ?? 0),
      }]);
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
    setDialogOpen(true);
    // Auto-fill: extract missing customer data from notes and update DB
    if (o.customerId) autoFillCustomer(o.customerId);
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
        let freshCust: Customer | null = customers.find((c: Customer) => c.id === targetId) || null;
        try {
          const res = await fetch(`/api/customers/${targetId}`);
          if (res.ok) {
            const fetched = await res.json();
            if (fetched && fetched.id) {
              freshCust = fetched;
              if (!cancelled) {
                setCustomers(prev => prev.map(c => c.id === fetched.id ? { ...c, ...fetched } : c));
              }
            }
          }
        } catch {}
        if (cancelled) return;
        if (freshCust) {
          const currentOrder = editId ? orders.find((o: Order) => o.id === editId) : null;
          const noteSource = currentOrder?.notes ?? null;
          const merged = mergeCustomerIntoForm(
            { name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' },
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
          customerEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      } catch {
        if (!cancelled) setPendingOpenCustomerEditor(null);
      }
    })();
    return () => { cancelled = true; };
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
    const hasName = (cust.name || '').trim().length > 0;
    const hasAddress = (cust.address || '').trim().length > 0;
    const hasPlz = (cust.plz || '').trim().length > 0;
    const hasCity = (cust.city || '').trim().length > 0;
    // Need at least name + address + one of (plz, city) to check, and the other must be empty
    if (!hasName || !hasAddress) { setInlineSuggestion(null); return; }
    if (hasPlz && hasCity) { setInlineSuggestion(null); return; } // nothing missing
    if (!hasPlz && !hasCity) { setInlineSuggestion(null); return; } // can't suggest without either
    const fetchId = ++inlineSuggestionFetchRef.current;
    (async () => {
      try {
        const res = await fetch('/api/customers/find-duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: cust.name, address: cust.address, plz: cust.plz,
            city: cust.city, phone: cust.phone, email: cust.email,
            excludeId: cust.id,
          }),
        });
        if (fetchId !== inlineSuggestionFetchRef.current) return;
        if (!res.ok) return;
        const matches = await res.json();
        const exakt = matches.filter((m: any) => m.classification === 'EXAKT');
        if (exakt.length === 0) { setInlineSuggestion(null); return; }
        if (!hasPlz && hasCity) {
          // Suggest PLZ from exact matches
          const withPlz = exakt.filter((m: any) => (m.plz || '').trim().length > 0);
          if (withPlz.length === 0) { setInlineSuggestion(null); return; }
          const unique = Array.from(new Set(withPlz.map((m: any) => (m.plz || '').trim().toLowerCase())));
          if (unique.length !== 1) { setInlineSuggestion(null); return; }
          setInlineSuggestion({ type: 'plz', value: (withPlz[0].plz || '').trim(), sourceName: withPlz[0].name });
        } else if (hasPlz && !hasCity) {
          // Suggest city from exact matches
          const withCity = exakt.filter((m: any) => (m.city || '').trim().length > 0);
          if (withCity.length === 0) { setInlineSuggestion(null); return; }
          const unique = Array.from(new Set(withCity.map((m: any) => (m.city || '').trim().toLowerCase())));
          if (unique.length !== 1) { setInlineSuggestion(null); return; }
          setInlineSuggestion({ type: 'city', value: (withCity[0].city || '').trim(), sourceName: withCity[0].name });
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
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCustomers(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
        toast.success(`${field === 'plz' ? 'PLZ' : 'Ort'} übernommen: ${value}`);
        setInlineSuggestion(null);
      } else {
        toast.error('Fehler beim Übernehmen');
      }
    } catch {
      toast.error('Netzwerkfehler');
    }
  };

  const onItemServiceSelect = (index: number, name: string, svcOpt?: ServiceOption) => {
   const svc = svcOpt;
    setFormItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      if (svc) return { ...item, serviceName: name, unitPrice: String(svc.defaultPrice ?? 0), unit: svc.unit ?? 'Stunde' };
      if (!name) return { ...item, serviceName: '', unitPrice: '', quantity: '', unit: 'Stunde' };
      return { ...item, serviceName: name };
    }));
  };

  const handleServiceCreated = (newSvc: ServiceOption) => {
    setServices(prev => [...prev, newSvc as any].sort((a, b) => (a?.name ?? '').localeCompare(b?.name ?? '', 'de', { sensitivity: 'base' })));
  };

  const updateItem = (index: number, field: keyof FormItem, value: string) => {
    setFormItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const addItem = () => setFormItems(prev => [...prev, createEmptyItem()]);

  const removeItem = (index: number) => {
    if (formItems.length <= 1) return; // keep at least one
    setFormItems(prev => prev.filter((_, i) => i !== index));
  };

  const itemsTotal = formItems.reduce((sum, item) => sum + (Number(item.unitPrice || 0) * Number(item.quantity || 0)), 0);

  // Build description from items
  const buildDescription = () => {
    return formItems.filter(i => i.serviceName).map(i => i.serviceName).join(', ') || form.description;
  };

  // Save customer (update or create — no merge logic, merge goes via Sheet)
  const saveCustomer = async () => {
    if (!newCust.name.trim()) { toast.error('Name erforderlich'); return; }
    setSavingCust(true);
    try {
      if (editingCustomer && form.customerId) {
        // Phase 2f: compute fieldsToClear = fields where DB had a value but user
        // intentionally emptied them. Only these are allowed to be cleared by the
        // server's opt-in clear-protection guard.
        const dbCust = customers.find((c: Customer) => c.id === form.customerId);
        const fieldsToClear: string[] = [];
        if (dbCust) {
          (['name', 'phone', 'email', 'address', 'plz', 'city'] as const).forEach((k) => {
            const was = (dbCust as any)[k];
            const now = (newCust as any)[k];
            if (was && String(was).trim() && !String(now || '').trim()) fieldsToClear.push(k);
          });
        }
        // Update existing customer
        const res = await fetch(`/api/customers/${form.customerId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newCust, fieldsToClear }) });
        if (res.ok) {
          const updated = await res.json();
          setCustomers(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
          // Also update nested customer in orders so list/cards refresh immediately
          setOrders(prev => prev.map(o => o.customerId === updated.id ? { ...o, customer: { ...o.customer, ...updated } } : o));
          setForm(f => ({ ...f, customerId: updated.id }));
          // Clear needsReview if address is now complete (Straße + PLZ + Ort)
          if (editId && updated.address?.trim() && updated.plz?.trim() && updated.city?.trim()) {
            const curOrder = orders.find((o: Order) => o.id === editId);
            if (curOrder?.needsReview) {
              try {
                await fetch(`/api/orders/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ needsReview: false, reviewReasons: [] }) });
                setOrders(prev => prev.map(o => o.id === editId ? { ...o, needsReview: false } : o));
              } catch {}
            }
          }
          toast.success(`Kunde "${updated.name}" aktualisiert!`);
        } else {
          const err = await res.json().catch(() => ({} as any));
          if (err?.reason === 'would_clear_existing_value') toast.error(err?.error || 'Feld kann nicht geleert werden.');
          else toast.error('Fehler beim Aktualisieren');
          return;
        }
      } else {
        // Create new customer
        const res = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCust) });
        if (res.ok) {
          const created = await res.json();
          setCustomers(prev => [...prev, created]);
          setForm(f => ({ ...f, customerId: created.id }));
          toast.success('Neuer Kunde erstellt – eigene ID wurde vergeben');
        } else toast.error('Fehler beim Anlegen');
      }
      setShowNewCustomer(false);
      setEditingCustomer(false);
      setNewCust({ name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' });
    } catch { toast.error('Fehler'); } finally { setSavingCust(false); }
  };

  // Core save function — returns saved order or null
  const saveOrder = async (): Promise<Order | null> => {
    if (!form.customerId) { toast.error('Bitte Kunde auswählen'); return null; }
    const validItems = formItems.filter(i => i.serviceName.trim());
    if (validItems.length === 0) { toast.error('Mindestens eine Leistung auswählen'); return null; }
    const desc = form.description?.trim() || buildDescription();
    if (!desc) { toast.error('Beschreibung erforderlich'); return null; }

    const url = editId ? `/api/orders/${editId}` : '/api/orders';
    const method = editId ? 'PUT' : 'POST';
    const payload = {
      ...form,
      description: desc,
      vatRate: orderVatRate,
      items: validItems.map(item => ({
        serviceName: item.serviceName,
        description: item.serviceName,
        quantity: Number(item.quantity || 1),
        unit: item.unit,
        unitPrice: Number(item.unitPrice || 0),
      })),
    };
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) {
      const saved = await res.json();
      return saved;
    }
    toast.error('Fehler beim Speichern');
    return null;
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveOrder();
      if (saved) {
        toast.success(editId ? 'Auftrag aktualisiert' : 'Auftrag erstellt');
        setDialogOpen(false);
        load();
      }
    } catch { toast.error('Fehler'); } finally { setSaving(false); }
  };

  // Save + Create Offer → navigate to /angebote with edit modal open
  const saveAndCreateOffer = async () => {
    setSaving(true);
    try {
      const saved = await saveOrder();
      if (!saved) return;
      toast.success('Auftrag gespeichert');

      // Build items for offer
      const orderItems = (saved.items && saved.items.length > 0) ? saved.items : [{
        serviceName: saved.serviceName ?? '', description: saved.serviceName ?? saved.description ?? '',
        quantity: saved.quantity ?? 1, unit: saved.priceType ?? 'Stunde', unitPrice: saved.unitPrice ?? 0,
      }];
      const offerItems = orderItems.map((i: any) => ({
        description: i.serviceName || i.description || '', quantity: String(i.quantity ?? 1),
        unit: i.unit ?? 'Stunde', unitPrice: String(i.unitPrice ?? 0),
      }));

      // Create offer via API — forward VAT from saved order
      const fwdVatRate = saved.vatRate != null ? Number(saved.vatRate) : orderVatRate;
      const offerRes = await fetch('/api/offers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: saved.customerId, items: offerItems, orderIds: [saved.id], vatRate: fwdVatRate }),
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
        setOrders(prev => prev.map(o => o.id === saved.id ? { ...o, offerId: offer.id } : o));
        window.location.href = '/angebote';
      } else {
        toast.error('Angebot konnte nicht erstellt werden');
      }
    } catch { toast.error('Fehler'); } finally { setSaving(false); }
  };

  // Save + Create Invoice → navigate to /rechnungen with edit modal open
  const saveAndCreateInvoice = async () => {
    setSaving(true);
    try {
      const saved = await saveOrder();
      if (!saved) return;
      toast.success('Auftrag gespeichert');

      const orderItems = (saved.items && saved.items.length > 0) ? saved.items : [{
        serviceName: saved.serviceName ?? '', description: saved.serviceName ?? saved.description ?? '',
        quantity: saved.quantity ?? 1, unit: saved.priceType ?? 'Stunde', unitPrice: saved.unitPrice ?? 0,
      }];
      const invoiceItems = orderItems.map((i: any) => ({
        description: i.serviceName || i.description || '', quantity: String(i.quantity ?? 1),
        unit: i.unit ?? 'Stunde', unitPrice: String(i.unitPrice ?? 0),
      }));

      // Forward VAT from saved order
      const fwdVatRate = saved.vatRate != null ? Number(saved.vatRate) : orderVatRate;
      const invRes = await fetch('/api/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: saved.customerId, items: invoiceItems, orderIds: [saved.id], vatRate: fwdVatRate }),
      });
      if (invRes.ok) {
        const invoice = await invRes.json();
        toast.success(`Rechnung ${invoice.invoiceNumber} erstellt`);
        setDialogOpen(false);
        // Paket L: optimistic update — see saveAndCreateOffer above.
        setOrders(prev => prev.map(o => o.id === saved.id ? { ...o, invoiceId: invoice.id } : o));
        window.location.href = '/rechnungen';
      } else {
        toast.error('Rechnung konnte nicht erstellt werden');
      }
    } catch { toast.error('Fehler'); } finally { setSaving(false); }
  };

  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const updateOrderStatus = async (e: React.ChangeEvent<HTMLSelectElement>, id: string, status: string) => {
    e.stopPropagation();
    await fetch(`/api/orders/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    toast.success('Status aktualisiert');
    load();
  };

  const remove = async (id: string) => {
    setArchiveId(id);
  };
  const confirmArchive = async () => {
    if (!archiveId) return;
    await fetch(`/api/orders/${archiveId}`, { method: 'DELETE' });
    toast.success('Auftrag in Papierkorb verschoben');
    setArchiveId(null);
    load();
  };

  const resolveS3Url = async (path: string): Promise<string> => {
    try {
      const res = await fetch('/api/upload/media-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloud_storage_path: path, isPublic: false }),
      });
      const data = await res.json();
      return data.url || path;
    } catch { return path; }
  };

  const openMedia = async (o: Order) => {
    if (!o.mediaUrl) return;
    if (o.mediaType === 'audio') {
      const url = await resolveS3Url(o.mediaUrl);
      setMediaUrl(url); setMediaType('audio'); setGalleryUrls([]); setMediaDialogOpen(true);
      return;
    }
    // Image(s) — resolve all imageUrls if available
    const paths = (o.imageUrls && o.imageUrls.length > 0) ? o.imageUrls : [o.mediaUrl];
    const resolved = await Promise.all(paths.map(p => resolveS3Url(p)));
    setGalleryUrls(resolved); setGalleryIdx(0); setMediaType('image'); setMediaUrl(null); setMediaDialogOpen(true);
  };

  const createOffer = async (o: Order) => {
    // Direct API create — no extra dialog
    const orderItems = (o.items && o.items.length > 0) ? o.items : [{
      serviceName: o.serviceName ?? '', description: o.serviceName ?? o.description ?? '',
      quantity: o.quantity ?? 1, unit: o.priceType ?? 'Stunde', unitPrice: o.unitPrice ?? 0,
    }];
    const offerItems = orderItems.map((i: any) => ({
      description: i.serviceName || i.description || '', quantity: String(i.quantity ?? 1),
      unit: i.unit ?? 'Stunde', unitPrice: String(i.unitPrice ?? 0),
    }));
    // Forward the Auftrag's saved VAT rate (falls back to default if legacy order has none)
    const fwdVatRate = o.vatRate != null ? Number(o.vatRate) : defaultVatRate;
    try {
      const res = await fetch('/api/offers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: o.customerId, items: offerItems, orderIds: [o.id], vatRate: fwdVatRate }),
      });
      if (res.ok) {
        const offer = await res.json();
        toast.success(`Angebot ${offer.offerNumber} erstellt`);
        // Paket L: optimistic update — mark the source order as linked so it
        // disappears from the active Orders list immediately.
        setOrders(prev => prev.map(x => x.id === o.id ? { ...x, offerId: offer.id } : x));
        window.location.href = '/angebote';
      } else {
        toast.error('Angebot konnte nicht erstellt werden');
      }
    } catch { toast.error('Fehler beim Erstellen des Angebots'); }
  };

  const createInvoice = async (o: Order) => {
    // Direct API create — no extra dialog
    const orderItems = (o.items && o.items.length > 0) ? o.items : [{
      serviceName: o.serviceName ?? '', description: o.serviceName ?? o.description ?? '',
      quantity: o.quantity ?? 1, unit: o.priceType ?? 'Stunde', unitPrice: o.unitPrice ?? 0,
    }];
    const invoiceItems = orderItems.map((i: any) => ({
      description: i.serviceName || i.description || '', quantity: String(i.quantity ?? 1),
      unit: i.unit ?? 'Stunde', unitPrice: String(i.unitPrice ?? 0),
    }));
    // Forward the Auftrag's saved VAT rate (falls back to default if legacy order has none)
    const fwdVatRate = o.vatRate != null ? Number(o.vatRate) : defaultVatRate;
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: o.customerId, items: invoiceItems, orderIds: [o.id], vatRate: fwdVatRate }),
      });
      if (res.ok) {
        const invoice = await res.json();
        toast.success(`Rechnung ${invoice.invoiceNumber} erstellt`);
        // Paket L: optimistic update — mark the source order as linked so it
        // disappears from the active Orders list immediately.
        setOrders(prev => prev.map(x => x.id === o.id ? { ...x, invoiceId: invoice.id } : x));
        window.location.href = '/rechnungen';
      } else {
        toast.error('Rechnung konnte nicht erstellt werden');
      }
    } catch { toast.error('Fehler beim Erstellen der Rechnung'); }
  };

  // Display items summary for list
  const itemsSummary = (o: Order) => {
    if (o.items && o.items.length > 1) {
      return o.items.map(i => i.serviceName).join(', ');
    }
    return o.serviceName ?? '';
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (loadError) return <LoadErrorFallback details={loadError} onRetry={load} />;

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><ClipboardList className="w-7 h-7 text-primary" /> Aufträge</h1>
          <p className="text-muted-foreground mt-1">{unlinked?.length ?? 0} Aufträge</p>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Neuer Auftrag</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Name, Ort, Leistung, Kunden-Nr…" className="pl-10 h-9 text-sm" value={search} onChange={(e: any) => setSearch(e?.target?.value ?? '')} />
        </div>
        <select className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9" value={statusFilter} onChange={(e: any) => setStatusFilter(e?.target?.value ?? 'Alle')}>
          {statuses.map(s => <option key={s} value={s}>{s === 'Alle' ? 'Status: Alle' : s}</option>)}
        </select>
        <select className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9" value={sortBy} onChange={(e: any) => setSortBy(e?.target?.value ?? 'newest')}>
          <option value="newest">Neueste zuerst</option>
          <option value="oldest">Älteste zuerst</option>
          <option value="name">Name A–Z</option>
          <option value="amount">Betrag ↓</option>
          <option value="review">Prüfung zuerst</option>
        </select>
      </div>

      <div className="space-y-1.5">
        {filtered?.length === 0 ? <p className="text-center text-muted-foreground py-8">Keine Aufträge gefunden</p> :
          filtered.slice(0, visibleCount).map((o: Order, i: number) => {
            const isSonstiges = (o.serviceName ?? '').toLowerCase() === 'sonstiges' || (o.items && o.items.some(it => (it.serviceName ?? '').toLowerCase() === 'sonstiges'));
            const serviceLine = o.items && o.items.length > 1 ? o.items.map(it => it.serviceName).join(' + ') : (o.serviceName ?? o.description ?? '');
            const descPreview = o.description && o.description !== serviceLine ? o.description : '';
            return (
            <motion.div key={o.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.015 }}>
              <Card className="hover:shadow-sm transition-shadow cursor-pointer tap-safe" onClick={() => openEdit(o)}>
                <CardContent className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    {/* Left: 3-dot menu */}
                    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDropdownOpenId(dropdownOpenId === o.id ? null : o.id); }}
                        className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                        title="Aktionen"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                      {dropdownOpenId === o.id && (
                        <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-900 border rounded-lg shadow-lg py-1 min-w-[180px]">
                          <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(null); openEdit(o); }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"><ClipboardList className="w-3.5 h-3.5 text-primary" />Bearbeiten</button>
                          <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(null); createOffer(o); }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"><FileCheck className="w-3.5 h-3.5 text-orange-600" />Zu Angebot</button>
                          <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(null); createInvoice(o); }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"><FileText className="w-3.5 h-3.5 text-blue-600" />Zu Rechnung</button>
                          <div className="border-t my-0.5" />
                          <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(null); remove(o.id); }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2"><Trash2 className="w-3.5 h-3.5" />Papierkorb</button>
                        </div>
                      )}
                    </div>

                    {/* Center: Main info */}
                    <div className="flex-1 min-w-0">
                      {/* Row 1: date + customer */}
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground shrink-0">{o.createdAt ? new Date(o.createdAt).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' }) + ' ' + new Date(o.createdAt).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className={`font-medium truncate ${isFallbackCustomerName(o.customer?.name) ? 'text-amber-600 dark:text-amber-400 italic' : 'text-foreground'}`}>{isFallbackCustomerName(o.customer?.name) ? 'Kunde nicht zugeordnet' : (o.customer?.name || '–')}</span>
                        {!isFallbackCustomerName(o.customer?.name) && o.customer?.customerNumber && <span className="text-muted-foreground shrink-0">({o.customer.customerNumber})</span>}
                        {o.needsReview && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openEdit(o, { openCustomerSection: true }); }}
                            className="tap-safe inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 min-h-[24px] rounded-full font-medium bg-orange-200 text-orange-800 border border-orange-300 shrink-0 cursor-pointer hover:bg-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 transition-colors"
                            aria-label="Kundendaten prüfen — Kunde direkt bearbeiten"
                            title="Kundendaten prüfen — Kunde direkt bearbeiten"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            <span className="sm:hidden">Prüfen</span>
                            <span className="hidden sm:inline">Kundendaten unvollständig</span>
                          </button>
                        )}
                        {!o.needsReview && isCustomerDataIncomplete(o.customer) && (
                          <MissingCustomerDataBadge
                            variant="compact"
                            onClick={() => openEdit(o, { openCustomerSection: true })}
                          />
                        )}
                        {/* Issue 3 — Audio >60s badge: immediately visible in list */}
                        {o.audioTranscriptionStatus?.startsWith('skipped') && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300 shrink-0">
                            ⚠️ Audio zu lang – manuell prüfen
                          </span>
                        )}
                      </div>
                      {/* Row 2: title + description preview */}
                      <p className={`text-sm font-medium mt-0.5 line-clamp-2 ${isSonstiges ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                        {isSonstiges && '⚠ '}{serviceLine}{descPreview ? ` — ${descPreview}` : ''}
                      </p>
                      {/* Row 3: [status] [media] [hints] ... [price] */}
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <select onClick={(e) => e.stopPropagation()} className="text-[11px] border rounded px-1.5 py-0.5 font-medium" style={getStatusStyle(ORDER_STATUS_STYLES, o?.status ?? '')} value={o?.status ?? ''} onChange={(e: any) => updateOrderStatus(e, o?.id, e?.target?.value ?? '')}>
                          {orderStatuses.map(s => <option key={s} style={getStatusStyle(ORDER_STATUS_STYLES, s)}>{s}</option>)}
                        </select>
                        <CommunicationChips data={o} onAudioClick={() => openMedia(o)} onImageClick={() => openMedia(o)} />
                        <span className="font-mono font-bold text-sm whitespace-nowrap shrink-0 ml-auto tabular-nums">CHF {Number((o as any).total || o.totalPrice || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            );
          })}
        {filtered.length > visibleCount && (
          <div className="text-center pt-4">
            <Button variant="outline" onClick={() => setVisibleCount(v => v + 30)}>Mehr laden ({filtered.length - visibleCount} weitere)</Button>
          </div>
        )}
      </div>

      {/* Mobile-only navigation shortcut → Angebote.
          NOT a conversion. NOT a "new offer" action. Pure navigation.
          Hidden on md+ (desktop has the sidebar). */}
      <MobileListShortcut href="/angebote" label="Angebote" ariaLabel="Zu Angebote" />

      {/* Order Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={`${dupCheckOpen ? 'max-w-4xl w-[95vw]' : 'max-w-2xl'} max-h-[90vh] overflow-y-auto overflow-x-hidden transition-all`}>
          <DialogHeader><DialogTitle>{editId ? 'Auftrag bearbeiten' : 'Neuer Auftrag'}</DialogTitle></DialogHeader>
          <div className={dupCheckOpen ? 'grid grid-cols-1 sm:grid-cols-2 gap-4 dupcheck-split min-w-0' : 'min-w-0 overflow-hidden'}>
          <div className={`space-y-4 min-w-0${dupCheckOpen ? ' max-h-[35vh] sm:max-h-none overflow-y-auto dupcheck-form-col' : ''}`}>
            {/* Phase 2d: auto-reuse banner (exact / near-exact) */}
            {editId && (() => {
              const cur = orders.find((o: Order) => o.id === editId);
              if (!cur) return null;
              const cust = customers.find((c: Customer) => c.id === cur.customerId);
              const snapshot = cust
                ? { address: cust.address ?? null, plz: cust.plz ?? null, city: cust.city ?? null }
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
                    setForm((f: any) => ({ ...f, customerId: result.newCustomerId }));
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
            {editId && (() => {
              const cur = orders.find((o: Order) => o.id === editId);
              const cust = cur ? customers.find((c: Customer) => c.id === cur.customerId) : null;
              // Canonical rule — name/address/plz/city required; phone/email optional.
              const missingData = !!cust && isCustomerDataIncomplete(cust);
              if (!cur?.needsReview && !missingData) return null;
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => openCustomerEditor()}
                    className="tap-safe inline-flex items-center gap-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-md"
                    aria-label="Kundendaten ergänzen — öffnet den Kunde-bearbeiten-Bereich"
                  >
                    {cur?.needsReview && <Badge variant="secondary" className="text-[11px] px-2 py-0.5 bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200 border border-orange-300">
                      <AlertTriangle className="w-3 h-3 mr-1" />Kundendaten prüfen
                    </Badge>}
                    {!cur?.needsReview && missingData && <MissingCustomerDataBadge variant="standard" />}
                  </button>
                </div>
              );
            })()}
            {/* Customer Info / Select / Edit */}
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-y-0.5 mb-1">
                <Label>Kunde *</Label>
                {!showNewCustomer && form.customerId && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                    <button type="button" className="text-xs text-blue-600 hover:underline flex items-center gap-1 whitespace-nowrap" onClick={() => openCustomerEditor()}>✏️ Bearbeiten</button>
                    <button type="button" className="text-xs text-amber-600 hover:underline flex items-center gap-1 whitespace-nowrap" onClick={() => setDupCheckOpen(true)}>🔍 Duplikate prüfen</button>
                  </div>
                )}
              </div>
              {!showNewCustomer ? (
                <>
                  {/* If editing and customer assigned → show static info, no dropdown */}
                  {editId && form.customerId ? (() => {
                    const cust = customers.find((c: Customer) => c.id === form.customerId);
                    if (!cust) return null;
                    // Required fields: name/address/plz/city — painted red when missing.
                    // Optional fields: phone/email — always neutral (black), never red.
                    const reqMiss = isRequiredCustomerFieldMissing;
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
                          if (e.key === 'Enter' || e.key === ' ') {
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
                            <span className="text-sm font-semibold truncate text-amber-600 dark:text-amber-400">⚠️ Kunde noch nicht zugeordnet</span>
                            <span className="text-[10px] text-muted-foreground">(bitte echten Kunden zuweisen)</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                            <span className="text-sm font-semibold truncate">👤 {cust.customerNumber || ''}{cust.customerNumber ? ' · ' : ''}</span>
                            <span className={`text-sm font-semibold truncate ${reqMiss(cust.name) ? 'text-red-500 border-b border-red-400 border-dashed pb-0.5 italic' : ''}`}>{cust.name || 'Name fehlt'}</span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-1 text-xs min-w-0">
                          <div className={`flex items-center gap-1 min-w-0 ${reqMiss(cust.address) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium w-12 sm:w-16 shrink-0">Strasse:</span><span className={`truncate ${reqMiss(cust.address) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}`}>{cust.address || 'fehlt'}</span></div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            <div className={`flex items-center gap-1 ${reqMiss(cust.plz) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium w-12 sm:w-16 shrink-0">PLZ:</span><span className={reqMiss(cust.plz) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}>{cust.plz || 'fehlt'}</span></div>
                            <div className={`flex items-center gap-1 ${reqMiss(cust.city) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium shrink-0">Ort:</span><span className={reqMiss(cust.city) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}>{cust.city || 'fehlt'}</span></div>
                          </div>
                          <div className="flex items-center gap-1 text-foreground/70"><span className="font-medium w-12 sm:w-16 shrink-0">Tel:</span><span className="truncate">{cust.phone || '—'}</span></div>
                          <div className="flex items-center gap-1 text-foreground/70"><span className="font-medium w-12 sm:w-16 shrink-0">E-Mail:</span><span className="truncate">{cust.email || '—'}</span></div>
                        </div>
                      </div>
                      {/* PLZ/Ort suggestions are now shown exclusively inside the duplicate panel (§3 UX cleanup) */}
                      </>
                    );
                  })() : (
                    /* New order or no customer yet → show dropdown to assign */
                    <>
                      <div className="flex gap-2 min-w-0">
                        <CustomerSearchCombobox
                          customers={customers}
                          value={form.customerId}
                          onChange={(id) => setForm({ ...form, customerId: id })}
                        />
                        <Button type="button" variant="outline" size="sm" className="shrink-0 text-xs h-[38px]" onClick={() => { setEditingCustomer(false); setNewCust({ name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' }); setShowNewCustomer(true); }}>+ Neuer Kunde</Button>
                      </div>
                      {form.customerId && (() => {
                        const cust = customers.find((c: Customer) => c.id === form.customerId);
                        if (!cust) return null;
                        const reqMiss = isRequiredCustomerFieldMissing;
                        return (
                          <div className="mt-2 border rounded-lg p-2 sm:p-3 bg-muted/30 space-y-1.5 min-w-0">
                            {/* ISSUE 4 — Neutral display for fallback customers */}
                            {isFallbackCustomerName(cust.name) ? (
                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <span className="text-sm font-semibold truncate text-amber-600 dark:text-amber-400">⚠️ Kunde noch nicht zugeordnet</span>
                                <span className="text-[10px] text-muted-foreground">(bitte echten Kunden zuweisen)</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                <span className="text-sm font-semibold truncate">👤 {cust.customerNumber || ''}{cust.customerNumber ? ' · ' : ''}</span>
                                <span className={`text-sm font-semibold truncate ${reqMiss(cust.name) ? 'text-red-500 border-b border-red-400 border-dashed pb-0.5 italic' : ''}`}>{cust.name || 'Name fehlt'}</span>
                              </div>
                            )}
                            <div className="grid grid-cols-1 gap-1 text-xs min-w-0">
                              <div className={`flex items-center gap-1 min-w-0 ${reqMiss(cust.address) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium w-12 sm:w-16 shrink-0">Strasse:</span><span className={`truncate ${reqMiss(cust.address) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}`}>{cust.address || 'fehlt'}</span></div>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                <div className={`flex items-center gap-1 ${reqMiss(cust.plz) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium w-12 sm:w-16 shrink-0">PLZ:</span><span className={reqMiss(cust.plz) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}>{cust.plz || 'fehlt'}</span></div>
                                <div className={`flex items-center gap-1 ${reqMiss(cust.city) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium shrink-0">Ort:</span><span className={reqMiss(cust.city) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}>{cust.city || 'fehlt'}</span></div>
                              </div>
                              <div className="flex items-center gap-1 text-foreground/70"><span className="font-medium w-12 sm:w-16 shrink-0">Tel:</span><span className="truncate">{cust.phone || '—'}</span></div>
                              <div className="flex items-center gap-1 text-foreground/70"><span className="font-medium w-12 sm:w-16 shrink-0">E-Mail:</span><span className="truncate">{cust.email || '—'}</span></div>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </>
              ) : (
                <div ref={customerEditorRef} className="border rounded-lg p-3 space-y-2 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                  <p className="text-xs font-semibold text-muted-foreground">{editingCustomer ? '✏️ Kunde bearbeiten' : '➕ Neuer Kunde erstellen'}</p>
                  {/* Phase 2d (Stage 3): read-only hint line shown after Undo. Lives inside the customer-editor (only when editing) so the Rückgängig context stays close to the address fields. */}
                  {editingCustomer && editId && undoPreviousAddress && (undoPreviousAddress.address || undoPreviousAddress.plz || undoPreviousAddress.city) && (() => {
                    const parts = [
                      undoPreviousAddress.address,
                      [undoPreviousAddress.plz, undoPreviousAddress.city].filter(Boolean).join(' '),
                    ].filter(Boolean).join(', ');
                    return (
                      <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 flex items-start justify-between gap-2">
                        <span>
                          Vorherige Adresse (nur Hinweis, nicht übernommen): <span className="font-medium">{parts}</span>
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
                    <div><Label className="text-xs">Name *</Label><Input placeholder="Name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /></div>
                    <div><Label className="text-xs">Telefon</Label><Input placeholder="Telefon" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></div>
                  </div>
                  <div><Label className="text-xs">Strasse + Hausnr. *</Label><Input placeholder="Strasse + Hausnr." value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} /></div>
                  {/* Paket N + O: shared Land/PLZ/Ort input with country-aware autocomplete. */}
                  <PlzOrtInput
                    country={newCust.country}
                    onCountryChange={(country) => setNewCust({ ...newCust, country })}
                    plzValue={newCust.plz}
                    ortValue={newCust.city}
                    onPlzChange={(plz) => setNewCust({ ...newCust, plz })}
                    onOrtChange={(city) => setNewCust({ ...newCust, city })}
                    onBothChange={(plz, city) => setNewCust({ ...newCust, plz, city })}
                    required
                    compact
                  />
                  <div><Label className="text-xs">E-Mail</Label><Input placeholder="E-Mail" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} /></div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveCustomer} disabled={savingCust}>{savingCust ? 'Speichern...' : editingCustomer ? 'Kunde aktualisieren' : 'Kunde erstellen'}</Button>
                    <Button size="sm" variant="outline" onClick={() => setDupCheckOpen(true)}>🔍 Duplikate prüfen</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowNewCustomer(false); setEditingCustomer(false); }}>Zurück zum Auftrag</Button>
                  </div>
                </div>
              )}
            </div>

            {/* Service Items + rest of form — collapsed when dupCheck open */}
            {dupCheckOpen ? (
              <div className="p-2 bg-muted/40 rounded border border-dashed text-xs text-muted-foreground flex items-center justify-between">
                <span>{formItems.filter(i => i.serviceName).length} Leistung(en) · CHF {itemsTotal.toFixed(2)} · {form.date || '–'} · {form.status}</span>
                <span className="text-[10px] italic">Duplikat-Prüfung aktiv — Form eingeklappt</span>
              </div>
            ) : (<>
            <div>
              <Label className="mb-2 block">Leistungen *</Label>
              <div className="space-y-3">
                {formItems.map((item, index) => (
                  <div key={item.key} className="border rounded-lg p-2 sm:p-3 bg-accent/10 space-y-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <ServiceCombobox
                        value={item.serviceName}
                        services={services as ServiceOption[]}
                        onChange={(name, svc) => onItemServiceSelect(index, name, svc)}
                        onServiceCreated={handleServiceCreated}
                        currentPrice={item.unitPrice}
                        currentUnit={item.unit}
                      />
                      {formItems.length > 1 && (
                        <button onClick={() => removeItem(index)} className="text-destructive hover:text-destructive/80 p-1 shrink-0" title="Leistung entfernen">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs">Einheit</Label>
                        <select className="flex w-full rounded-md border border-input bg-background px-2 py-1.5" value={item.unit} onChange={(e: any) => updateItem(index, 'unit', e?.target?.value ?? 'Stunde')}>
                          {priceTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs">Preis (CHF)</Label>
                        <Input type="number" step="0.05" className="h-8" value={item.unitPrice} onChange={(e: any) => updateItem(index, 'unitPrice', e?.target?.value ?? '0')} />
                      </div>
                      <div>
                        <Label className="text-xs">Menge</Label>
                        <Input type="number" step="0.25" className="h-8" value={item.quantity} onChange={(e: any) => updateItem(index, 'quantity', e?.target?.value ?? '1')} />
                      </div>
                    </div>
                    <div className="text-left sm:text-right text-xs text-muted-foreground">
                      = CHF {(Number(item.unitPrice || 0) * Number(item.quantity || 0)).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={addItem}>
                <Plus className="w-3.5 h-3.5 mr-1" />Weitere Leistung hinzufügen
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>Datum</Label><Input type="date" value={form.date} onChange={(e: any) => setForm({ ...form, date: e?.target?.value ?? '' })} /></div>
              <div>
                <Label>Status</Label>
                <select className="flex w-full rounded-md border border-input px-3 py-2 text-sm" style={getStatusStyle(ORDER_STATUS_STYLES, form.status)} value={form.status} onChange={(e: any) => setForm({ ...form, status: e?.target?.value ?? 'Offen' })}>
                  {orderStatuses.map(s => <option key={s} style={getStatusStyle(ORDER_STATUS_STYLES, s)}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* MwSt block — mirrors the UI used in Angebot/Rechnung bearbeiten.
                Order itself persists only the net total in `totalPrice`. VAT is
                a display-only preview here so the user sees the same breakdown
                they would see after converting the order to an offer/invoice.
                `orderVatRate` is local-only state and is NOT sent to the API. */}
            <div className="p-1.5 sm:p-4 bg-muted rounded-lg space-y-3 min-w-0">
              <MwStControl vatRate={orderVatRate} onChange={setOrderVatRate} />
              <div className="space-y-1 border-t pt-2 min-w-0 text-xs sm:text-sm">
                <div className="flex justify-between min-w-0"><span className="shrink-0">Netto</span><span className="font-mono">CHF {itemsTotal.toFixed(2)}</span></div>
                {orderVatRate > 0 && (
                  <div className="flex justify-between min-w-0"><span className="shrink-0">MwSt. {orderVatRate}%</span><span className="font-mono">CHF {(itemsTotal * orderVatRate / 100).toFixed(2)}</span></div>
                )}
                <div className="flex justify-between font-bold border-t pt-2 min-w-0 text-sm sm:text-base"><span className="shrink-0">Total</span><span className="font-mono text-primary">CHF {(itemsTotal + itemsTotal * orderVatRate / 100).toFixed(2)}</span></div>
              </div>
            </div>

            {/* Unified communication block: chips + description + special notes + customer message/media */}
            <CommunicationBlock
              data={editId ? (orders.find((o: Order) => o.id === editId) || {}) : {}}
              showDescription
              descriptionValue={form.description}
              onDescriptionChange={(val) => setForm({ ...form, description: val })}
              specialNotesValue={form.specialNotes}
              onSpecialNotesChange={(val) => setForm({ ...form, specialNotes: val })}
            />
            </>)}

            {/* Order action buttons — hidden when customer editor OR duplicate panel is open */}
            {!showNewCustomer && !dupCheckOpen && (
            <div className="flex flex-wrap justify-center sm:justify-end gap-2 mb-20 md:mb-0">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Speichern...' : 'Auftrag speichern'}</Button>
              <Button variant="secondary" onClick={saveAndCreateOffer} disabled={saving} className="bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 text-xs sm:text-sm">
                <FileCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />→ Angebot
              </Button>
              <Button variant="secondary" onClick={saveAndCreateInvoice} disabled={saving} className="bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 text-xs sm:text-sm">
                <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />→ Rechnung
              </Button>
            </div>
            )}
          </div>
          {/* Duplicate Check Panel (right column) */}
          {dupCheckOpen && form.customerId && (() => {
            const cust = customers.find((c: Customer) => c.id === form.customerId);
            if (!cust) return null;
            return (
              <DuplicateCheckPanel
                customer={{ id: cust.id, customerNumber: cust.customerNumber, name: cust.name, address: cust.address, plz: cust.plz, city: cust.city, phone: cust.phone, email: cust.email, country: cust.country }}
                onClose={() => setDupCheckOpen(false)}
                activeFormName={newCust.name}
                activeFormAddress={newCust.address}
                activeFormCity={newCust.city}
                activeFormPlz={newCust.plz}
                onApplyPlzSuggestion={(plz) => setNewCust((p: any) => ({ ...p, plz: plz ?? '' }))}
                onTakeoverCustomer={async (match: DuplicateMatch) => {
                  // "Diesen Kunden übernehmen" — full customer replacement:
                  // 1. Persist customerId change on the order via API
                  // 2. Update local form + customer display
                  // 3. Cleanup: soft-delete old customer if it has no more active docs
                  // 4. Show toast + close panel
                  if (!editId) return;
                  const oldCustomerId = form.customerId; // capture before overwrite
                  const res = await fetch(`/api/orders/${editId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customerId: match.id }),
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    toast.error(err?.error || 'Fehler beim Kunden-Wechsel');
                    return;
                  }
                  // Update local form state
                  setForm((f: any) => ({ ...f, customerId: match.id }));
                  // Update newCust with the selected customer's full data
                  setNewCust({
                    name: (match.name ?? '') as string,
                    address: (match.address ?? '') as string,
                    plz: (match.plz ?? '') as string,
                    city: (match.city ?? '') as string,
                    phone: (match.phone ?? '') as string,
                    email: (match.email ?? '') as string,
                    country: 'CH',
                  });
                  // Ensure selected customer exists in local customers list
                  setCustomers((prev: Customer[]) => {
                    const exists = prev.some((c) => c.id === match.id);
                    if (exists) return prev;
                    return [...prev, {
                      id: match.id,
                      name: match.name,
                      customerNumber: match.customerNumber ?? null,
                      address: match.address ?? null,
                      plz: match.plz ?? null,
                      city: match.city ?? null,
                      phone: match.phone ?? null,
                      email: match.email ?? null,
                    } as Customer];
                  });
                  // Update nested customer in orders list
                  setOrders((prev: Order[]) => prev.map((o) =>
                    o.id === editId ? { ...o, customerId: match.id, customer: { name: match.name, customerNumber: match.customerNumber, address: match.address, plz: match.plz, city: match.city, phone: match.phone, email: match.email } } : o
                  ));
                  // Close customer editor + dup panel
                  setShowNewCustomer(false);
                  setEditingCustomer(false);
                  setDupCheckOpen(false);
                  toast.success(`Kunde übernommen: ${match.customerNumber ? match.customerNumber + ' · ' : ''}${match.name}`);
                  // Fire-and-forget: cleanup old customer if it has no remaining active docs
                  if (oldCustomerId && oldCustomerId !== match.id) {
                    fetch(`/api/customers/${oldCustomerId}/cleanup-after-takeover`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ keptCustomerId: match.id }),
                    }).then(r => r.json()).then(res => {
                      if (res?.cleaned) {
                        setCustomers((prev: Customer[]) => prev.filter((c) => c.id !== oldCustomerId));
                      }
                    }).catch(() => { /* silent — non-critical */ });
                  }
                }}
                onMergeComplete={async (r) => {
                  // After merge the backend may have kept the OTHER record
                  // (lower customerNumber wins). Rebind form.customerId to the
                  // surviving record BEFORE reloading the list so the edit
                  // dialog keeps showing a valid customer.
                  setForm((f: any) => ({ ...f, customerId: r.survivingCustomerId }));
                  // Stage F – Critical bug fix:
                  // The merge persists user-selected values to the surviving
                  // record. We MUST replace local `newCust` form state with
                  // those values, otherwise the visible "Kunde bearbeiten"
                  // form keeps showing stale pre-merge values and a
                  // subsequent "Kunde aktualisieren" wipes the merge.
                  if (r.mergedCustomer) {
                    const m = r.mergedCustomer;
                    setNewCust({
                      name:    (m.name    ?? '') as string,
                      phone:   (m.phone   ?? '') as string,
                      email:   (m.email   ?? '') as string,
                      address: (m.address ?? '') as string,
                      plz:     (m.plz     ?? '') as string,
                      city:    (m.city    ?? '') as string,
                      country: (m.country ?? 'CH') as string,
                    });
                    // Reflect in customers list so dbCust diff in saveCustomer
                    // matches the new state and fieldsToClear stays empty.
                    setCustomers(prev => {
                      const exists = prev.some((c: Customer) => c.id === m.id);
                      const merged = { ...m } as any;
                      if (exists) return prev.map((c: Customer) => c.id === m.id ? { ...c, ...merged } : c);
                      return [...prev, merged as Customer];
                    });
                    // Reflect in nested customer in orders list
                    setOrders(prev => prev.map((o: any) => o.customerId === m.id
                      ? { ...o, customer: { ...o.customer, ...m } }
                      : o));
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
      <Dialog open={mediaDialogOpen && mediaType === 'audio'} onOpenChange={setMediaDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Sprachnachricht</DialogTitle></DialogHeader>
          {mediaUrl && <audio controls className="w-full" src={mediaUrl}><track kind="captions" /></audio>}
        </DialogContent>
      </Dialog>
      {/* Image viewer with touch zoom/pan */}
      <TouchImageViewer
        open={mediaDialogOpen && mediaType === 'image'}
        onOpenChange={setMediaDialogOpen}
        urls={galleryUrls}
        initialIndex={galleryIdx}
      />

      {/* Archive confirmation dialog */}
      <Dialog open={!!archiveId} onOpenChange={(open) => { if (!open) setArchiveId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>In Papierkorb verschieben?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Der Auftrag wird in den Papierkorb verschoben und kann dort wiederhergestellt werden.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setArchiveId(null)}>Abbrechen</Button>
            <Button variant="destructive" size="sm" onClick={confirmArchive}>In Papierkorb</Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
