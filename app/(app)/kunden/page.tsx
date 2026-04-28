'use client';
import { useEffect, useState } from 'react';
import { Users, Plus, Search, Trash2, Phone, MapPin, Loader2, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useDialogBackGuard } from '@/lib/use-dialog-back-guard';
import { isCustomerDataIncomplete } from '@/lib/customer-links';
import { PlzOrtInput } from '@/components/plz-ort-input';
import { MissingCustomerDataBadge } from '@/components/missing-customer-data-badge';
// PHASE 2a: strict E.164 search on phone when query parses; text fallback otherwise.
import { matchesQuery } from '@/lib/customer-search-match';

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
  _count?: { orders: number; offers: number; invoices: number };
  _totalCount?: { orders: number; offers: number; invoices: number; archivedInvoices: number };
}

const emptyForm = { name: '', address: '', plz: '', city: '', country: 'CH', phone: '', email: '', notes: '', customerNumber: '' };

export default function KundenPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Archive dialog
  const [archiveTarget, setArchiveTarget] = useState<Customer | null>(null);
  const [archiving, setArchiving] = useState(false);

  // Android/browser back: close the edit dialog FIRST instead of jumping to the
  // previously visited module. Safe version — see lib/use-dialog-back-guard.ts.
  useDialogBackGuard(dialogOpen, () => setDialogOpen(false));

  const load = () => fetch('/api/customers').then(r => r.json()).then(d => { setCustomers(d ?? []); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const [sortBy, setSortBy] = useState('name');

  const filtered = customers?.filter((c: Customer) => matchesQuery(c, search)).sort((a, b) => {
    switch (sortBy) {
      case 'name_za': return (b.name ?? '').localeCompare(a.name ?? '');
      case 'newest': return (b.id ?? '').localeCompare(a.id ?? '');
      case 'oldest': return (a.id ?? '').localeCompare(b.id ?? '');
      case 'orders': return ((b._count?.orders ?? 0) + (b._count?.offers ?? 0) + (b._count?.invoices ?? 0)) - ((a._count?.orders ?? 0) + (a._count?.offers ?? 0) + (a._count?.invoices ?? 0));
      case 'name':
      default: return (a.name ?? '').localeCompare(b.name ?? '');
    }
  }) ?? [];

  const openNew = () => { setEditId(null); setForm(emptyForm); setDialogOpen(true); };

  const save = async () => {
    if (!form?.name?.trim()) { toast.error('Name ist erforderlich'); return; }
    setSaving(true);
    try {
      const url = editId ? `/api/customers/${editId}` : '/api/customers';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (res.ok) { toast.success(editId ? 'Kunde aktualisiert' : 'Neuer Kunde erstellt – eigene ID wurde vergeben'); setDialogOpen(false); load(); }
      else toast.error('Fehler beim Speichern');
    } catch { toast.error('Fehler'); } finally { setSaving(false); }
  };

  const archive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/customers/${archiveTarget.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Kunde in Papierkorb verschoben');
        setArchiveTarget(null);
        load();
      } else {
        const data = await res.json().catch(() => null);
        if (data?.blocked) {
          toast.error(data.error, { duration: 6000 });
        } else {
          toast.error(data?.error || 'Fehler beim Löschen');
        }
        setArchiveTarget(null);
      }
    } catch { toast.error('Fehler'); } finally { setArchiving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><Users className="w-7 h-7 text-primary" /> Kunden</h1>
          <p className="text-muted-foreground mt-1">
            {search.trim().length > 0
              ? `${filtered.length} von ${customers?.length ?? 0} Kunden`
              : `${customers?.length ?? 0} Kunden gesamt`}
          </p>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Neuer Kunde</Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Name, Ort, ID, Telefon..." className="pl-8 h-9 text-sm" value={search} onChange={(e: any) => setSearch(e?.target?.value ?? '')} />
        </div>
        <select
          className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
          value={sortBy}
          onChange={(e: any) => setSortBy(e?.target?.value ?? 'name')}
          aria-label="Sortierung"
        >
          <option value="name">Name A–Z</option>
          <option value="name_za">Name Z–A</option>
          <option value="newest">Neueste zuerst</option>
          <option value="oldest">Älteste zuerst</option>
          <option value="orders">Meiste Aufträge</option>
        </select>
      </div>

      <div className="space-y-1.5">
        {filtered?.length === 0 ? <p className="text-center text-muted-foreground py-8">{(customers?.length ?? 0) === 0 ? 'Noch keine Kunden vorhanden' : 'Keine Treffer für die aktuelle Suche'}</p> :
          filtered.map((c: Customer, i: number) => {
            const displayName = (c?.name ?? '').trim() || 'Kunde ohne Name';
            // Canonical "Kundendaten fehlen" rule — shared with /api/dashboard
            // via lib/customer-links.ts so the chip count on this list and the
            // "Zu prüfen → Kundendaten fehlen" count on the dashboard are
            // guaranteed to match exactly.
            const hasMissingData = isCustomerDataIncomplete(c);
            return (
            <div key={c?.id}>
              {/* Stage L (2026-04-25) — single-tap card.
                    The ENTIRE card is one tap target → opens /kunden/[id].
                    All inner badges/chips are non-interactive (pointer-events:none)
                    so taps anywhere on the card reliably reach the Card's onClick.
                    The trash button is the only exception — it stops propagation.
                    framer-motion was removed because its lifecycle could intercept
                    the first tap in PWA standalone mode. */}
              {(() => {
                const vc = c?._count;
                const tc = c?._totalCount;
                // hiddenHistory math is the source of truth for "history":
                //   (tc.orders − vc.orders)      → weitergeführte (converted) Aufträge
                //   (tc.offers − vc.offers)      → abgeschlossene (Angenommen/Abgelehnt/Abgelaufen) Angebote
                //   (tc.invoices − vc.invoices)  → always 0 (tc.invoices is strict non-archived)
                //   + tc.archivedInvoices         → erledigte/archivierte Rechnungen
                const hiddenHistory =
                  vc && tc
                    ? Math.max(0, (tc.orders ?? 0) - (vc.orders ?? 0)) +
                      Math.max(0, (tc.offers ?? 0) - (vc.offers ?? 0)) +
                      Math.max(0, (tc.invoices ?? 0) - (vc.invoices ?? 0)) +
                      (tc.archivedInvoices ?? 0)
                    : 0;
                return (
              <Card className="hover:shadow-md transition-shadow cursor-pointer tap-safe" onClick={() => router.push(`/kunden/${c.id}`)}>
                <CardContent className="px-3 py-2">
                  {/* ============================================================
                      DESKTOP / TABLET / LANDSCAPE (>= sm, 640px+)
                      ============================================================ */}
                  <div className="hidden sm:flex items-center gap-1.5 min-w-0">
                    {/* COL 1 — customer info (non-interactive, except phone shown as text only) */}
                    <div className="flex-1 min-w-0 max-w-[300px] md:max-w-[380px] lg:max-w-[440px] pointer-events-none">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium text-sm truncate">{displayName}</span>
                        {c?.customerNumber && <span className="text-[11px] font-mono text-muted-foreground shrink-0">({c.customerNumber})</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground min-w-0">
                        {(c?.city || c?.plz) && <span className="flex items-center gap-0.5 truncate"><MapPin className="w-3 h-3 shrink-0" />{[c?.plz, c?.city].filter(Boolean).join(' ')}</span>}
                        {c?.phone && <span className="flex items-center gap-0.5 text-primary truncate"><Phone className="w-3 h-3 shrink-0" />{c.phone}</span>}
                      </div>
                    </div>

                    {/* DIVIDER 1 */}
                    <div className="self-stretch w-px bg-border/50 shrink-0" aria-hidden />

                    {/* COL 2 — missing data badge (non-interactive) */}
                    <div className="w-[100px] md:w-[108px] shrink-0 flex items-center justify-center px-1 pointer-events-none">
                      {hasMissingData && (
                        <span title="Pflichtangaben fehlen — Name, Strasse, PLZ oder Ort sind nicht erfasst">
                          <MissingCustomerDataBadge variant="standard" />
                        </span>
                      )}
                    </div>

                    {/* DIVIDER 2 */}
                    <div className="self-stretch w-px bg-border/50 shrink-0" aria-hidden />

                    {/* COL 3 — history chip (non-interactive) */}
                    <div className="w-[88px] shrink-0 flex items-center justify-center px-1 pointer-events-none">
                      {hiddenHistory > 0 && (
                        <span
                          title="Abgeschlossene, weitergeführte oder archivierte Einträge — Karte tippen, um Details zu öffnen"
                          className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 font-medium leading-tight whitespace-nowrap"
                        >
                          {hiddenHistory} Historie
                        </span>
                      )}
                    </div>

                    {/* DIVIDER 3 */}
                    <div className="self-stretch w-px bg-border/50 shrink-0" aria-hidden />

                    {/* COL 4 — active chips, stacked vertically (non-interactive) */}
                    <div className="w-[124px] shrink-0 flex flex-col items-start justify-center gap-0.5 py-0.5 pointer-events-none">
                      {(vc?.orders ?? 0) > 0 && (
                        <span title="Aktive Aufträge — Karte tippen, um Details zu öffnen" className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium leading-tight whitespace-nowrap">
                          {vc!.orders === 1 ? '1 Auftrag' : `${vc!.orders} Aufträge`}
                        </span>
                      )}
                      {(vc?.offers ?? 0) > 0 && (
                        <span title="Aktive Angebote — Karte tippen, um Details zu öffnen" className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-medium leading-tight whitespace-nowrap">
                          {vc!.offers === 1 ? '1 Angebot' : `${vc!.offers} Angebote`}
                        </span>
                      )}
                      {(vc?.invoices ?? 0) > 0 && (
                        <span title="Aktive Rechnungen — Karte tippen, um Details zu öffnen" className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium leading-tight whitespace-nowrap">
                          {vc!.invoices === 1 ? '1 Rechnung' : `${vc!.invoices} Rechnungen`}
                        </span>
                      )}
                    </div>

                    {/* SPACER */}
                    <div className="flex-1 min-w-0" aria-hidden />

                    {/* DIVIDER 4 */}
                    <div className="self-stretch w-px bg-border/50 shrink-0" aria-hidden />

                    {/* COL 5 — TRASH (the one and only interactive child, separated via stopPropagation) */}
                    <button
                      type="button"
                      data-tap-action="trash"
                      onClick={(e) => { e.stopPropagation(); setArchiveTarget(c); }}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 relative z-10"
                      title="Papierkorb"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* ============================================================
                      PORTRAIT MOBILE (< sm, < 640px) — single-tap layout
                      Row A: name + (nr) + city/phone (text only)  │ trash
                      Row B: visual chip strip (all non-interactive)
                      ============================================================ */}
                  <div className="flex sm:hidden flex-col gap-1.5 min-w-0">
                    {/* Row A — info + trash */}
                    <div className="flex items-start gap-2 min-w-0">
                      <div className="flex-1 min-w-0 pointer-events-none">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium text-sm truncate">{displayName}</span>
                          {c?.customerNumber && <span className="text-[11px] font-mono text-muted-foreground shrink-0">({c.customerNumber})</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground min-w-0">
                          {(c?.city || c?.plz) && <span className="flex items-center gap-0.5 truncate"><MapPin className="w-3 h-3 shrink-0" />{[c?.plz, c?.city].filter(Boolean).join(' ')}</span>}
                          {c?.phone && <span className="flex items-center gap-0.5 text-primary truncate"><Phone className="w-3 h-3 shrink-0" />{c.phone}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-tap-action="trash"
                        onClick={(e) => { e.stopPropagation(); setArchiveTarget(c); }}
                        className="p-1 -m-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 relative z-10"
                        title="Papierkorb"
                        aria-label="In den Papierkorb verschieben"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Row B — compact chip strip (entirely non-interactive) */}
                    {(hasMissingData || hiddenHistory > 0 || (vc?.orders ?? 0) > 0 || (vc?.offers ?? 0) > 0 || (vc?.invoices ?? 0) > 0) && (
                      <div className="flex items-center flex-wrap gap-1 pointer-events-none">
                        {hasMissingData && (
                          <span title="Pflichtangaben fehlen — Name, Strasse, PLZ oder Ort sind nicht erfasst">
                            {/* Unified badge — "Prüfen" on mobile, "Kundendaten fehlen" on desktop. */}
                            <MissingCustomerDataBadge variant="compact" />
                          </span>
                        )}
                        {hiddenHistory > 0 && (
                          <span
                            title="Abgeschlossene, weitergeführte oder archivierte Einträge — Karte tippen"
                            className="text-[10px] leading-none px-1.5 py-1 rounded-full bg-gray-200 text-gray-700 font-medium whitespace-nowrap"
                          >
                            {hiddenHistory} Historie
                          </span>
                        )}
                        {(vc?.orders ?? 0) > 0 && (
                          <span
                            title="Aktive Aufträge — Karte tippen"
                            className="text-[10px] leading-none px-1.5 py-1 rounded-full bg-amber-100 text-amber-800 font-medium whitespace-nowrap"
                          >
                            {vc!.orders === 1 ? '1 Auftrag' : `${vc!.orders} Aufträge`}
                          </span>
                        )}
                        {(vc?.offers ?? 0) > 0 && (
                          <span
                            title="Aktive Angebote — Karte tippen"
                            className="text-[10px] leading-none px-1.5 py-1 rounded-full bg-blue-100 text-blue-800 font-medium whitespace-nowrap"
                          >
                            {vc!.offers === 1 ? '1 Angebot' : `${vc!.offers} Angebote`}
                          </span>
                        )}
                        {(vc?.invoices ?? 0) > 0 && (
                          <span
                            title="Aktive Rechnungen — Karte tippen"
                            className="text-[10px] leading-none px-1.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-medium whitespace-nowrap"
                          >
                            {vc!.invoices === 1 ? '1 Rechnung' : `${vc!.invoices} Rechnungen`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
                );
              })()}
            </div>
            );
          })}
      </div>

      {/* New Customer Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Neuer Kunde</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Name *</Label><Input value={form.name} onChange={(e: any) => setForm({ ...form, name: e?.target?.value ?? '' })} /></div>
              <div><Label>Kunden-ID</Label><Input value={form.customerNumber} onChange={(e: any) => setForm({ ...form, customerNumber: e?.target?.value ?? '' })} placeholder="K-001" /></div>
            </div>
            <div><Label>Strasse *</Label><Input value={form.address} onChange={(e: any) => setForm({ ...form, address: e?.target?.value ?? '' })} /></div>
            {/* Paket N + O: shared Land/PLZ/Ort input with country-aware autocomplete. */}
            <PlzOrtInput
              country={form.country}
              onCountryChange={(country) => setForm({ ...form, country })}
              plzValue={form.plz}
              ortValue={form.city}
              onPlzChange={(plz) => setForm({ ...form, plz })}
              onOrtChange={(city) => setForm({ ...form, city })}
              onBothChange={(plz, city) => setForm({ ...form, plz, city })}
              required
            />
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Telefon</Label><Input value={form.phone} onChange={(e: any) => setForm({ ...form, phone: e?.target?.value ?? '' })} /></div>
              <div><Label>E-Mail</Label><Input value={form.email} onChange={(e: any) => setForm({ ...form, email: e?.target?.value ?? '' })} /></div>
            </div>
            <div><Label>Notizen</Label><textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} value={form.notes} onChange={(e: any) => setForm({ ...form, notes: e?.target?.value ?? '' })} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Speichern...' : 'Speichern'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation Dialog */}
      <Dialog open={!!archiveTarget} onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}>
        <DialogContent className="max-w-md">
          {(() => {
            // RELAXED block-rule (Paket J): only "active" records + archived
            // invoices block deletion. Historical records (converted orders,
            // closed offers) are shown as informational note but no longer block.
            const vc = archiveTarget?._count;          // visible / active (Rule C)
            const tc = archiveTarget?._totalCount;     // includes historical
            const activeOrders = vc?.orders ?? 0;
            const activeOffers = vc?.offers ?? 0;
            const activeInvoices = vc?.invoices ?? 0;
            const archivedInvoices = tc?.archivedInvoices ?? 0;
            const historicalOrders = Math.max(0, (tc?.orders ?? 0) - activeOrders);
            const historicalOffers = Math.max(0, (tc?.offers ?? 0) - activeOffers);
            const pureHistory = historicalOrders + historicalOffers;
            const hasLinked = activeOrders > 0 || activeOffers > 0 || activeInvoices > 0 || archivedInvoices > 0;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    {hasLinked && <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0" />}
                    {hasLinked ? 'Kunde kann nicht gelöscht werden' : 'In Papierkorb verschieben?'}
                  </DialogTitle>
                </DialogHeader>
                {hasLinked ? (
                  <div className="space-y-3 text-sm">
                    <p className="text-foreground">
                      <span className="font-medium">{archiveTarget?.name}</span> ist noch mit folgenden aktiven Datensätzen verknüpft:
                    </p>
                    <ul className="list-disc list-inside space-y-1 pl-1 text-foreground">
                      {activeOrders > 0 && (
                        <li>
                          <span className="font-medium">{activeOrders}</span> {activeOrders === 1 ? 'aktiver Auftrag' : 'aktive Aufträge'}
                        </li>
                      )}
                      {activeOffers > 0 && (
                        <li>
                          <span className="font-medium">{activeOffers}</span> {activeOffers === 1 ? 'aktives Angebot' : 'aktive Angebote'}
                        </li>
                      )}
                      {activeInvoices > 0 && (
                        <li>
                          <span className="font-medium">{activeInvoices}</span> {activeInvoices === 1 ? 'aktive Rechnung' : 'aktive Rechnungen'}
                        </li>
                      )}
                      {archivedInvoices > 0 && (
                        <li>
                          <span className="font-medium">{archivedInvoices}</span> {archivedInvoices === 1 ? 'archivierte Rechnung' : 'archivierte Rechnungen'}
                        </li>
                      )}
                    </ul>
                    <p className="text-muted-foreground">
                      Diese Datensätze müssen zuerst in den Papierkorb verschoben werden, bevor der Kunde gelöscht werden kann.
                    </p>
                    {pureHistory > 0 && (
                      <p className="text-xs text-muted-foreground border-t pt-2">
                        Hinweis: {pureHistory} {pureHistory === 1 ? 'historischer Eintrag' : 'historische Einträge'} (abgeschlossene Angebote / weitergeführte Aufträge) {pureHistory === 1 ? 'bleibt' : 'bleiben'} unabhängig davon in der Historie erhalten.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {activeOrders > 0 && archiveTarget?.id && (
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { const id = archiveTarget.id; setArchiveTarget(null); router.push(`/kunden/${id}?tab=auftraege`); }}>
                          Aufträge ansehen
                        </Button>
                      )}
                      {activeOffers > 0 && archiveTarget?.id && (
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { const id = archiveTarget.id; setArchiveTarget(null); router.push(`/kunden/${id}?tab=angebote`); }}>
                          Angebote ansehen
                        </Button>
                      )}
                      {activeInvoices > 0 && archiveTarget?.id && (
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { const id = archiveTarget.id; setArchiveTarget(null); router.push(`/kunden/${id}?tab=rechnungen`); }}>
                          Rechnungen ansehen
                        </Button>
                      )}
                      {archivedInvoices > 0 && (
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setArchiveTarget(null); router.push(`/archiv`); }}>
                          Archiv öffnen
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p className="text-muted-foreground">
                      Dieser Kunde wird in den Papierkorb verschoben.<br />
                      Alle Daten bleiben erhalten.
                    </p>
                    {pureHistory > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Hinweis: {pureHistory} {pureHistory === 1 ? 'historischer Eintrag' : 'historische Einträge'} (abgeschlossene Angebote / weitergeführte Aufträge) {pureHistory === 1 ? 'bleibt' : 'bleiben'} erhalten und verhindern das Löschen nicht.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" onClick={() => setArchiveTarget(null)} disabled={archiving}>
                    {hasLinked ? 'Schliessen' : 'Abbrechen'}
                  </Button>
                  {!hasLinked && (
                    <Button variant="destructive" onClick={archive} disabled={archiving}>
                      {archiving ? 'Verschieben...' : 'In Papierkorb'}
                    </Button>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}