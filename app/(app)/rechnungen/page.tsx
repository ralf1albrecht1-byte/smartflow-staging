'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { FileText, Plus, Download, Trash2, Loader2, Volume2, ImageIcon, AlertTriangle, Search, MoreVertical, Archive, ChevronLeft, ChevronRight, Undo2, MessageCircle } from 'lucide-react';
import { sendPdfToBusinessWhatsApp } from '@/lib/whatsapp-share';
import { CommunicationBlock, CommunicationChips, resolveCommunicationData, stripForwardedMessage } from '@/components/communication-block';
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
import { TouchImageViewer } from '@/components/touch-image-viewer';
import { MwStControl } from '@/components/mwst-control';
import { splitSpecialNotes } from '@/lib/special-notes-utils';
import { fetchAllJSON } from '@/lib/fetch-utils';
import { LoadErrorFallback } from '@/components/load-error-fallback';
import { INVOICE_STATUS_STYLES, getStatusStyle } from '@/lib/status-colors';
import { useDialogBackGuard } from '@/lib/use-dialog-back-guard';
import { isCustomerDataIncomplete, isRequiredCustomerFieldMissing } from '@/lib/customer-links';
import { PlzOrtInput } from '@/components/plz-ort-input';
import { CustomerSearchCombobox } from '@/components/customer-search-combobox';
import { MissingCustomerDataBadge } from '@/components/missing-customer-data-badge';

interface InvoiceItem { description: string; quantity: string; unit: string; unitPrice: string; }
interface Invoice { id: string; invoiceNumber: string; customerId: string; customer?: any; items: any[]; orders?: { id: string; createdAt?: string | null; date?: string | null; mediaUrl?: string | null; mediaType?: string | null; imageUrls?: string[]; thumbnailUrls?: string[]; audioTranscript?: string | null; audioDurationSec?: number | null; audioTranscriptionStatus?: string | null; notes?: string | null; specialNotes?: string | null; needsReview?: boolean; hinweisLevel?: string; description?: string | null }[]; subtotal: number; vatRate: number; vatAmount: number; total: number; status: string; invoiceDate: string; createdAt?: string; dueDate: string | null; notes: string | null; sourceOfferId?: string | null; sourceOfferNumber?: string | null; }
interface Customer { id: string; name: string; customerNumber?: string | null; address?: string | null; plz?: string | null; city?: string | null; country?: string | null; phone?: string | null; email?: string | null; }

const statusColors: Record<string, string> = {
  'Entwurf': 'bg-gray-100 text-gray-800',
  'Gesendet': 'bg-blue-100 text-blue-800',
  'Überfällig': 'bg-red-100 text-red-800',
  'Bezahlt': 'bg-green-100 text-green-800',
};

// Invoice statuses shown in the dropdown.
// Order matters: Entwurf → Gesendet → Überfällig → Bezahlt reflects the
// real-world lifecycle.
const invoiceStatuses = ['Entwurf', 'Gesendet', 'Überfällig', 'Bezahlt'];

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
function getEffectiveInvoiceStatus(inv: { status?: string | null; dueDate?: string | null }): string {
  const raw = (inv?.status ?? '').trim();
  if (raw !== 'Gesendet') return raw || 'Entwurf';
  const due = inv?.dueDate ? new Date(inv.dueDate) : null;
  if (!due || isNaN(due.getTime())) return raw;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  return dueDay.getTime() < today.getTime() ? 'Überfällig' : raw;
}

