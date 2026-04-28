'use client';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Archive, Search, Download, Loader2, Undo2, FileArchive, X, CalendarRange, AlertTriangle, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const MAX_BULK = 50;

type ExportMode = 'year' | 'month' | 'range';

interface Invoice { id: string; invoiceNumber: string; customerId: string; customer?: any; items: any[]; subtotal: number; vatRate: number; vatAmount: number; total: number; status: string; invoiceDate: string; dueDate: string | null; notes: string | null; sourceOfferId?: string | null; }

export default function ArchivPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [downloading, setDownloading] = useState<string | null>(null);

  // Stage L (2026-04-25) — permanent delete of archived invoices
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Export panel state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>('year');
  const [exportYear, setExportYear] = useState<string>('');
  const [exportMonth, setExportMonth] = useState<string>('');
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportLockRef = useRef(false);

  const load = async () => {
    try {
      const res = await fetch('/api/invoices?status=Erledigt');
      const data = await res.json();
      setInvoices(data ?? []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Derive available years from archived invoices (descending, newest year first)
  const availableYears = Array.from(
    new Set(
      invoices
        .map((inv) => {
          if (!inv.invoiceDate) return null;
          const d = new Date(inv.invoiceDate);
          if (isNaN(d.getTime())) return null;
          return d.getFullYear();
        })
        .filter((y): y is number => y !== null)
    )
  ).sort((a, b) => b - a);

  const filtered = invoices
    .filter((inv) => {
      // Year filter (applied first)
      if (yearFilter !== 'all') {
        if (!inv.invoiceDate) return false;
        const d = new Date(inv.invoiceDate);
        if (isNaN(d.getTime())) return false;
        if (String(d.getFullYear()) !== yearFilter) return false;
      }
      // Search filter
      const s = search.toLowerCase();
      if (!s) return true;
      return (
        (inv.invoiceNumber ?? '').toLowerCase().includes(s) ||
        (inv.customer?.name ?? '').toLowerCase().includes(s) ||
        (inv.customer?.customerNumber ?? '').toLowerCase().includes(s) ||
        (inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('de-CH') : '').includes(s) ||
        inv.items?.some((it: any) => (it.description ?? '').toLowerCase().includes(s))
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          return new Date(a.invoiceDate ?? 0).getTime() - new Date(b.invoiceDate ?? 0).getTime();
        case 'amount_desc':
          return Number(b.total ?? 0) - Number(a.total ?? 0);
        case 'amount_asc':
          return Number(a.total ?? 0) - Number(b.total ?? 0);
        case 'customer_az':
          return (a.customer?.name ?? '').localeCompare(b.customer?.name ?? '');
        case 'customer_za':
          return (b.customer?.name ?? '').localeCompare(a.customer?.name ?? '');
        case 'newest':
        default:
          return new Date(b.invoiceDate ?? 0).getTime() - new Date(a.invoiceDate ?? 0).getTime();
      }
    });

  const isFilterActive = yearFilter !== 'all' || search.trim().length > 0;

  // --- Export logic (independent from list filters) ---
  // Derive available months for the selected export year
  const availableExportMonths = useMemo(() => {
    if (!exportYear) return [];
    const y = parseInt(exportYear, 10);
    const months = new Set<number>();
    for (const inv of invoices) {
      if (!inv.invoiceDate) continue;
      const d = new Date(inv.invoiceDate);
      if (isNaN(d.getTime())) continue;
      if (d.getFullYear() === y) months.add(d.getMonth() + 1);
    }
    return Array.from(months).sort((a, b) => a - b);
  }, [invoices, exportYear]);

  // Count how many invoices match the current export filter (client-side preview)
  const exportPreview = useMemo(() => {
    let matched: Invoice[] = [];
    if (exportMode === 'year' && exportYear) {
      const y = parseInt(exportYear, 10);
      matched = invoices.filter((inv) => {
        if (!inv.invoiceDate) return false;
        const d = new Date(inv.invoiceDate);
        return !isNaN(d.getTime()) && d.getFullYear() === y;
      });
    } else if (exportMode === 'month' && exportYear && exportMonth) {
      const y = parseInt(exportYear, 10);
      const m = parseInt(exportMonth, 10);
      matched = invoices.filter((inv) => {
        if (!inv.invoiceDate) return false;
        const d = new Date(inv.invoiceDate);
        return !isNaN(d.getTime()) && d.getFullYear() === y && d.getMonth() + 1 === m;
      });
    } else if (exportMode === 'range' && exportDateFrom && exportDateTo) {
      const from = new Date(exportDateFrom);
      const to = new Date(exportDateTo);
      to.setHours(23, 59, 59, 999);
      matched = invoices.filter((inv) => {
        if (!inv.invoiceDate) return false;
        const d = new Date(inv.invoiceDate);
        return !isNaN(d.getTime()) && d >= from && d <= to;
      });
    }
    const total = matched.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
    return { count: matched.length, total };
  }, [invoices, exportMode, exportYear, exportMonth, exportDateFrom, exportDateTo]);

  const exportPeriodLabel = useMemo(() => {
    if (exportMode === 'year' && exportYear) return `Ganzes Jahr ${exportYear}`;
    if (exportMode === 'month' && exportYear && exportMonth) {
      return `${MONTH_NAMES[parseInt(exportMonth, 10) - 1]} ${exportYear}`;
    }
    if (exportMode === 'range' && exportDateFrom && exportDateTo) {
      return `${new Date(exportDateFrom).toLocaleDateString('de-CH')} – ${new Date(exportDateTo).toLocaleDateString('de-CH')}`;
    }
    return '';
  }, [exportMode, exportYear, exportMonth, exportDateFrom, exportDateTo]);

  const canExport = exportPreview.count > 0 && exportPreview.count <= MAX_BULK && !exporting;

  // Auto-set export year on first open if there's only one year
  useEffect(() => {
    if (exportOpen && !exportYear && availableYears.length > 0) {
      setExportYear(String(availableYears[0]));
    }
  }, [exportOpen, exportYear, availableYears]);

  const resetExportFilters = useCallback(() => {
    setExportYear(availableYears.length > 0 ? String(availableYears[0]) : '');
    setExportMonth('');
    setExportDateFrom('');
    setExportDateTo('');
    setExportMode('year');
  }, [availableYears]);

  const handleBulkExport = useCallback(async () => {
    if (exportLockRef.current || exporting) return;
    exportLockRef.current = true;
    setExporting(true);
    try {
      const body: any = {};
      if (exportMode === 'range') {
        body.dateFrom = exportDateFrom;
        body.dateTo = exportDateTo;
      } else {
        body.year = exportYear;
        if (exportMode === 'month' && exportMonth) body.month = exportMonth;
      }
      const res = await fetch('/api/invoices/bulk-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error || 'Export fehlgeschlagen');
        return;
      }
      // Check for partial failures
      const skippedCount = parseInt(res.headers.get('X-Skipped-Count') || '0', 10);
      const skippedInvoices = res.headers.get('X-Skipped-Invoices') || '';

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Extract filename from Content-Disposition or build one
      const cd = res.headers.get('Content-Disposition');
      const fnMatch = cd?.match(/filename="?([^"]+)"?/);
      a.download = fnMatch?.[1] || 'archiv_rechnungen.zip';
      a.click();
      URL.revokeObjectURL(url);

      if (skippedCount > 0) {
        toast.warning(`Export abgeschlossen. ${skippedCount} PDF(s) konnten nicht generiert werden: ${skippedInvoices}`, { duration: 8000 });
      } else {
        toast.success(`${exportPreview.count} Rechnungen als ZIP heruntergeladen`);
      }
    } catch {
      toast.error('Export fehlgeschlagen. Bitte später erneut versuchen.');
    } finally {
      setExporting(false);
      exportLockRef.current = false;
    }
  }, [exportMode, exportYear, exportMonth, exportDateFrom, exportDateTo, exporting, exportPreview.count]);

  const revert = async (id: string) => {
    if (!confirm('Rechnung zurück zu Rechnungen verschieben?')) return;
    await fetch(`/api/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Bezahlt' }) });
    toast.success('Rechnung zurück verschoben');
    load();
  };

  const downloadPdf = async (id: string) => {
    setDownloading(id);
    try {
      const res = await fetch(`/api/invoices/${id}/pdf?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'rechnung.pdf'; a.click(); URL.revokeObjectURL(url);
        toast.success('PDF heruntergeladen');
      } else toast.error('PDF-Fehler');
    } catch { toast.error('Fehler'); } finally { setDownloading(null); }
  };

  // Stage L: permanently remove an archived invoice. Soft-deletes via DELETE
  // /api/invoices/[id] (sets deletedAt). Both the archive list (filters
  // deletedAt=null) and the customer-deletion blocker count (also filters
  // deletedAt=null) automatically exclude this invoice afterwards, so the
  // customer can be deleted if this archived invoice was the only blocker.
  const deleteArchivedInvoice = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/invoices/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Archivierte Rechnung gelöscht');
        setDeleteTarget(null);
        load();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || 'Fehler beim Löschen');
      }
    } catch {
      toast.error('Fehler beim Löschen');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><Archive className="w-7 h-7 text-primary" /> Archivierte Rechnungen</h1>
        <p className="text-muted-foreground mt-1">
          {isFilterActive ? `${filtered.length} von ${invoices.length} archiviert` : `${invoices.length} archiviert`}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Name, Nr, Kunden-ID, Leistung..." className="pl-8 h-9 text-sm" value={search} onChange={(e: any) => setSearch(e?.target?.value ?? '')} />
        </div>
        <select
          className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
          value={yearFilter}
          onChange={(e: any) => setYearFilter(e?.target?.value ?? 'all')}
          aria-label="Jahr filtern"
        >
          <option value="all">Alle Jahre</option>
          {availableYears.map((y) => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </select>
        <select
          className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
          value={sortBy}
          onChange={(e: any) => setSortBy(e?.target?.value ?? 'newest')}
          aria-label="Sortierung"
        >
          <option value="newest">Neueste zuerst</option>
          <option value="oldest">Älteste zuerst</option>
          <option value="amount_desc">Betrag ↓</option>
          <option value="amount_asc">Betrag ↑</option>
          <option value="customer_az">Kunde A–Z</option>
          <option value="customer_za">Kunde Z–A</option>
        </select>
        <Button
          variant={exportOpen ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setExportOpen(!exportOpen)}
        >
          <FileArchive className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sammel-Export</span>
          <span className="sm:hidden">Export</span>
        </Button>
      </div>

      {/* ── Export Panel ── */}
      {exportOpen && (
        <Card className="border-primary/20 bg-primary/[0.02]">
          <CardContent className="px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <CalendarRange className="w-4 h-4 text-primary" />
                Rechnungen als ZIP exportieren
              </h3>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setExportOpen(false)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">
              Wähle einen Zeitraum. Der Export ist unabhängig von Suche und Sortierung oben.
            </p>

            {/* Mode tabs */}
            <div className="flex gap-1 rounded-lg bg-muted p-0.5">
              {([['year', 'Ganzes Jahr'], ['month', 'Monat'], ['range', 'Zeitraum']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-colors ${exportMode === mode ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => { setExportMode(mode); setExportMonth(''); setExportDateFrom(''); setExportDateTo(''); }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap gap-2 items-end">
              {(exportMode === 'year' || exportMode === 'month') && (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Jahr</label>
                  <select
                    className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9 min-w-[100px]"
                    value={exportYear}
                    onChange={(e: any) => { setExportYear(e?.target?.value ?? ''); setExportMonth(''); }}
                  >
                    <option value="">Jahr wählen</option>
                    {availableYears.map((y) => (
                      <option key={y} value={String(y)}>{y}</option>
                    ))}
                  </select>
                </div>
              )}
              {exportMode === 'month' && exportYear && (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground font-medium">Monat</label>
                  <select
                    className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9 min-w-[130px]"
                    value={exportMonth}
                    onChange={(e: any) => setExportMonth(e?.target?.value ?? '')}
                  >
                    <option value="">Monat wählen</option>
                    {availableExportMonths.map((m) => (
                      <option key={m} value={String(m)}>{MONTH_NAMES[m - 1]}</option>
                    ))}
                  </select>
                </div>
              )}
              {exportMode === 'range' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground font-medium">Von</label>
                    <input
                      type="date"
                      className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
                      value={exportDateFrom}
                      onChange={(e: any) => setExportDateFrom(e?.target?.value ?? '')}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground font-medium">Bis</label>
                    <input
                      type="date"
                      className="flex rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9"
                      value={exportDateTo}
                      onChange={(e: any) => setExportDateTo(e?.target?.value ?? '')}
                    />
                  </div>
                </>
              )}
              <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={resetExportFilters}>
                Zurücksetzen
              </Button>
            </div>

            {/* Export summary + action */}
            {exportPeriodLabel && (
              <div className="rounded-md border bg-background px-3 py-2.5 space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                  <span className="font-medium">{exportPeriodLabel}</span>
                  <span className="text-muted-foreground">
                    {exportPreview.count === 0
                      ? 'Keine Rechnungen'
                      : `${exportPreview.count} ${exportPreview.count === 1 ? 'Rechnung' : 'Rechnungen'}`}
                  </span>
                  {exportPreview.count > 0 && (
                    <span className="text-muted-foreground font-mono text-xs">
                      Total: CHF {exportPreview.total.toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  )}
                </div>

                {exportPreview.count > MAX_BULK && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded px-2.5 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Maximal {MAX_BULK} Rechnungen pro Export. Bitte einen kleineren Zeitraum wählen.</span>
                  </div>
                )}

                {exportPreview.count > 0 && exportPreview.count <= MAX_BULK && (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!canExport}
                    onClick={handleBulkExport}
                  >
                    {exporting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        PDFs werden generiert…
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        {exportPreview.count} {exportPreview.count === 1 ? 'Rechnung' : 'Rechnungen'} als ZIP herunterladen
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-1">
        {filtered.length === 0 ? <p className="text-center text-muted-foreground py-8">{invoices.length === 0 ? 'Keine archivierten Rechnungen vorhanden' : 'Keine Treffer für die aktuelle Auswahl'}</p> :
          filtered.map((inv, i) => {
            const itemDescs = inv.items?.map((it: any) => it.description).filter(Boolean).join(', ') || '–';
            return (
              <motion.div key={inv.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                <Card className="opacity-60 hover:opacity-85 transition-all">
                  <CardContent className="px-3 py-1.5">
                    {/* Desktop: single row */}
                    <div className="hidden sm:flex items-center gap-2 min-w-0">
                      <span className="text-[11px] text-muted-foreground shrink-0">{inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' }) : ''}</span>
                      <span className="font-mono text-[11px] text-muted-foreground shrink-0">{inv.invoiceNumber}</span>
                      <span className="text-xs font-medium shrink-0">{inv.customer?.name ?? ''}{inv.customer?.customerNumber ? ` (${inv.customer.customerNumber})` : ''}</span>
                      <span className="text-xs text-muted-foreground truncate min-w-0" title={itemDescs}>{itemDescs}</span>
                      <div className="flex-1" />
                      <span className="font-mono text-xs font-bold text-muted-foreground shrink-0">CHF {Number(inv.total ?? 0).toFixed(0)}</span>
                      <div className="flex gap-0.5 shrink-0">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => downloadPdf(inv.id)} disabled={downloading === inv.id}>
                          {downloading === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-orange-600 hover:bg-orange-50" onClick={() => revert(inv.id)} title="Zurück zu Rechnungen">
                          <Undo2 className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:bg-destructive/10"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(inv); }}
                          title="Archivierte Rechnung endgültig löschen"
                          aria-label="Archivierte Rechnung endgültig löschen"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {/* Mobile: two rows */}
                    <div className="sm:hidden space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[11px] text-muted-foreground shrink-0">{inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' }) : ''}</span>
                          <span className="font-mono text-[11px] text-muted-foreground shrink-0">{inv.invoiceNumber}</span>
                          <span className="text-xs font-medium truncate">{inv.customer?.name ?? ''}</span>
                        </div>
                        <span className="font-mono text-xs font-bold text-muted-foreground shrink-0">CHF {Number(inv.total ?? 0).toFixed(0)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground truncate">{itemDescs}</span>
                        <div className="flex gap-0.5 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadPdf(inv.id)} disabled={downloading === inv.id}>
                            {downloading === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-orange-600 hover:bg-orange-50" onClick={() => revert(inv.id)} title="Zurück zu Rechnungen">
                            <Undo2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(inv); }}
                            title="Archivierte Rechnung endgültig löschen"
                            aria-label="Archivierte Rechnung endgültig löschen"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
      </div>

      {/* Stage L (2026-04-25) — confirmation dialog for permanent invoice delete */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              Archivierte Rechnung endgültig löschen?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {deleteTarget && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">{deleteTarget.invoiceNumber}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {deleteTarget.invoiceDate ? new Date(deleteTarget.invoiceDate).toLocaleDateString('de-CH') : ''}
                  </span>
                </div>
                <div className="font-medium">
                  {deleteTarget.customer?.name ?? '–'}
                  {deleteTarget.customer?.customerNumber ? ` (${deleteTarget.customer.customerNumber})` : ''}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  CHF {Number(deleteTarget.total ?? 0).toFixed(2)}
                </div>
              </div>
            )}
            <p className="text-muted-foreground">
              Diese Aktion entfernt die Rechnung dauerhaft aus dem Archiv. Sie kann
              danach nicht mehr wiederhergestellt werden.
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Abbrechen
            </Button>
            <Button variant="destructive" onClick={deleteArchivedInvoice} disabled={deleting}>
              {deleting ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Löschen…</>
              ) : (
                <><Trash2 className="w-4 h-4 mr-1" />Endgültig löschen</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