export default function RechnungenPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState('Alle');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'amount'>('newest');
  const [visibleCount, setVisibleCount] = useState(30);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [form, setForm] = useState({ customerId: '', invoiceDate: new Date().toISOString().split('T')[0], paymentDays: '30', notes: '', orderIds: [] as string[] });
  const [items, setItems] = useState<InvoiceItem[]>([{ description: '', quantity: '1', unit: 'Stunde', unitPrice: '50' }]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [dropdownOpenId, setDropdownOpenId] = useState<string | null>(null);
  const [vatRate, setVatRate] = useState(8.1);
  const [defaultVatRate, setDefaultVatRate] = useState(8.1);
  // Stage M.2: Business WhatsApp intake number used as recipient for
  // "PDF an WhatsApp senden". NEVER use Customer.phone for this feature.
  const [businessWhatsappNumber, setBusinessWhatsappNumber] = useState<string | null>(null);
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('');
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [editOrderCtx, setEditOrderCtx] = useState<any>(null);
  const resolveS3Url = async (cloudPath: string) => {
    const res = await fetch('/api/upload/media-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cloud_storage_path: cloudPath, isPublic: false }) });
    const data = await res.json();
    return data.url as string;
  };
  const openMedia = async (cloudPath: string, type: string) => {
    try {
      setMediaType(type); setMediaDialogOpen(true);
      const url = await resolveS3Url(cloudPath);
      setMediaUrl(url);
    } catch { toast.error('Medien konnten nicht geladen werden'); }
  };
  const openImageGallery = async (cloudPaths: string[]) => {
    if (!cloudPaths.length) return;
    setGalleryUrls([]); setGalleryIdx(0); setMediaType('image'); setMediaDialogOpen(true);
    const urls = await Promise.all(cloudPaths.map(p => resolveS3Url(p)));
    setGalleryUrls(urls);
  };

  // Linked order data (for communication block)
  const [linkedOrderData, setLinkedOrderData] = useState<{ notes?: string | null; specialNotes?: string | null; needsReview?: boolean; mediaUrl?: string | null; mediaType?: string | null; imageUrls?: string[]; thumbnailUrls?: string[]; audioTranscript?: string | null; audioDurationSec?: number | null; audioTranscriptionStatus?: string | null; hinweisLevel?: string | null; description?: string | null } | null>(null);

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

  // Block D: open the "Kunde bearbeiten" sheet for the currently-selected customer.
  // Used both by the inline ✏️ button and by clicking the customer summary box.
  // Optional `customerIdOverride` lets callers (e.g. the list-card chip
  // shortcut) pass a customer id directly without first relying on the
  // form state being flushed (useful when called immediately after
  // `openEditInvoice()` because React state updates batch).
  // Optional `noteOverride` is the linked-order's notes used for merge.
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
      const noteSource = noteOverride !== undefined ? noteOverride : linkedOrderData?.notes;
      // Use blank form as merge base — prevents stale data from previously viewed records leaking in
      const blankForm = { name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' };
      const merged = mergeCustomerIntoForm(blankForm, freshCust as any, noteSource);
      setNewCust(merged);
    }
    setEditingCustomer(true); setShowNewCustomer(true);
  };

  // New/edit customer inline
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [newCust, setNewCust] = useState({ name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' });
  const [savingCust, setSavingCust] = useState(false);
  const [dupCheckOpen, setDupCheckOpen] = useState(false);

  // Stage E (deterministic chip flow): pending customerId waiting for the
  // dialog to mount before opening the customer-edit section. Set by the chip
  // shortcut in list cards via openEditInvoice({openCustomerSection:true}).
  const [pendingOpenCustomerEditor, setPendingOpenCustomerEditor] = useState<string | null>(null);
  const customerEditorRef = useRef<HTMLDivElement | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);

  // Android/browser back: close the edit dialog FIRST instead of jumping to the
  // previously visited module. Safe version — see lib/use-dialog-back-guard.ts.
  useDialogBackGuard(dialogOpen, () => { setDialogOpen(false); setEditingInvoice(null); });

  // Save customer (update or create — merge goes via Sheet)
  const saveCustomer = async () => {
    if (!newCust.name.trim()) { toast.error('Name erforderlich'); return; }
    setSavingCust(true);
    try {
      if (editingCustomer && form.customerId) {
        // Phase 2f: compute fieldsToClear = fields user intentionally emptied.
        const dbCust = customers.find((c: Customer) => c.id === form.customerId);
        const fieldsToClear: string[] = [];
        if (dbCust) {
          (['name', 'phone', 'email', 'address', 'plz', 'city'] as const).forEach((k) => {
            const was = (dbCust as any)[k];
            const now = (newCust as any)[k];
            if (was && String(was).trim() && !String(now || '').trim()) fieldsToClear.push(k);
          });
        }
        const res = await fetch(`/api/customers/${form.customerId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newCust, fieldsToClear }) });
        if (res.ok) {
          const updated = await res.json();
          setCustomers(prev => { const e = prev.some(c => c.id === updated.id); return e ? prev.map(c => c.id === updated.id ? { ...c, ...updated } : c) : [...prev, updated]; });
          // Also update nested customer in invoices so list/cards refresh immediately
          setInvoices(prev => prev.map(inv => inv.customerId === updated.id ? { ...inv, customer: { ...inv.customer, ...updated } } : inv));
          setForm(f => ({ ...f, customerId: updated.id }));
          toast.success(`Kunde "${updated.name}" aktualisiert!`);
        } else {
          const err = await res.json().catch(() => ({} as any));
          if (err?.reason === 'would_clear_existing_value') toast.error(err?.error || 'Feld kann nicht geleert werden.');
          else toast.error('Fehler beim Aktualisieren');
          return;
        }
      } else {
        const res = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCust) });
        if (res.ok) { const created = await res.json(); setCustomers(prev => [...prev, created]); setForm(f => ({ ...f, customerId: created.id })); toast.success('Neuer Kunde erstellt – eigene ID wurde vergeben'); }
        else toast.error('Fehler beim Anlegen');
      }
      setShowNewCustomer(false); setEditingCustomer(false);
      setNewCust({ name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' });
    } catch { toast.error('Fehler'); } finally { setSavingCust(false); }
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const { results: [inv, cust, ord, svc, settings], errors } = await fetchAllJSON<[any[], any[], any[], any[], any]>([
      { url: '/api/invoices', fallback: [] },
      { url: '/api/customers', fallback: [] },
      { url: '/api/orders?status=Erledigt', fallback: [] },
      { url: '/api/services', fallback: [] },
      { url: '/api/settings', fallback: null },
    ]);
    // If most critical endpoints failed, show error state
    if (errors.length >= 2) {
      setLoadError(errors);
      setLoading(false);
      return;
    }
    // Filter out "Erledigt" invoices (they go to archiv)
    setInvoices((inv ?? []).filter((i: Invoice) => i.status !== 'Erledigt'));
    // Merge customers from invoices/orders (they may be soft-deleted)
    const custMap = new Map<string, any>();
    (cust ?? []).forEach((c: any) => custMap.set(c.id, c));
    (inv ?? []).forEach((i: any) => { if (i.customer && !custMap.has(i.customer.id)) custMap.set(i.customer.id, i.customer); });
    (ord ?? []).forEach((o: any) => { if (o.customer && !custMap.has(o.customer.id)) custMap.set(o.customer.id, o.customer); });
    setCustomers(Array.from(custMap.values()) as any); setOrders(ord ?? []); setServices(svc ?? []);
    // Set default VAT rate from settings
    if (settings) {
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
      setBusinessWhatsappNumber(settings.whatsappIntakeNumber || settings.telefon || null);
      if (settings.whatsappEnabled === false) setWhatsappEnabled(false);
    }
    if (errors.length > 0) toast.error('Einige Daten konnten nicht vollständig geladen werden');
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // editId logic removed — flow buttons now redirect to list only

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpenId) return;
    const handler = () => setDropdownOpenId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [dropdownOpenId]);
  useEffect(() => {
    if (searchParams?.get('new') === '1') setDialogOpen(true);
    // Handle fromOffer: fetch offer's linked order data
    if (searchParams?.get('fromOffer') === '1') {
      const customerId = searchParams.get('customerId') ?? '';
      const offerId = searchParams.get('offerId') ?? '';
      setForm(f => ({ ...f, customerId }));
      const itemsJson = searchParams.get('items');
      if (itemsJson) {
        try {
          const parsed = JSON.parse(itemsJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setItems(parsed.map((item: any) => ({
              description: item.serviceName || item.description || '',
              quantity: String(item.quantity ?? 1),
              unit: item.unit ?? 'Stunde',
              unitPrice: String(item.unitPrice ?? 50),
            })));
          }
        } catch {}
      }
      if (offerId) {
        fetch(`/api/offers/${offerId}`).then(r => r.json()).then(offer => {
          const lo = offer?.orders?.[0];
          if (lo) setLinkedOrderData({ notes: lo.notes, specialNotes: lo.specialNotes, needsReview: lo.needsReview, mediaUrl: lo.mediaUrl, mediaType: lo.mediaType, imageUrls: lo.imageUrls, thumbnailUrls: lo.thumbnailUrls, audioTranscript: lo.audioTranscript, audioDurationSec: lo.audioDurationSec, audioTranscriptionStatus: lo.audioTranscriptionStatus, hinweisLevel: lo.hinweisLevel, description: lo.description });
          if (offer?.orders?.length) setEditOrderCtx(resolveCommunicationData(null, offer.orders));
        }).catch(() => {});
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
    const editId = searchParams?.get('edit');
    if (!editId || dialogOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invoices/${editId}`);
        if (cancelled) return;
        if (!res.ok) {
          toast.error(res.status === 404 ? 'Rechnung nicht gefunden' : 'Fehler beim Öffnen');
          router.replace('/rechnungen', { scroll: false });
          return;
        }
        const inv = await res.json();
        if (cancelled) return;
        openEditInvoice(inv);
        router.replace('/rechnungen', { scroll: false });
      } catch {
        if (!cancelled) {
          toast.error('Fehler beim Öffnen');
          router.replace('/rechnungen', { scroll: false });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openNewInvoice = () => {
    setEditingInvoice(null);
    setVatRate(defaultVatRate);
    setForm({ customerId: '', invoiceDate: new Date().toISOString().split('T')[0], paymentDays: '30', notes: '', orderIds: [] });
    setItems([{ description: '', quantity: '1', unit: 'Stunde', unitPrice: '50' }]);
    setLinkedOrderData(null);
    setEditOrderCtx(null);
    setShowNewCustomer(false); setEditingCustomer(false);
    setDialogOpen(true);
  };

  /**
   * Opens the invoice edit dialog. With `opts.openCustomerSection: true`
   * the customer-edit panel is auto-expanded with fresh customer data —
   * used by the list-card "Kundendaten unvollständig" chip so the user
   * lands directly inside the editor with one tap.
   */
  const openEditInvoice = (inv: Invoice, opts?: { openCustomerSection?: boolean }) => {
    setDropdownOpenId(null);
    setEditingInvoice(inv);
    setDupCheckOpen(false);
    // Reset customer form to prevent stale data leaking between records
    setNewCust({ name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' });
    setVatRate(inv.vatRate != null ? Number(inv.vatRate) : defaultVatRate);
    // Set linked order data for Original-Nachricht / Besonderheiten
    const lo = inv.orders?.[0];
    if (lo) setLinkedOrderData({ notes: lo.notes, specialNotes: lo.specialNotes, needsReview: lo.needsReview, mediaUrl: lo.mediaUrl, mediaType: lo.mediaType, imageUrls: lo.imageUrls, thumbnailUrls: lo.thumbnailUrls, audioTranscript: lo.audioTranscript, audioDurationSec: lo.audioDurationSec, audioTranscriptionStatus: lo.audioTranscriptionStatus, hinweisLevel: lo.hinweisLevel, description: lo.description });
    else setLinkedOrderData(null);
    setEditOrderCtx(inv.orders?.length ? resolveCommunicationData(null, inv.orders) : null);
    // Strip forwarded customer message from Bemerkungen (legacy data cleanup)
    const cleanNotes = stripForwardedMessage(inv.notes, lo?.notes);
    setForm({
      customerId: inv.customerId,
      invoiceDate: inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().split('T')[0] : '',
      paymentDays: '30',
      notes: cleanNotes,
      orderIds: [],
    });
    setItems(
      inv.items?.length > 0
        ? inv.items.map((it: any) => ({ description: it.description ?? '', quantity: String(it.quantity ?? 1), unit: it.unit ?? 'Stunde', unitPrice: String(it.unitPrice ?? 0) }))
        : [{ description: '', quantity: '1', unit: 'Stunde', unitPrice: '50' }]
    );
    if (opts?.openCustomerSection && inv.customerId) {
      // Stage E (deterministic flow): mark a pending request; the effect below
      // picks it up once dialog is open AND form.customerId === pendingId.
      // This avoids the React batching race where the async fetch in
      // openCustomerEditor could complete before the dialog had even mounted.
      setPendingOpenCustomerEditor(inv.customerId);
      // We intentionally DO NOT reset showNewCustomer / editingCustomer here.
    } else {
      setShowNewCustomer(false); setEditingCustomer(false);
      setPendingOpenCustomerEditor(null);
    }
    setDialogOpen(true);
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
          const noteSource = linkedOrderData?.notes ?? null;
          const merged = mergeCustomerIntoForm(
            { name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' },
            freshCust as any,
            noteSource,
          );
          setNewCust(merged);
        }
        setEditingCustomer(true);
        setShowNewCustomer(true);
        setPendingOpenCustomerEditor(null);
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

  useEffect(() => {
    if (!dialogOpen) setPendingOpenCustomerEditor(null);
  }, [dialogOpen]);

  const addItem = () => setItems([...items, { description: '', quantity: '1', unit: 'Stunde', unitPrice: '50' }]);
  const removeItem = (i: number) => setItems(items?.filter((_: any, idx: number) => idx !== i) ?? []);
  const updateItem = (i: number, field: string, value: string) => {
    const updated = [...(items ?? [])];
    if (updated[i]) (updated[i] as any)[field] = value;
    setItems(updated);
  };

  const onItemServiceSelect = (idx: number, name: string, svcOpt?: ServiceOption) => {
    const svc = svcOpt ?? services?.find((s: any) => s.name === name);
    if (svc) {
      updateItem(idx, 'description', svc.name);
      updateItem(idx, 'unitPrice', String(svc.defaultPrice ?? 0));
      updateItem(idx, 'unit', svc.unit ?? 'Stunde');
    } else if (!name) {
      updateItem(idx, 'description', '');
      updateItem(idx, 'unitPrice', '');
      updateItem(idx, 'quantity', '');
      updateItem(idx, 'unit', 'Stunde');
    } else {
      updateItem(idx, 'description', name);
    }
  };

  const handleServiceCreated = (newSvc: ServiceOption) => {
    setServices((prev: any[]) => [...prev, newSvc].sort((a, b) => (a?.name ?? '').localeCompare(b?.name ?? '', 'de', { sensitivity: 'base' })));
  };

  const subtotal = items?.reduce((sum: number, item: InvoiceItem) => sum + Number(item?.quantity ?? 0) * Number(item?.unitPrice ?? 0), 0) ?? 0;
  const vatAmount = subtotal * (vatRate / 100);
  const total = subtotal + vatAmount;

  const onCustomerChange = (customerId: string) => {
    setForm(f => ({ ...f, customerId }));
    if (!editingInvoice) {
      const customerOrders = orders?.filter((o: any) => o?.customerId === customerId && !o?.invoiceId) ?? [];
      if (customerOrders?.length > 0) {
        setItems(customerOrders.map((o: any) => ({ description: o?.description ?? '', quantity: String(o?.quantity ?? 1), unit: o?.priceType === 'Stundensatz' ? 'Stunde' : 'Pauschal', unitPrice: String(o?.unitPrice ?? 0) })));
        setForm(f => ({ ...f, orderIds: customerOrders.map((o: any) => o?.id) }));
      }
    }
  };

  const save = async () => {
    if (!form?.customerId) { toast.error('Bitte Kunde wählen'); return; }
    if (!items?.length || !items[0]?.description?.trim()) { toast.error('Mindestens eine Leistung'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, items, vatRate }) });
      if (res.ok) { toast.success('Rechnung erstellt'); setDialogOpen(false); load(); setItems([{ description: '', quantity: '1', unit: 'Stunde', unitPrice: '50' }]); setForm({ customerId: '', invoiceDate: new Date().toISOString().split('T')[0], paymentDays: '30', notes: '', orderIds: [] }); }
      else toast.error('Fehler');
    } catch { toast.error('Fehler'); } finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!editingInvoice) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${editingInvoice.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: editingInvoice.status, notes: form.notes, invoiceDate: form.invoiceDate, items, vatRate }),
      });
      if (res.ok) {
        toast.success('Rechnung aktualisiert');
        setDialogOpen(false);
        setEditingInvoice(null);
        load();
      }
      else toast.error('Fehler');
    } catch { toast.error('Fehler'); } finally { setSaving(false); }
  };

  // Save + Archive → set status Erledigt + back to list
  const saveAndArchive = async () => {
    if (!editingInvoice) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${editingInvoice.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Erledigt', notes: form.notes, invoiceDate: form.invoiceDate, items, vatRate }),
      });
      if (res.ok) {
        toast.success('Rechnung erledigt und archiviert');
        setDialogOpen(false);
        setEditingInvoice(null);
        load();
      }
      else toast.error('Fehler');
    } catch { toast.error('Fehler'); } finally { setSaving(false); }
  };

  const downloadPdf = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDownloading(id);
    try {
      const res = await fetch(`/api/invoices/${id}/pdf?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'rechnung.pdf'; a.click(); URL.revokeObjectURL(url);
        toast.success('PDF heruntergeladen');
        // Block N: fire-and-forget audit event for the user-initiated download.
        fetch('/api/audit/share-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'INVOICE_PDF_DOWNLOADED', targetType: 'Invoice', targetId: id }),
        }).catch(() => {});
      } else toast.error('PDF-Fehler');
    } catch { toast.error('Fehler'); } finally { setDownloading(null); }
  };

  const sendPdfToWhatsApp = async (inv: Invoice) => {
    // New flow: server generates PDF, uploads to public S3, and sends
    // it via Twilio directly to the operator's PRIMARY business WhatsApp
    // number (whatsappIntakeNumber → telefon). The operator then forwards
    // the message from their own WhatsApp to the customer.
    // Customer.phone and CompanySettings.telefon2 are NEVER used.
    if (!businessWhatsappNumber) {
      toast.error(
        'Keine WhatsApp-Nummer für den Betrieb hinterlegt. Bitte unter Einstellungen → Kontakt die Hauptnummer (Telefon) oder die WhatsApp-Empfangsnummer eintragen.',
        { duration: 6000 }
      );
      return;
    }
    setDownloading(inv.id);
    const sendingToast = toast.loading('PDF wird erstellt und an Ihre WhatsApp gesendet …');
    try {
      const result = await sendPdfToBusinessWhatsApp({ kind: 'invoice', id: inv.id });
      toast.dismiss(sendingToast);
      if (result.ok) {
        toast.success('PDF wurde an Ihre WhatsApp-Nummer gesendet. Sie können es nun aus dem Chat an den Kunden weiterleiten.', { duration: 6000 });
      } else if (result.reason === 'no_business_number') {
        toast.error(
          result.message ||
          'Keine WhatsApp-Nummer für den Betrieb hinterlegt. Bitte unter Einstellungen → Kontakt die Hauptnummer (Telefon) oder die WhatsApp-Empfangsnummer eintragen.',
          { duration: 6000 }
        );
      } else if (result.reason === 'pdf_failed') {
        toast.error(result.message || 'PDF konnte nicht erstellt werden.');
      } else if (result.reason === 'upload_failed') {
        toast.error(result.message || 'PDF konnte nicht für den Versand bereitgestellt werden.');
      } else if (result.reason === 'twilio_not_configured') {
        toast.error(
          result.message ||
          'WhatsApp-Versand ist nicht konfiguriert. Bitte Twilio-Absendernummer (TWILIO_WHATSAPP_FROM) hinterlegen.',
          { duration: 8000 }
        );
      } else if (result.reason === 'twilio_invalid_to') {
        toast.error(result.message || 'Die hinterlegte WhatsApp-Nummer ist ungültig.', { duration: 6000 });
      } else if (result.reason === 'twilio_rejected') {
        toast.error(result.message || 'WhatsApp-Versand wurde von Twilio abgelehnt.', { duration: 6000 });
      } else if (result.reason === 'twilio_network') {
        toast.error(result.message || 'Verbindung zu Twilio fehlgeschlagen. Bitte erneut versuchen.');
      } else if (result.reason === 'unauthorized') {
        toast.error('Bitte melden Sie sich erneut an.');
      } else {
        toast.error(result.message || 'Fehler beim Senden an WhatsApp.');
      }
    } catch (err) {
      toast.dismiss(sendingToast);
      console.error('[rechnungen] sendPdfToWhatsApp failed', err);
      toast.error('Fehler beim Senden an WhatsApp.');
    } finally {
      setDownloading(null);
    }
  };

  const updateStatus = async (e: React.MouseEvent | React.ChangeEvent, id: string, status: string) => {
    if ('stopPropagation' in e) e.stopPropagation();
    await fetch(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (status === 'Erledigt') {
      toast.success('Rechnung erledigt – verschoben ins Archiv');
    } else {
      toast.success('Status aktualisiert');
    }
    load();
  };

  const remove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setConfirmDialog({
      title: 'In Papierkorb verschieben?',
      message: 'Die Rechnung wird in den Papierkorb verschoben.',
      action: async () => {
        const inv = invoices.find(i => i.id === id);
        if (inv?.sourceOfferId) {
          await fetch(`/api/offers/${inv.sourceOfferId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Angenommen' }) });
          toast.info('Angebot-Status zurückgesetzt');
        }
        await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
        toast.success('Rechnung in Papierkorb verschoben'); load();
      },
    });
  };

  const revertToOffer = (inv: Invoice) => {
    const hasOffer = !!inv.sourceOfferId;
    const msg = hasOffer
      ? `Rechnung ${inv.invoiceNumber} zurück zu Angeboten verschieben? Die Rechnung wird gelöscht und das verknüpfte Angebot wird wieder aktiviert.`
      : `Rechnung ${inv.invoiceNumber} zurücksetzen? Die Rechnung wird gelöscht und die verknüpften Aufträge werden wieder aktiv.`;
    setConfirmDialog({
      title: hasOffer ? 'Zurück zu Angeboten?' : 'Rechnung zurücksetzen?',
      message: msg,
      action: async () => {
        try {
          const res = await fetch(`/api/invoices/${inv.id}/revert`, { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            if (data.reactivatedOffer) {
              toast.success('Rechnung zurückgesetzt — Angebot wieder aktiv');
              router.push('/angebote');
            } else {
              toast.success(`Rechnung zurückgesetzt — ${data.revertedOrders || 0} Auftrag/Aufträge wieder aktiv`);
              router.push('/auftraege');
            }
          } else {
            const err = await res.json().catch(() => ({}));
            toast.error(err.error || 'Fehler beim Zurücksetzen');
          }
        } catch { toast.error('Fehler beim Zurücksetzen'); }
      },
    });
  };

  // Sort: Offen first, then by status, alphabetical by customer
  const sorted = [...invoices].sort((a, b) => {
    switch (sortBy) {
      case 'oldest': return new Date(a.createdAt ?? a.invoiceDate ?? 0).getTime() - new Date(b.createdAt ?? b.invoiceDate ?? 0).getTime();
      case 'name': return (a.customer?.name ?? '').localeCompare(b.customer?.name ?? '');
      case 'amount': return (Number(b.total) || 0) - (Number(a.total) || 0);
      default: return new Date(b.createdAt ?? b.invoiceDate ?? 0).getTime() - new Date(a.createdAt ?? a.invoiceDate ?? 0).getTime();
    }
  });

  const unpaidCount = invoices.filter(i => i.status !== 'Bezahlt').length;
  const paidCount = invoices.filter(i => i.status === 'Bezahlt').length;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (loadError) return <LoadErrorFallback details={loadError} onRetry={load} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><FileText className="w-7 h-7 text-primary" /> Rechnungen</h1>
          <p className="text-muted-foreground mt-1">{unpaidCount} offen &middot; {paidCount} bezahlt</p>
        </div>
        <Button onClick={openNewInvoice}><Plus className="w-4 h-4 mr-1" />Neue Rechnung</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Name, Ort, Leistung, Rechnungs-Nr…" className="pl-10 h-9 text-sm" value={searchText} onChange={(e: any) => setSearchText(e?.target?.value ?? '')} />
        </div>
        <select className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9" value={filterStatus} onChange={(e: any) => setFilterStatus(e?.target?.value ?? 'Alle')}>
          <option value="Alle">Status: Alle</option>
          <option value="Offen">Unbezahlt</option>
          <option value="Überfällig">Überfällig</option>
          <option value="Bezahlt">Bezahlt</option>
        </select>
        <select className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9" value={sortBy} onChange={(e: any) => setSortBy(e?.target?.value ?? 'newest')}>
          <option value="newest">Neueste zuerst</option>
          <option value="oldest">Älteste zuerst</option>
          <option value="name">Name A–Z</option>
          <option value="amount">Betrag ↓</option>
        </select>
      </div>

      <div className="space-y-1.5">
        {(() => {
          const filteredInv = sorted.filter((inv: Invoice) => {
            if (filterStatus === 'Offen' && inv.status === 'Bezahlt') return false;
            if (filterStatus === 'Bezahlt' && inv.status !== 'Bezahlt') return false;
            // "Überfällig" matches either stored status OR dynamically derived (Gesendet + past dueDate).
            // Uses same getEffectiveInvoiceStatus helper already used for badge display.
            if (filterStatus === 'Überfällig' && getEffectiveInvoiceStatus(inv) !== 'Überfällig') return false;
            const s = searchText?.toLowerCase() ?? '';
            if (!s) return true;
            const itemDescs = inv.items?.map((it: any) => it.description).filter(Boolean).join(' ') || '';
            return inv?.customer?.name?.toLowerCase()?.includes(s) || inv?.customer?.city?.toLowerCase()?.includes(s) || itemDescs.toLowerCase().includes(s) || inv?.invoiceNumber?.toLowerCase()?.includes(s) || inv?.customer?.customerNumber?.toLowerCase()?.includes(s);
          });
          return filteredInv.length === 0 ? <p className="text-center text-muted-foreground py-8">Keine Rechnungen gefunden</p> : (
            <>
              {filteredInv.slice(0, visibleCount).map((inv: Invoice, i: number) => {
                const isPaid = inv.status === 'Bezahlt';
                const itemDescs = inv.items?.map((it: any) => it.description).filter(Boolean).join(' + ') || '–';
                const orderCtx = resolveCommunicationData(null, inv.orders);
                // Effective status may auto-derive "Überfällig" for unpaid
                // "Gesendet" invoices whose dueDate has passed. The select
                // below uses this for display (value + color) only; the raw
                // stored status remains in the DB until the user actively
                // changes it via the dropdown.
                const effectiveStatus = getEffectiveInvoiceStatus(inv);
                return (
                  <motion.div key={inv?.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                    <Card className={`cursor-pointer transition-shadow hover:shadow-md tap-safe`} onClick={() => openEditInvoice(inv)}>
                      <CardContent className="px-3 py-1.5">
                        <div className="flex items-start gap-1.5">
                          {/* Left: 3-dot menu */}
                          <div className="relative shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
                            <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(dropdownOpenId === inv.id ? null : inv.id); }} className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted" title="Aktionen">
                              <MoreVertical className="w-3.5 h-3.5" />
                            </button>
                            {dropdownOpenId === inv.id && (
                              <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-900 border rounded-lg shadow-lg py-1 min-w-[180px]">
                                <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(null); openEditInvoice(inv); }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
                                  <FileText className="w-3.5 h-3.5 text-primary" />Bearbeiten
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(null); downloadPdf({ stopPropagation: () => {} } as any, inv.id); }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
                                  <Download className="w-3.5 h-3.5 text-green-600" />PDF herunterladen
                                </button>
                                {whatsappEnabled && <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(null); sendPdfToWhatsApp(inv); }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
                                  <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />PDF an WhatsApp senden
                                </button>}
                                <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(null); updateStatus(e, inv.id, 'Erledigt'); }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
                                  <Archive className="w-3.5 h-3.5 text-amber-600" />Archivieren
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(null); revertToOffer(inv); }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
                                  <Undo2 className="w-3.5 h-3.5 text-amber-600" />{inv.sourceOfferId ? 'Zurück zu Angebot' : 'Zurück zu Auftrag'}
                                </button>
                                <div className="border-t my-1" />
                                <button onClick={(e) => { e.stopPropagation(); setDropdownOpenId(null); remove({ stopPropagation: () => {} } as any, inv.id); }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2">
                                  <Trash2 className="w-3.5 h-3.5" />Papierkorb
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Center: Main info */}
                          <div className={`flex-1 min-w-0 ${isPaid ? 'opacity-80' : ''}`}>
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="text-muted-foreground shrink-0">{(() => { const dt = inv.orders?.[0]?.createdAt || inv.createdAt; return dt ? new Date(dt).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' }) + ' ' + new Date(dt).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : (inv?.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('de-CH') : ''); })()}</span>
                              <span className="text-muted-foreground">·</span>
                              <span className="font-medium text-foreground truncate">{isFallbackCustomerName(inv?.customer?.name) ? '⚠️ Kunde nicht zugeordnet' : (inv?.customer?.name ?? '')}{inv?.customer?.customerNumber ? ` (${inv.customer.customerNumber})` : ''}</span>
                              {isCustomerDataIncomplete(inv.customer) && (
                                <MissingCustomerDataBadge
                                  variant="compact"
                                  onClick={() => openEditInvoice(inv, { openCustomerSection: true })}
                                />
                              )}
                              <span className="text-muted-foreground hidden sm:inline">·</span>
                              <span className={`text-xs truncate hidden sm:inline ${isPaid ? 'text-muted-foreground' : 'text-foreground/70'}`}>{itemDescs}</span>
                              <span className={`font-mono font-semibold text-sm whitespace-nowrap shrink-0 ml-auto tabular-nums ${isPaid ? 'text-muted-foreground' : 'text-primary'}`}>CHF {Number(inv?.total ?? 0).toFixed(2)}</span>
                            </div>
                            <p className={`text-xs line-clamp-1 mt-0.5 sm:hidden ${isPaid ? 'text-muted-foreground' : 'text-foreground/70'}`}>{itemDescs}</p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <select onClick={(e) => e.stopPropagation()} className="text-[11px] border rounded px-1.5 py-0.5" style={getStatusStyle(INVOICE_STATUS_STYLES, effectiveStatus)} value={effectiveStatus} onChange={(e: any) => updateStatus(e, inv?.id, e?.target?.value ?? '')}>
                                {invoiceStatuses.map(s => <option key={s} style={getStatusStyle(INVOICE_STATUS_STYLES, s)}>{s}</option>)}
                              </select>
                              <span className="font-mono text-[11px] text-muted-foreground">{inv?.invoiceNumber ?? ''}</span>
                              {(inv?.status === 'Gesendet' || inv?.status === 'Bezahlt') && inv?.invoiceDate && (
                                <span className="text-[10px] text-muted-foreground italic">Gesendet {new Date(inv.invoiceDate).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
                              )}
                              <CommunicationChips data={orderCtx} onAudioClick={() => { if (orderCtx.mediaUrl) { openMedia(orderCtx.mediaUrl, 'audio'); }}} onImageClick={() => { const imgs = orderCtx.imageUrls; if (imgs && imgs.length > 0) { openImageGallery(imgs); }}} />
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
                  <Button variant="outline" onClick={() => setVisibleCount(v => v + 30)}>Mehr laden ({filteredInv.length - visibleCount} weitere)</Button>
                </div>
              )}
            </>
          );
        })()}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingInvoice(null); }}>
        <DialogContent className={`${dupCheckOpen ? 'max-w-4xl w-[95vw]' : 'max-w-2xl'} max-h-[90vh] overflow-y-auto overflow-x-hidden transition-all`}>
          <DialogHeader>
            <DialogTitle>{editingInvoice ? 'Rechnung bearbeiten' : 'Neue Rechnung'}</DialogTitle>
            {/* Source / traceability info — non-editable */}
            {editingInvoice?.sourceOfferNumber && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Erstellt aus Angebot <span className="font-mono font-medium text-foreground">{editingInvoice.sourceOfferNumber}</span>
              </p>
            )}
          </DialogHeader>
          <div className={dupCheckOpen ? 'grid grid-cols-1 sm:grid-cols-2 gap-4 dupcheck-split min-w-0' : 'min-w-0 overflow-hidden'}>
          <div className={`space-y-4 min-w-0${dupCheckOpen ? ' max-h-[35vh] sm:max-h-none overflow-y-auto dupcheck-form-col' : ''}`}>
            {/* Top header: customer-data warnings — shown near customer area.
                The chip itself is the only click target — clicking it opens
                the customer-edit section. No duplicate buttons; the existing
                "✏️ Bearbeiten" link inside the customer card and
                "Kunde aktualisieren" save button inside the edit section
                handle all other actions. */}
            {(() => {
              const cust = form.customerId ? customers.find((c: Customer) => c.id === form.customerId) : null;
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
                    {linkedOrderData?.needsReview && <Badge variant="secondary" className="text-[11px] px-2 py-0.5 bg-orange-200 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200 border border-orange-300">
                      <AlertTriangle className="w-3 h-3 mr-1" />Kundendaten prüfen
                    </Badge>}
                    {!linkedOrderData?.needsReview && missingData && <MissingCustomerDataBadge variant="standard" />}
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
                    <button className="text-xs text-blue-600 hover:underline flex items-center gap-1" onClick={() => openCustomerEditor()}>✏️ Bearbeiten</button>
                    <button className="text-xs text-amber-600 hover:underline flex items-center gap-1" onClick={() => setDupCheckOpen(true)}>🔍 Duplikate prüfen</button>
                  </div>
                )}
              </div>
              {!showNewCustomer ? (
                <>
                  {editingInvoice && form.customerId ? (() => {
                    const cust = customers.find((c: Customer) => c.id === form.customerId);
                    if (!cust) return null;
                    // Required fields: name/address/plz/city — painted red when missing.
                    // Optional fields: phone/email — always neutral (black), never red.
                    const reqMiss = isRequiredCustomerFieldMissing;
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => openCustomerEditor()}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCustomerEditor(); } }}
                        title="Kunde bearbeiten"
                        aria-label="Kunde bearbeiten"
                        className="border rounded-lg p-2 sm:p-3 bg-muted/30 space-y-1.5 min-w-0 cursor-pointer hover:bg-muted/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold">👤 {cust.customerNumber || ''}{cust.customerNumber ? ' · ' : ''}</span>
                          <span className={`text-sm font-semibold ${isFallbackCustomerName(cust.name) ? 'text-amber-600 italic' : reqMiss(cust.name) ? 'text-red-500 border-b border-red-400 border-dashed pb-0.5 italic' : ''}`}>{isFallbackCustomerName(cust.name) ? '⚠️ Kunde noch nicht zugeordnet (bitte echten Kunden zuweisen)' : (cust.name || 'Name fehlt')}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-1 text-xs">
                          <div className={`flex items-center gap-1 ${reqMiss(cust.address) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium w-16 shrink-0">Strasse:</span><span className={reqMiss(cust.address) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}>{cust.address || 'fehlt'}</span></div>
                          <div className="flex gap-3">
                            <div className={`flex items-center gap-1 ${reqMiss(cust.plz) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium w-16 shrink-0">PLZ:</span><span className={reqMiss(cust.plz) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}>{cust.plz || 'fehlt'}</span></div>
                            <div className={`flex items-center gap-1 ${reqMiss(cust.city) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium shrink-0">Ort:</span><span className={reqMiss(cust.city) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}>{cust.city || 'fehlt'}</span></div>
                          </div>
                          <div className="flex items-center gap-1 text-foreground/70"><span className="font-medium w-16 shrink-0">Tel:</span><span>{cust.phone || '—'}</span></div>
                          <div className="flex items-center gap-1 text-foreground/70"><span className="font-medium w-16 shrink-0">E-Mail:</span><span>{cust.email || '—'}</span></div>
                        </div>
                      </div>
                    );
                  })() : (
                    <>
                      <div className="flex gap-2">
                        <CustomerSearchCombobox
                          customers={customers}
                          value={form.customerId}
                          onChange={(id) => onCustomerChange(id)}
                        />
                        <Button type="button" variant="outline" size="sm" className="shrink-0 text-xs h-[38px]" onClick={() => { setEditingCustomer(false); setNewCust({ name: '', phone: '', email: '', address: '', plz: '', city: '', country: 'CH' }); setShowNewCustomer(true); }}>+ Neuer Kunde</Button>
                      </div>
                      {form.customerId && (() => {
                        const cust = customers.find((c: Customer) => c.id === form.customerId);
                        if (!cust) return null;
                        const reqMiss = isRequiredCustomerFieldMissing;
                        return (
                          <div className="mt-2 border rounded-lg p-2 sm:p-3 bg-muted/30 space-y-1.5 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-semibold">👤 {cust.customerNumber || ''}{cust.customerNumber ? ' · ' : ''}</span>
                              <span className={`text-sm font-semibold ${isFallbackCustomerName(cust.name) ? 'text-amber-600 italic' : reqMiss(cust.name) ? 'text-red-500 border-b border-red-400 border-dashed pb-0.5 italic' : ''}`}>{isFallbackCustomerName(cust.name) ? '⚠️ Kunde noch nicht zugeordnet (bitte echten Kunden zuweisen)' : (cust.name || 'Name fehlt')}</span>
                            </div>
                            <div className="grid grid-cols-1 gap-1 text-xs">
                              <div className={`flex items-center gap-1 ${reqMiss(cust.address) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium w-16 shrink-0">Strasse:</span><span className={reqMiss(cust.address) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}>{cust.address || 'fehlt'}</span></div>
                              <div className="flex gap-3">
                                <div className={`flex items-center gap-1 ${reqMiss(cust.plz) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium w-16 shrink-0">PLZ:</span><span className={reqMiss(cust.plz) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}>{cust.plz || 'fehlt'}</span></div>
                                <div className={`flex items-center gap-1 ${reqMiss(cust.city) ? 'text-red-500' : 'text-foreground/70'}`}><span className="font-medium shrink-0">Ort:</span><span className={reqMiss(cust.city) ? 'border-b border-red-400 border-dashed pb-0.5 italic' : ''}>{cust.city || 'fehlt'}</span></div>
                              </div>
                              <div className="flex items-center gap-1 text-foreground/70"><span className="font-medium w-16 shrink-0">Tel:</span><span>{cust.phone || '—'}</span></div>
                              <div className="flex items-center gap-1 text-foreground/70"><span className="font-medium w-16 shrink-0">E-Mail:</span><span>{cust.email || '—'}</span></div>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </>
              ) : (
                <div ref={customerEditorRef} className="border rounded-lg p-2 sm:p-3 space-y-2 bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground">{editingCustomer ? '✏️ Kunde bearbeiten' : '➕ Neuer Kunde erstellen'}</p>
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
                    <Button size="sm" variant="ghost" onClick={() => { setShowNewCustomer(false); setEditingCustomer(false); }}>Zurück zur Rechnung</Button>
                  </div>
                </div>
              )}
            </div>
            {/* Form fields — collapsed when dupCheck open */}
            {dupCheckOpen ? (
              <div className="p-2 bg-muted/40 rounded border border-dashed text-xs text-muted-foreground flex items-center justify-between">
                <span>{items?.filter((i: InvoiceItem) => i.description).length || 0} Leistung(en) · CHF {total.toFixed(2)} · {form.invoiceDate || '–'} · {editingInvoice?.status || 'Neu'}</span>
                <span className="text-[10px] italic">Duplikat-Prüfung aktiv — Form eingeklappt</span>
              </div>
            ) : (<>
            <div><Label>Rechnungsdatum</Label><Input type="date" value={form.invoiceDate} onChange={(e: any) => setForm({ ...form, invoiceDate: e?.target?.value ?? '' })} /></div>
            {!editingInvoice && <div><Label>Zahlungsziel (Tage)</Label><Input type="number" value={form.paymentDays} onChange={(e: any) => setForm({ ...form, paymentDays: e?.target?.value ?? '30' })} /></div>}
            {editingInvoice && (
              <div>
                <Label>Status</Label>
                <select className="flex w-full rounded-md border border-input px-3 py-2 text-sm" style={getStatusStyle(INVOICE_STATUS_STYLES, editingInvoice.status)} value={editingInvoice.status} onChange={(e: any) => { setEditingInvoice({ ...editingInvoice, status: e.target.value }); }}>
                  {invoiceStatuses.map(s => <option key={s} style={getStatusStyle(INVOICE_STATUS_STYLES, s)}>{s}</option>)}
                </select>
              </div>
            )}

            <div className="space-y-3">
              <Label className="text-base font-semibold">Leistungen</Label>
              {items?.map((item: InvoiceItem, idx: number) => (
                <div key={idx} className="border rounded-lg p-2 sm:p-3 bg-accent/10 space-y-2">
                  {/* Row 1: Service name – full width */}
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <ServiceCombobox
                        value={item?.description ?? ''}
                        services={services as ServiceOption[]}
                        onChange={(name, svc) => onItemServiceSelect(idx, name, svc)}
                        onServiceCreated={handleServiceCreated}
                        currentPrice={item?.unitPrice != null ? String(item.unitPrice) : undefined}
                        currentUnit={item?.unit}
                        contextLabel="Rechnung"
                      />
                    </div>
                    {items?.length > 1 && (
                      <Button variant="ghost" size="sm" className="text-destructive shrink-0 mt-1" onClick={() => removeItem(idx)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  {/* Row 2: Quantity, Unit, Price, Line total */}
                  <div className="grid grid-cols-4 gap-2 items-end">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Menge</Label>
                      <Input type="number" step="0.25" placeholder="Menge" value={item?.quantity ?? ''} onChange={(e: any) => updateItem(idx, 'quantity', e?.target?.value ?? '')} />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Einheit</Label>
                      <select className="flex w-full rounded-md border border-input bg-background px-2 py-2 text-sm" value={item?.unit ?? 'Stunde'} onChange={(e: any) => updateItem(idx, 'unit', e?.target?.value ?? '')}>
                        <option>Stunde</option><option>Pauschal</option><option>Meter</option><option>Stück</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Preis</Label>
                      <Input type="number" step="0.05" placeholder="Preis" value={item?.unitPrice ?? ''} onChange={(e: any) => updateItem(idx, 'unitPrice', e?.target?.value ?? '')} />
                    </div>
                    <div className="text-right font-mono text-sm pt-5">
                      {(Number(item?.quantity ?? 0) * Number(item?.unitPrice ?? 0)).toFixed(2)}
                    </div>
                  </div>
                </div>
              )) ?? []}
              <Button variant="outline" size="sm" onClick={addItem}><Plus className="w-3 h-3 mr-1" />Leistung hinzufügen</Button>
            </div>

            <div className="p-2 sm:p-4 bg-muted rounded-lg space-y-3 min-w-0">
              <MwStControl vatRate={vatRate} onChange={setVatRate} />
              <div className="space-y-1 border-t pt-2 min-w-0 text-xs sm:text-sm">
                <div className="flex justify-between min-w-0"><span className="shrink-0">Netto</span><span className="font-mono">CHF {subtotal.toFixed(2)}</span></div>
                {vatRate > 0 && (
                  <div className="flex justify-between min-w-0"><span className="shrink-0">MwSt. {vatRate}%</span><span className="font-mono">CHF {vatAmount.toFixed(2)}</span></div>
                )}
                <div className="flex justify-between font-bold border-t pt-2 min-w-0 text-sm sm:text-base"><span className="shrink-0">Total</span><span className="font-mono text-primary">CHF {total.toFixed(2)}</span></div>
              </div>
            </div>

            <div><Label>Bemerkungen</Label><textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} value={form.notes} onChange={(e: any) => setForm({ ...form, notes: e?.target?.value ?? '' })} /></div>

            {/* Unified communication block: description + special notes + customer message/media */}
            {editOrderCtx && (
              <CommunicationBlock
                data={editOrderCtx}
                showDescription
                descriptionValue={editOrderCtx.description || ''}
                specialNotesValue={splitSpecialNotes(editOrderCtx.specialNotes).jobHints.join('\n')}
              />
            )}
            </>)}

            {/* Document action buttons — hidden when customer editor OR duplicate panel is open */}
            {!showNewCustomer && !dupCheckOpen && (
            <div className="flex flex-wrap justify-center sm:justify-end gap-2">
              <Button variant="outline" onClick={() => { setDialogOpen(false); setEditingInvoice(null); }}>Abbrechen</Button>
              <Button onClick={editingInvoice ? saveEdit : save} disabled={saving}>{saving ? 'Speichern...' : editingInvoice ? 'Speichern' : 'Rechnung erstellen'}</Button>
              {editingInvoice && (
                <Button variant="secondary" onClick={saveAndArchive} disabled={saving} className="bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200">
                  <Archive className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />→ Archivieren
                </Button>
              )}
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
                  if (!editingInvoice) return;
                  const oldCustomerId = form.customerId; // capture before overwrite
                  const res = await fetch(`/api/invoices/${editingInvoice.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customerId: match.id }),
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    toast.error(err?.error || 'Fehler beim Kunden-Wechsel');
                    return;
                  }
                  setForm((f: any) => ({ ...f, customerId: match.id }));
                  setNewCust({
                    name: (match.name ?? '') as string,
                    address: (match.address ?? '') as string,
                    plz: (match.plz ?? '') as string,
                    city: (match.city ?? '') as string,
                    phone: (match.phone ?? '') as string,
                    email: (match.email ?? '') as string,
                    country: 'CH',
                  });
                  setCustomers((prev: Customer[]) => {
                    const exists = prev.some((c) => c.id === match.id);
                    if (exists) return prev;
                    return [...prev, { id: match.id, name: match.name, customerNumber: match.customerNumber ?? null, address: match.address ?? null, plz: match.plz ?? null, city: match.city ?? null, phone: match.phone ?? null, email: match.email ?? null } as Customer];
                  });
                  setInvoices((prev: Invoice[]) => prev.map((inv) =>
                    inv.id === editingInvoice.id ? { ...inv, customerId: match.id, customer: { name: match.name, customerNumber: match.customerNumber, address: match.address, plz: match.plz, city: match.city, phone: match.phone, email: match.email } } : inv
                  ));
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
                  setForm((f: any) => ({ ...f, customerId: r.survivingCustomerId }));
                  // Stage F – Critical bug fix:
                  // Replace local `newCust` form state with the freshly
                  // merged customer so the visible "Kunde bearbeiten" form
                  // shows the user-selected values immediately.
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
                    setCustomers(prev => {
                      const exists = prev.some((c: Customer) => c.id === m.id);
                      const merged = { ...m } as any;
                      if (exists) return prev.map((c: Customer) => c.id === m.id ? { ...c, ...merged } : c);
                      return [...prev, merged as Customer];
                    });
                    setInvoices(prev => prev.map((inv: any) => inv.customerId === m.id
                      ? { ...inv, customer: { ...inv.customer, ...m } }
                      : inv));
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

      {/* Confirm action dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{confirmDialog?.title}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{confirmDialog?.message}</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setConfirmDialog(null)}>Abbrechen</Button>
            <Button variant="destructive" size="sm" onClick={async () => { await confirmDialog?.action(); setConfirmDialog(null); }}>Bestätigen</Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}