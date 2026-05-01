'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Shield, Activity, AlertTriangle, Search, ChevronLeft, ChevronRight, CheckCircle, XCircle, Users, KeyRound, LogIn, RefreshCw, Download, X, FileText, ScrollText, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const AREAS = ['', 'AUTH', 'CUSTOMERS', 'ORDERS', 'OFFERS', 'INVOICES', 'SERVICES', 'SETTINGS', 'UPLOAD', 'ACCOUNT', 'PAPIERKORB', 'WEBHOOK', 'PDF', 'COMPLIANCE'];
const AREA_LABELS: Record<string, string> = {
  AUTH: 'Auth', CUSTOMERS: 'Kunden', ORDERS: 'Aufträge', OFFERS: 'Angebote', INVOICES: 'Rechnungen',
  SERVICES: 'Leistungen', SETTINGS: 'Einstellungen', UPLOAD: 'Uploads', ACCOUNT: 'Konto',
  PAPIERKORB: 'Papierkorb', WEBHOOK: 'Webhook', PDF: 'PDF', COMPLIANCE: 'Datenschutz',
};

// Common action types grouped for the filter dropdown.
const ACTION_GROUPS: { label: string; actions: string[] }[] = [
  { label: 'Auth', actions: ['LOGIN', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'SIGNUP', 'PASSWORD_RESET', 'PASSWORD_RESET_REQUEST', 'PASSWORD_CHANGE', 'EMAIL_VERIFIED', 'SESSION_EXPIRED'] },
  { label: 'Kunden', actions: ['CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE', 'CUSTOMER_ARCHIVED', 'CUSTOMER_RESTORED', 'CUSTOMER_FIELDS_CLEARED', 'CUSTOMER_UPDATE_REJECTED', 'DUPLICATE_MERGED', 'MERGE_UNDONE'] },
  { label: 'Aufträge', actions: ['ORDER_CREATE', 'ORDER_UPDATE', 'ORDER_DELETE', 'ORDER_REVIEW_CLEARED'] },
  { label: 'Angebote', actions: ['OFFER_CREATE', 'OFFER_UPDATE', 'OFFER_DELETE', 'OFFER_CONVERTED_TO_INVOICE', 'OFFER_PDF_GENERATED', 'OFFER_PDF_DOWNLOADED', 'OFFER_PDF_SENT_TO_BUSINESS_WHATSAPP'] },
  { label: 'Rechnungen', actions: ['INVOICE_CREATE', 'INVOICE_UPDATE', 'INVOICE_DELETE', 'INVOICE_ARCHIVED', 'ARCHIVED_INVOICE_DELETED', 'INVOICE_PDF_GENERATED', 'INVOICE_PDF_DOWNLOADED', 'INVOICE_PDF_SENT_TO_BUSINESS_WHATSAPP'] },
  { label: 'Leistungen', actions: ['SERVICE_CREATE', 'SERVICE_UPDATE', 'SERVICE_DELETE'] },
  { label: 'WhatsApp/Audio', actions: ['WHATSAPP_MESSAGE_RECEIVED', 'WHATSAPP_IMAGE_RECEIVED', 'WHATSAPP_AUDIO_RECEIVED', 'AUDIO_TRANSCRIBED', 'AUDIO_SKIPPED_TOO_LONG', 'AUDIO_SKIPPED_QUOTA_EXCEEDED', 'AUDIO_QUOTA_CHECK_FAILED', 'IMAGE_PROCESSED', 'IMAGE_SKIPPED_OR_FAILED', 'LLM_EXTRACTION_STARTED', 'LLM_EXTRACTION_COMPLETED', 'LLM_EXTRACTION_FAILED', 'PHONE_MAPPING_SUCCESS', 'PHONE_MAPPING_FAILED'] },
  { label: 'Einstellungen', actions: ['SETTINGS_UPDATE', 'COMPANY_PROFILE_UPDATED', 'WHATSAPP_INTAKE_NUMBER_UPDATED', 'VAT_SETTINGS_UPDATED', 'LETTERHEAD_SETTINGS_UPDATED'] },
  { label: 'Datenschutz', actions: ['DATA_EXPORT_REQUESTED', 'DATA_EXPORT_PREPARED', 'DATA_EXPORT_PREPARE_FAILED', 'DATA_EXPORT_COMPLETED', 'DATA_DELETION_REQUESTED', 'DATA_DELETION_COMPLETED', 'ACCOUNT_CANCELLATION_REQUESTED', 'ACCOUNT_CANCELLED', 'AVV_ACCEPTED', 'PRIVACY_POLICY_ACCEPTED', 'TERMS_ACCEPTED', 'COMPLIANCE_REQUEST_CREATED', 'COMPLIANCE_REQUEST_UPDATED', 'COMPLIANCE_REQUEST_STATUS_UPDATED', 'COMPLIANCE_REQUEST_NOTE_UPDATED', 'COMPLIANCE_REQUEST_DUPLICATE_BLOCKED', 'COMPLIANCE_REQUEST_EMAIL_SENT', 'COMPLIANCE_REQUEST_EMAIL_FAILED', 'COMPLIANCE_REQUEST_USER_CONFIRMATION_SENT', 'COMPLIANCE_REQUEST_USER_CONFIRMATION_FAILED', 'ACCOUNT_DELETE', 'ACCOUNT_ACCESS_END_SET', 'ACCOUNT_ACCESS_END_CLEARED', 'ACCOUNT_BLOCKED', 'ACCOUNT_REACTIVATED', 'ACCOUNT_ANONYMIZATION_STARTED', 'ACCOUNT_ANONYMIZATION_COMPLETED', 'ACCOUNT_ANONYMIZATION_FAILED', 'LOGIN_BLOCKED_BY_STATUS', 'COMPLIANCE_DELETION_COMPLETION_BLOCKED'] },
];

const ACTION_COLORS: Record<string, string> = {
  LOGIN: 'bg-green-100 text-green-800', LOGIN_SUCCESS: 'bg-green-100 text-green-800', LOGIN_FAILED: 'bg-red-100 text-red-800', SIGNUP: 'bg-blue-100 text-blue-800',
  PASSWORD_RESET_REQUEST: 'bg-yellow-100 text-yellow-800', PASSWORD_RESET: 'bg-yellow-100 text-yellow-800',
  EMAIL_VERIFIED: 'bg-green-100 text-green-800', PASSWORD_CHANGE: 'bg-orange-100 text-orange-800',
  ACCOUNT_DELETE: 'bg-red-100 text-red-800',
  CUSTOMER_CREATE: 'bg-blue-100 text-blue-800', CUSTOMER_UPDATE: 'bg-amber-100 text-amber-800', CUSTOMER_DELETE: 'bg-red-100 text-red-800',
  ORDER_CREATE: 'bg-blue-100 text-blue-800', ORDER_UPDATE: 'bg-amber-100 text-amber-800', ORDER_DELETE: 'bg-red-100 text-red-800',
  OFFER_CREATE: 'bg-blue-100 text-blue-800', OFFER_UPDATE: 'bg-amber-100 text-amber-800', OFFER_DELETE: 'bg-red-100 text-red-800',
  INVOICE_CREATE: 'bg-blue-100 text-blue-800', INVOICE_UPDATE: 'bg-amber-100 text-amber-800', INVOICE_DELETE: 'bg-red-100 text-red-800',
  SETTINGS_UPDATE: 'bg-purple-100 text-purple-800', FILE_UPLOAD: 'bg-cyan-100 text-cyan-800',
  RESTORE: 'bg-green-100 text-green-800', PERMANENT_DELETE: 'bg-red-100 text-red-800',
  OFFER_PDF_GENERATED: 'bg-cyan-100 text-cyan-800', OFFER_PDF_DOWNLOADED: 'bg-cyan-100 text-cyan-800',
  INVOICE_PDF_GENERATED: 'bg-cyan-100 text-cyan-800', INVOICE_PDF_DOWNLOADED: 'bg-cyan-100 text-cyan-800',
  OFFER_PDF_SENT_TO_BUSINESS_WHATSAPP: 'bg-emerald-100 text-emerald-800',
  INVOICE_PDF_SENT_TO_BUSINESS_WHATSAPP: 'bg-emerald-100 text-emerald-800',
  DATA_EXPORT_REQUESTED: 'bg-indigo-100 text-indigo-800',
  DATA_EXPORT_PREPARED: 'bg-emerald-100 text-emerald-800',
  DATA_EXPORT_PREPARE_FAILED: 'bg-red-100 text-red-800',
  DATA_DELETION_REQUESTED: 'bg-rose-100 text-rose-800',
  ACCOUNT_CANCELLATION_REQUESTED: 'bg-rose-100 text-rose-800',
  PRIVACY_POLICY_ACCEPTED: 'bg-violet-100 text-violet-800',
  TERMS_ACCEPTED: 'bg-violet-100 text-violet-800',
  AVV_ACCEPTED: 'bg-violet-100 text-violet-800',
  COMPLIANCE_REQUEST_UPDATED: 'bg-purple-100 text-purple-800',
  COMPLIANCE_REQUEST_CREATED: 'bg-indigo-100 text-indigo-800',
  COMPLIANCE_REQUEST_STATUS_UPDATED: 'bg-purple-100 text-purple-800',
  COMPLIANCE_REQUEST_NOTE_UPDATED: 'bg-purple-100 text-purple-800',
  COMPLIANCE_REQUEST_DUPLICATE_BLOCKED: 'bg-amber-100 text-amber-800',
  COMPLIANCE_REQUEST_EMAIL_SENT: 'bg-emerald-100 text-emerald-800',
  COMPLIANCE_REQUEST_EMAIL_FAILED: 'bg-red-100 text-red-800',
  COMPLIANCE_REQUEST_USER_CONFIRMATION_SENT: 'bg-emerald-100 text-emerald-800',
  COMPLIANCE_REQUEST_USER_CONFIRMATION_FAILED: 'bg-red-100 text-red-800',
};

function formatDate(d: string) {
  return new Date(d).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function safeParse(s: string | null): any | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// ─── Detail Modal ─────────────────────────────────────────────────────────
function LogDetailModal({ log, onClose }: { log: any; onClose: () => void }) {
  if (!log) return null;
  const details = safeParse(log.details);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Audit-Detail</h3>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <div className="text-muted-foreground">Zeit</div><div className="col-span-2">{formatDate(log.createdAt)}</div>
            <div className="text-muted-foreground">Aktion</div><div className="col-span-2"><Badge variant="outline" className={`text-xs ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-800'}`}>{log.action}</Badge></div>
            <div className="text-muted-foreground">Bereich</div><div className="col-span-2">{AREA_LABELS[log.area] || log.area}</div>
            <div className="text-muted-foreground">Status</div><div className="col-span-2">{log.success ? <span className="text-green-700">Erfolg</span> : <span className="text-red-700">Fehler</span>}</div>
            <div className="text-muted-foreground">Quelle</div><div className="col-span-2">{log.source || '—'}</div>
            <div className="text-muted-foreground">Benutzer</div><div className="col-span-2">{log.userEmail || 'System'}{log.userRole ? ` (${log.userRole})` : ''}</div>
            <div className="text-muted-foreground">Ziel</div><div className="col-span-2">{log.targetType || '—'}{log.targetId ? ` • ${log.targetId}` : ''}</div>
            <div className="text-muted-foreground">IP</div><div className="col-span-2">{log.ipAddress || '—'}</div>
            <div className="text-muted-foreground">User-Agent</div><div className="col-span-2 break-all">{log.userAgent || '—'}</div>
            {log.errorMessage && (<><div className="text-muted-foreground">Fehler</div><div className="col-span-2 text-red-700 break-all">{log.errorMessage}</div></>)}
          </div>
          {details && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5 mt-2">Details</div>
              <pre className="bg-muted/40 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(details, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Security Overview (unchanged) ────────────────────────────────────────
function SecurityOverview({ stats }: { stats: any }) {
  if (!stats) return null;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Users className="w-5 h-5 mx-auto mb-1 text-blue-600" />
          <div className="text-2xl font-bold">{stats.userCount}</div>
          <div className="text-xs text-muted-foreground">Benutzer gesamt</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <AlertTriangle className={`w-5 h-5 mx-auto mb-1 ${stats.failedLogins24h > 0 ? 'text-red-600' : 'text-green-600'}`} />
          <div className="text-2xl font-bold">{stats.failedLogins24h}</div>
          <div className="text-xs text-muted-foreground">Fehlversuche (24h)</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <KeyRound className="w-5 h-5 mx-auto mb-1 text-amber-600" />
          <div className="text-2xl font-bold">{stats.passwordResets7d}</div>
          <div className="text-xs text-muted-foreground">PW-Resets (7 Tage)</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Activity className="w-5 h-5 mx-auto mb-1 text-purple-600" />
          <div className="text-2xl font-bold">{stats.totalLogs}</div>
          <div className="text-xs text-muted-foreground">Log-Einträge gesamt</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><LogIn className="w-4 h-4 text-green-600" /> Letzte Logins (7 Tage)</CardTitle></CardHeader>
        <CardContent>
          {stats.recentLogins.length === 0 ? <p className="text-sm text-muted-foreground">Keine Logins in den letzten 7 Tagen.</p> : (
            <div className="space-y-2">
              {stats.recentLogins.map((l: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-border/40 pb-1.5 last:border-0">
                  <span className="font-medium">{l.userEmail}</span>
                  <span className="text-muted-foreground text-xs">{formatDate(l.createdAt)}{l.ipAddress ? ` • ${l.ipAddress}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><XCircle className="w-4 h-4 text-red-600" /> Letzte Fehler (7 Tage)</CardTitle></CardHeader>
        <CardContent>
          {stats.recentErrors.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg p-3">
              <CheckCircle className="w-4 h-4" /> Keine Fehler in den letzten 7 Tagen.
            </div>
          ) : (
            <div className="space-y-2">
              {stats.recentErrors.map((e: any, i: number) => (
                <div key={i} className="text-sm border-b border-border/40 pb-1.5 last:border-0">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="bg-red-50 text-red-700 text-xs">{e.action}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(e.createdAt)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{e.userEmail || 'Unbekannt'} • {e.area}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Activity log viewer with action filter, detail modal, CSV export ───
function LogViewer() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ area: '', action: '', success: '', search: '', from: '', to: '' });
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  const [exporting, setExporting] = useState(false);

  const buildParams = useCallback((): URLSearchParams => {
    const params = new URLSearchParams();
    if (filters.area) params.set('area', filters.area);
    if (filters.action) params.set('action', filters.action);
    if (filters.success) params.set('success', filters.success);
    if (filters.search) params.set('search', filters.search);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    return params;
  }, [filters]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const params = buildParams();
    params.set('page', String(page));
    params.set('limit', '50');
    try {
      const res = await fetch(`/api/admin/logs?${params}`);
      const data = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, buildParams]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const resetFilters = () => { setFilters({ area: '', action: '', success: '', search: '', from: '', to: '' }); setPage(1); };

  const downloadCsv = async () => {
    setExporting(true);
    try {
      const params = buildParams();
      const res = await fetch(`/api/admin/audit-export?${params}`);
      if (!res.ok) {
        toast.error('CSV-Export fehlgeschlagen');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV heruntergeladen');
    } catch {
      toast.error('Fehler beim Export');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground mb-1 block">Suche</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input placeholder="E-Mail, Aktion, Details..." className="pl-8 h-9 text-sm" value={filters.search} onChange={(e) => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Bereich</label>
              <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={filters.area} onChange={(e) => { setFilters(f => ({ ...f, area: e.target.value })); setPage(1); }}>
                <option value="">Alle</option>
                {AREAS.filter(Boolean).map(a => <option key={a} value={a}>{AREA_LABELS[a] || a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Aktion</label>
              <select className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[200px]" value={filters.action} onChange={(e) => { setFilters(f => ({ ...f, action: e.target.value })); setPage(1); }}>
                <option value="">Alle</option>
                {ACTION_GROUPS.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.actions.map(a => <option key={a} value={a}>{a}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Status</label>
              <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={filters.success} onChange={(e) => { setFilters(f => ({ ...f, success: e.target.value })); setPage(1); }}>
                <option value="">Alle</option>
                <option value="true">Erfolg</option>
                <option value="false">Fehler</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Von</label>
              <Input type="date" className="h-9 text-sm w-[140px]" value={filters.from} onChange={(e) => { setFilters(f => ({ ...f, from: e.target.value })); setPage(1); }} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Bis</label>
              <Input type="date" className="h-9 text-sm w-[140px]" value={filters.to} onChange={(e) => { setFilters(f => ({ ...f, to: e.target.value })); setPage(1); }} />
            </div>
            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9"><RefreshCw className="w-3.5 h-3.5 mr-1" /> Reset</Button>
            <Button variant="outline" size="sm" onClick={downloadCsv} disabled={exporting} className="h-9"><Download className="w-3.5 h-3.5 mr-1" />{exporting ? 'Export …' : 'CSV-Export'}</Button>
          </div>
        </CardContent>
      </Card>

      <div className="text-sm text-muted-foreground">{total} Einträge gefunden</div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center text-muted-foreground py-8">Laden...</div>
        ) : logs.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">Keine Log-Einträge gefunden.</div>
        ) : logs.map((log) => (
          <Card key={log.id} className={`${!log.success ? 'border-red-200 bg-red-50/30' : ''} cursor-pointer hover:bg-muted/30 transition-colors`} onClick={() => setSelectedLog(log)}>
            <CardContent className="py-3 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={`text-xs ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-800'}`}>{log.action}</Badge>
                    <Badge variant="outline" className="text-xs">{AREA_LABELS[log.area] || log.area}</Badge>
                    {!log.success && <Badge variant="destructive" className="text-xs">Fehler</Badge>}
                    {log.source && <Badge variant="outline" className="text-[10px] uppercase">{log.source}</Badge>}
                  </div>
                  <div className="text-sm mt-1">
                    <span className="font-medium">{log.userEmail || 'System'}</span>
                    {log.targetType && <span className="text-muted-foreground"> • {log.targetType}{log.targetId ? ` #${log.targetId.slice(-6)}` : ''}</span>}
                  </div>
                  {log.details && (() => {
                    const d = safeParse(log.details);
                    if (!d) return null;
                    const preview = Object.entries(d).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' • ');
                    return <div className="text-xs text-muted-foreground mt-1 truncate">{preview}</div>;
                  })()}
                </div>
                <div className="text-xs text-muted-foreground text-right whitespace-nowrap">
                  <div>{formatDate(log.createdAt)}</div>
                  {log.ipAddress && <div className="mt-0.5">{log.ipAddress}</div>}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm text-muted-foreground">Seite {page} von {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}

      {selectedLog && <LogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
}

// ─── Compliance Tab: requests + consent ──────────────────────────────────
function ComplianceTab() {
  const [requests, setRequests] = useState<any[]>([]);
  const [consent, setConsent] = useState<any[]>([]);
  // Standalone user results (users without compliance requests, found via /api/admin/users)
  const [standaloneUsers, setStandaloneUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  // Block T-fix — Suchfeld + Datumsfilter (server-seitig).
  const [searchQuery, setSearchQuery] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [exportingId, setExportingId] = useState<string | null>(null);
  // Block U — Konto-Steuerung (Sperren / Reaktivieren / Anonymisieren / Stichtag)
  const [actingReqId, setActingReqId] = useState<string | null>(null);
  const [accessDates, setAccessDates] = useState<Record<string, string>>({});
  const [anonOpenForReqId, setAnonOpenForReqId] = useState<string | null>(null);
  const [anonConfirmText, setAnonConfirmText] = useState('');
  // Standalone user account action state (keyed by user id)
  const [actingUserId, setActingUserId] = useState<string | null>(null);
  const [userAccessDates, setUserAccessDates] = useState<Record<string, string>>({});
  const [anonOpenForUserId, setAnonOpenForUserId] = useState<string | null>(null);
  const [userAnonConfirmText, setUserAnonConfirmText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('type', filterType);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (filterFrom) params.set('from', filterFrom);
      if (filterTo) params.set('to', filterTo);

      // Parallel fetch: compliance requests + consent + (if searching) users
      const fetches: Promise<any>[] = [
        fetch(`/api/admin/compliance/requests?${params}`).then(r => r.json()),
        fetch('/api/admin/compliance/consent').then(r => r.json()),
      ];
      // When a search query is active, also search users directly so that
      // users without compliance requests are visible and manageable.
      if (searchQuery.trim()) {
        fetches.push(
          fetch(`/api/admin/users?q=${encodeURIComponent(searchQuery.trim())}`).then(r => r.json()),
        );
      }
      const results = await Promise.all(fetches);
      const complianceItems: any[] = results[0].items || [];
      setRequests(complianceItems);
      setConsent(results[1].records || []);

      // Derive standalone users: users from the user search that do NOT
      // appear in any compliance request result. This ensures a newly
      // registered user (who has no compliance request) is visible.
      if (results[2]) {
        const allUsers: any[] = results[2].users || [];
        const requestUserIds = new Set(complianceItems.map((r: any) => r.user?.id).filter(Boolean));
        setStandaloneUsers(allUsers.filter((u: any) => !requestUserIds.has(u.id)));
      } else {
        setStandaloneUsers([]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [filterStatus, filterType, searchQuery, filterFrom, filterTo]);

  // Reload nur bei Filteränderungen, nicht bei jedem Tipper im Suchfeld.
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 300);
    return () => clearTimeout(t);
  }, [load]);

  const resetFilters = () => {
    setSearchQuery('');
    setFilterFrom('');
    setFilterTo('');
    setFilterStatus('');
    setFilterType('');
  };

  const startEdit = (req: any) => {
    setEditId(req.id);
    setEditStatus(req.status);
    setEditNotes(req.adminNotes || '');
  };

  const saveEdit = async () => {
    if (!editId) return;
    try {
      const res = await fetch(`/api/admin/compliance/requests/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: editStatus, adminNotes: editNotes }),
      });
      if (res.ok) {
        toast.success('Anfrage aktualisiert');
        setEditId(null);
        load();
      } else {
        // Block U — Server kann 409 zurückgeben, wenn Löschanfrage nicht abgeschlossen werden darf
        // (Konto wurde noch nicht anonymisiert). Detail aus Antwort lesen.
        let msg = 'Fehler beim Speichern';
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch { /* ignore */ }
        toast.error(msg);
      }
    } catch {
      toast.error('Fehler');
    }
  };

  // Block U — Konto-Steuerungs-API-Aufrufe
  const callAccountAction = async (
    userId: string,
    op: 'access' | 'block' | 'unblock' | 'anonymize',
    body: any,
    reqId: string,
    successMsg: string,
  ) => {
    setActingReqId(reqId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/${op}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(successMsg);
        load();
        return true;
      }
      let msg = 'Aktion fehlgeschlagen';
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch { /* ignore */ }
      toast.error(msg);
      return false;
    } catch {
      toast.error('Netzwerk-Fehler');
      return false;
    } finally {
      setActingReqId(null);
    }
  };

  // ─── Standalone user account action helpers (no compliance request) ───
  const callUserAction = async (
    userId: string,
    op: 'access' | 'block' | 'unblock' | 'anonymize',
    body: any,
    successMsg: string,
  ) => {
    setActingUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/${op}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(successMsg);
        load();
        return true;
      }
      let msg = 'Aktion fehlgeschlagen';
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch { /* ignore */ }
      toast.error(msg);
      return false;
    } catch {
      toast.error('Netzwerk-Fehler');
      return false;
    } finally {
      setActingUserId(null);
    }
  };

  const onUserSetAccessEnd = async (u: any) => {
    const isoDate = userAccessDates[u.id];
    if (!isoDate) { toast.error('Bitte Stichtag wählen'); return; }
    const accessEndsAt = new Date(`${isoDate}T23:59:59`).toISOString();
    await callUserAction(u.id, 'access', { accessEndsAt }, 'Stichtag gespeichert');
  };

  const onUserClearAccessEnd = async (u: any) => {
    if (!confirm('Stichtag entfernen und Konto wieder aktiv setzen?')) return;
    await callUserAction(u.id, 'access', { accessEndsAt: null }, 'Stichtag entfernt');
    setUserAccessDates(prev => ({ ...prev, [u.id]: '' }));
  };

  const onUserBlock = async (u: any) => {
    if (!confirm(`Konto von ${u.email} sofort sperren?\nDer Nutzer kann sich nicht mehr anmelden, bis das Konto wieder reaktiviert wird.`)) return;
    await callUserAction(u.id, 'block', { reason: 'Administrative Sperrung' }, 'Konto gesperrt');
  };

  const onUserUnblock = async (u: any) => {
    if (!confirm(`Konto von ${u.email} reaktivieren?`)) return;
    await callUserAction(u.id, 'unblock', {}, 'Konto reaktiviert');
  };

  const onUserAnonymize = async (u: any) => {
    if (userAnonConfirmText !== 'ANONYMISIEREN') {
      toast.error('Bitte „ANONYMISIEREN" exakt eingeben.');
      return;
    }
    const ok = await callUserAction(u.id, 'anonymize', { confirm: 'ANONYMISIEREN' }, 'Konto anonymisiert');
    if (ok) {
      setAnonOpenForUserId(null);
      setUserAnonConfirmText('');
    }
  };

  const onSetAccessEnd = async (req: any) => {
    if (!req.user?.id) { toast.error('Kein User'); return; }
    const isoDate = accessDates[req.id];
    if (!isoDate) { toast.error('Bitte Stichtag wählen'); return; }
    // Verwendung 23:59:59 lokal als logisches Tagesende.
    const accessEndsAt = new Date(`${isoDate}T23:59:59`).toISOString();
    await callAccountAction(req.user.id, 'access', { accessEndsAt, requestId: req.id }, req.id, 'Stichtag gespeichert');
  };

  const onClearAccessEnd = async (req: any) => {
    if (!req.user?.id) { toast.error('Kein User'); return; }
    if (!confirm('Stichtag entfernen und Konto wieder aktiv setzen?')) return;
    await callAccountAction(req.user.id, 'access', { accessEndsAt: null, requestId: req.id }, req.id, 'Stichtag entfernt');
    setAccessDates(prev => ({ ...prev, [req.id]: '' }));
  };

  const onBlock = async (req: any) => {
    if (!req.user?.id) { toast.error('Kein User'); return; }
    if (!confirm(`Konto von ${req.user.email} sofort sperren?\nDer Nutzer kann sich nicht mehr anmelden, bis das Konto wieder reaktiviert wird.`)) return;
    const reason =
      req.type === 'data_deletion' ? 'Sperrung wegen Löschanfrage' :
      req.type === 'account_cancellation' ? 'Sperrung wegen Kündigung' :
      'Administrative Sperrung';
    await callAccountAction(req.user.id, 'block', { reason, requestId: req.id }, req.id, 'Konto gesperrt');
  };

  const onUnblock = async (req: any) => {
    if (!req.user?.id) { toast.error('Kein User'); return; }
    if (!confirm(`Konto von ${req.user.email} reaktivieren?`)) return;
    await callAccountAction(req.user.id, 'unblock', { requestId: req.id }, req.id, 'Konto reaktiviert');
  };

  const openAnonymizeModal = (req: any) => {
    setAnonOpenForReqId(req.id);
    setAnonConfirmText('');
  };

  const onAnonymize = async (req: any) => {
    if (!req.user?.id) { toast.error('Kein User'); return; }
    if (anonConfirmText !== 'ANONYMISIEREN') {
      toast.error('Bitte „ANONYMISIEREN" exakt eingeben.');
      return;
    }
    const ok = await callAccountAction(
      req.user.id,
      'anonymize',
      { confirm: 'ANONYMISIEREN', requestId: req.id },
      req.id,
      'Konto anonymisiert',
    );
    if (ok) {
      setAnonOpenForReqId(null);
      setAnonConfirmText('');
    }
  };

  // Block T — Admin-only data-export ZIP. Only available for type=data_export.
  // The endpoint returns a ZIP blob; we download via a temporary <a> click and
  // never log or display any of the export contents. The request status is
  // bumped open→in_progress server-side and an admin note is appended.
  const runExport = async (req: any) => {
    if (req.type !== 'data_export') return;
    setExportingId(req.id);
    try {
      const res = await fetch(`/api/admin/compliance/requests/${req.id}/export`, { method: 'POST' });
      if (!res.ok) {
        let msg = 'Export konnte nicht erstellt werden.';
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch { /* ignore */ }
        toast.error(msg);
        return;
      }
      // Extract filename from Content-Disposition (server uses RFC 5987 encoding).
      const cd = res.headers.get('Content-Disposition') || '';
      let filename = `smartflow-datenexport-${req.id}.zip`;
      const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
      const plainMatch = cd.match(/filename="([^"]+)"/i);
      if (utf8Match?.[1]) {
        try { filename = decodeURIComponent(utf8Match[1]); } catch { /* ignore */ }
      } else if (plainMatch?.[1]) {
        filename = plainMatch[1];
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Slight delay before revoking to ensure the download has been initiated.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Export erstellt und heruntergeladen.');
      load();
    } catch (e) {
      toast.error('Fehler beim Erstellen des Exports.');
    } finally {
      setExportingId(null);
    }
  };

  const typeLabel = (t: string) =>
    t === 'data_export' ? 'Datenexport' :
    t === 'data_deletion' ? 'Löschung' :
    t === 'account_cancellation' ? 'Kündigung' : t;

  const statusBadge = (s: string) => {
    const cls =
      s === 'open' ? 'bg-yellow-100 text-yellow-800' :
      s === 'in_progress' ? 'bg-blue-100 text-blue-800' :
      s === 'completed' ? 'bg-green-100 text-green-800' :
      s === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800';
    return <Badge variant="outline" className={`text-xs ${cls}`}>{s}</Badge>;
  };

  const consentLabel = (t: string) =>
    t === 'privacy' ? 'Datenschutzerklärung' :
    t === 'terms' ? 'AGB / Terms' :
    t === 'avv' ? 'AVV' : t;

  // Block U — Effektiver Konto-Status (gleich wie lib/account-status.ts auf Server).
  const effectiveAccountStatus = (u: any): 'active' | 'cancelled_active' | 'cancelled_expired' | 'blocked' | 'anonymized' => {
    if (!u) return 'active';
    if (u.anonymizedAt) return 'anonymized';
    if (u.accountStatus === 'anonymized') return 'anonymized';
    if (u.accountStatus === 'blocked' || u.blockedAt) return 'blocked';
    if (u.accessEndsAt) {
      const t = new Date(u.accessEndsAt).getTime();
      if (!Number.isNaN(t) && t < Date.now()) return 'cancelled_expired';
      return 'cancelled_active';
    }
    return 'active';
  };

  const accountStatusBadge = (u: any) => {
    const s = effectiveAccountStatus(u);
    const map: Record<string, { label: string; cls: string }> = {
      active: { label: 'Konto: aktiv', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
      cancelled_active: { label: 'Konto: gekündigt (aktiv bis Stichtag)', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
      cancelled_expired: { label: 'Konto: Stichtag abgelaufen', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
      blocked: { label: 'Konto: gesperrt', cls: 'bg-red-100 text-red-900 border-red-300' },
      anonymized: { label: 'Konto: anonymisiert', cls: 'bg-neutral-800 text-white border-neutral-900' },
    };
    const m = map[s];
    return <Badge variant="outline" className={`text-xs ${m.cls}`}>{m.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Block R — Operator-Hilfetext: Bearbeitungs-Schritte je Anfragetyp.
          Kein Auto-Export / Auto-Delete; Operator führt jede Anfrage manuell
          unter Wahrung der gesetzlichen Aufbewahrungspflichten aus. */}
      <Card className="border-amber-200 bg-amber-50/40">
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Info className="w-4 h-4 text-amber-700" /> Hinweise zur Bearbeitung von Compliance-Anfragen</CardTitle></CardHeader>
        <CardContent className="text-sm text-amber-900 space-y-3">
          <p className="text-xs">Diese Anfragen werden nicht automatisch ausgeführt. Operator-Pflichten je Typ:</p>
          <details className="rounded border border-amber-200 bg-white px-3 py-2">
            <summary className="cursor-pointer font-medium">Datenexport (data_export)</summary>
            <ol className="list-decimal pl-5 mt-2 space-y-1 text-xs">
              <li>User-Identität bestätigen (E-Mail / ggf. Rückruf).</li>
              <li>Button <em>„Export erstellen"</em> klicken — erstellt automatisch ein ZIP mit allen Kunden-, Auftrags-, Angebots-, Rechnungs-, Leistungs-, Consent-, Audit- und Medien-Referenz-Daten dieses Users. Status wird automatisch auf <em>In Bearbeitung</em> gesetzt und eine Admin-Notiz mit Zeitstempel angefügt.</li>
              <li>ZIP verschlüsselt (z.B. via passwortgeschützten Cloud-Link) an die hinterlegte E-Mail des Users senden.</li>
              <li>Status auf <em>Abgeschlossen</em> setzen, Übermittlungsweg/-zeitpunkt in <em>Admin-Notiz</em> ergänzen.</li>
              <li>Hinweis: Medien-Dateien (Bilder/Audio) sind als Referenzen im ZIP enthalten, aber nicht als physische Dateien. Bei Bedarf separat aus dem Cloud-Storage bereitstellen.</li>
            </ol>
          </details>
          <details className="rounded border border-amber-200 bg-white px-3 py-2">
            <summary className="cursor-pointer font-medium">Löschung (data_deletion)</summary>
            <ol className="list-decimal pl-5 mt-2 space-y-1 text-xs">
              <li>Aufbewahrungspflichten prüfen (CH: 10 Jahre für Buchhaltung — Rechnungen / Geschäftskorrespondenz dürfen meist nicht sofort gelöscht werden).</li>
              <li>Nicht-pflichtige Daten löschen (z.B. Marketing, freiwillige Eingaben), pflichtige Daten anonymisieren oder verschlossen halten.</li>
              <li>Status auf <em>Abgeschlossen</em> oder <em>Abgelehnt</em> (mit Begründung in Admin-Notiz) setzen.</li>
              <li>Schriftliche Bestätigung an User mit aufgezählten gelöschten / aufbewahrten Datenklassen.</li>
            </ol>
          </details>
          <details className="rounded border border-amber-200 bg-white px-3 py-2">
            <summary className="cursor-pointer font-medium">Kündigung (account_cancellation)</summary>
            <ol className="list-decimal pl-5 mt-2 space-y-1 text-xs">
              <li>Vertragslaufzeit / Kündigungsfrist prüfen, ggf. Bestätigung mit Stichtag versenden.</li>
              <li>Offene Rechnungen klären.</li>
              <li>Account zum Stichtag deaktivieren (User-Login sperren), Daten gemäss Aufbewahrungspflicht weiterhin sichern.</li>
              <li>Status auf <em>Abgeschlossen</em> setzen, Stichtag in Admin-Notiz festhalten.</li>
            </ol>
          </details>
          <p className="text-xs italic">Jede Statusänderung und jede Notiz wird automatisch im Audit-Log erfasst (Tab <em>Logs</em>).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4 text-amber-600" /> Anfragen (Export / Löschung / Kündigung)</CardTitle></CardHeader>
        <CardContent>
          {/* Block T-fix — Filter-/Such-Leiste */}
          <div className="space-y-2 mb-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Suche nach E-Mail, Name, Firma oder Request-ID"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">Alle Status</option>
                <option value="open">Offen</option>
                <option value="in_progress">In Bearbeitung</option>
                <option value="completed">Abgeschlossen</option>
                <option value="rejected">Abgelehnt</option>
              </select>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="">Alle Typen</option>
                <option value="data_export">Datenexport</option>
                <option value="data_deletion">Löschung</option>
                <option value="account_cancellation">Kündigung</option>
              </select>
              <Button variant="ghost" size="sm" onClick={load} className="h-9">
                <RefreshCw className="w-3.5 h-3.5 mr-1" />Aktualisieren
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground">Datum:</span>
              <Input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="h-9 w-auto"
                aria-label="Von"
              />
              <span className="text-xs text-muted-foreground">bis</span>
              <Input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="h-9 w-auto"
                aria-label="Bis"
              />
              {(searchQuery || filterFrom || filterTo || filterStatus || filterType) && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9 text-xs">
                  <X className="w-3.5 h-3.5 mr-1" />Filter zurücksetzen
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {requests.length} Eintrag{requests.length === 1 ? '' : 'e'}
              </span>
            </div>
          </div>
          {loading ? <div className="text-center text-muted-foreground py-6">Laden...</div>
          : requests.length === 0 ? <div className="text-center text-muted-foreground py-6">Keine Compliance-Anfragen{searchQuery.trim() ? ' für diese Suche' : ''}.</div>
          : (
            <div className="space-y-2">
              {requests.map((req: any) => {
                const u = req.user || {};
                const accStatus = effectiveAccountStatus(u);
                const isAnonymized = accStatus === 'anonymized';
                const isBlocked = accStatus === 'blocked';
                const isActing = actingReqId === req.id;
                // Block U — Admin-Rolle ist in DB lowercase 'admin'; Vergleich case-insensitive.
                const isAdminTarget = (u.role || '').toLowerCase() === 'admin';
                const accDateValue = accessDates[req.id] ?? (u.accessEndsAt ? new Date(u.accessEndsAt).toISOString().slice(0, 10) : '');
                return (
                <div key={req.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs bg-indigo-100 text-indigo-800">{typeLabel(req.type)}</Badge>
                      {statusBadge(req.status)}
                      {/* Block U — Konto-Status-Chip */}
                      {accountStatusBadge(u)}
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 justify-end">
                      <span>angefordert: {formatDate(req.requestedAt)}</span>
                      {/* Block T-fix — zuletzt geändert anzeigen wenn != requestedAt */}
                      {req.updatedAt && req.updatedAt !== req.requestedAt && (
                        <span>zuletzt geändert: {formatDate(req.updatedAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">{u.email || '—'}</span>
                    {u.name && <span className="text-muted-foreground"> • {u.name}</span>}
                    {/* Block T-fix — Firma anzeigen, wenn vorhanden */}
                    {req.companyName && <span className="text-muted-foreground"> • {req.companyName}</span>}
                    {isAdminTarget && <Badge variant="outline" className="ml-2 text-[10px] bg-purple-100 text-purple-800 border-purple-200">Admin</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">ID: {req.id}</div>
                  {req.notes && <div className="text-xs text-muted-foreground border-l-2 border-muted pl-2">{req.notes}</div>}
                  {req.adminNotes && <div className="text-xs bg-amber-50 text-amber-900 rounded p-2"><strong>Admin-Notiz:</strong> {req.adminNotes}</div>}

                  {/* Block U — Konto-Status-Details */}
                  {(u.accessEndsAt || u.blockedAt || u.anonymizedAt) && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground border-l-2 border-rose-200 pl-2">
                      {u.accessEndsAt && <span>Stichtag: <strong>{formatDate(u.accessEndsAt)}</strong></span>}
                      {u.cancellationAcceptedAt && <span>Kündigung akzeptiert: {formatDate(u.cancellationAcceptedAt)}</span>}
                      {u.blockedAt && <span className="text-red-700">Gesperrt seit: {formatDate(u.blockedAt)}{u.blockedReason ? ` (${u.blockedReason})` : ''}</span>}
                      {u.anonymizedAt && <span className="text-neutral-900">Anonymisiert: {formatDate(u.anonymizedAt)}</span>}
                      {u.deletionCompletedAt && !u.anonymizedAt && <span>Löschung abgeschlossen: {formatDate(u.deletionCompletedAt)}</span>}
                    </div>
                  )}

                  {/* Block T-auto — Datenexport-Pipeline-Status (automatische Vorbereitung) */}
                  {req.type === 'data_export' && (req.exportReadyAt || req.exportExpiresAt || req.downloadedAt || req.exportGenerationError) && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground border-l-2 border-indigo-200 pl-2">
                      {req.exportReadyAt && <span>Bereit: {formatDate(req.exportReadyAt)}</span>}
                      {req.exportExpiresAt && <span>Läuft ab: {formatDate(req.exportExpiresAt)}</span>}
                      {req.downloadedAt && <span>Heruntergeladen: {formatDate(req.downloadedAt)}</span>}
                      {req.exportGenerationError && (
                        <span className="text-red-700 bg-red-50 rounded px-1.5">Fehler: {req.exportGenerationError}</span>
                      )}
                    </div>
                  )}

                  {/* Block U — Anonymisierungs-Bestätigung (Modal-artig inline) */}
                  {anonOpenForReqId === req.id && (
                    <div className="border-2 border-red-300 rounded-md bg-red-50 p-3 space-y-2">
                      <div className="text-sm font-semibold text-red-900 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        Anonymisierung bestätigen
                      </div>
                      <p className="text-xs text-red-900">
                        Diese Aktion ist <strong>endgültig</strong>. Persönliche Daten des Nutzers werden entfernt und durch generische Werte ersetzt.
                        Geschäftliche Belege (Rechnungen, Aufträge, Audit-Log) bleiben aus rechtlichen Gründen erhalten, sind aber nicht mehr personenbezogen.
                      </p>
                      <p className="text-xs text-red-900">
                        Tippen Sie <code className="bg-white px-1 rounded">ANONYMISIEREN</code> ein, um zu bestätigen.
                      </p>
                      <Input
                        value={anonConfirmText}
                        onChange={(e) => setAnonConfirmText(e.target.value)}
                        placeholder="ANONYMISIEREN"
                        className="h-9 bg-white"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onAnonymize(req)}
                          disabled={anonConfirmText !== 'ANONYMISIEREN' || isActing}
                        >
                          {isActing ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Wird ausgeführt...</> : 'Endgültig anonymisieren'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setAnonOpenForReqId(null); setAnonConfirmText(''); }}>Abbrechen</Button>
                      </div>
                    </div>
                  )}

                  {editId === req.id ? (
                    <div className="space-y-2 pt-2 border-t">
                      <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                        <option value="open">Offen</option>
                        <option value="in_progress">In Bearbeitung</option>
                        <option value="completed">Abgeschlossen</option>
                        <option value="rejected">Abgelehnt</option>
                      </select>
                      <textarea className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" rows={2} placeholder="Admin-Notiz (intern)" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveEdit}>Speichern</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Abbrechen</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => startEdit(req)}>Status / Notiz bearbeiten</Button>
                        {req.type === 'data_export' && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => runExport(req)}
                            disabled={exportingId === req.id}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            title="ZIP-Datenexport für diesen Benutzer erstellen und herunterladen"
                          >
                            {exportingId === req.id ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                Wird erstellt...
                              </>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5 mr-1.5" />
                                Export erstellen
                              </>
                            )}
                          </Button>
                        )}
                      </div>

                      {/* Block U — Konto-Aktionen je nach Anfragetyp.
                          Datenexport: keine Konto-Aktionen.
                          Kündigung: Stichtag + Sperren / Reaktivieren.
                          Löschung: Sperren / Reaktivieren + Anonymisieren. */}
                      {req.type !== 'data_export' && u.id && !isAnonymized && (
                        <div className="space-y-2 rounded-md bg-slate-50 border border-slate-200 p-2">
                          <div className="text-xs font-medium text-slate-700 flex items-center gap-1">
                            <Shield className="w-3.5 h-3.5" /> Konto-Aktionen
                          </div>

                          {req.type === 'account_cancellation' && (
                            <div className="flex flex-wrap items-end gap-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-[11px] text-muted-foreground">Zugriff bis (Stichtag)</label>
                                <Input
                                  type="date"
                                  value={accDateValue}
                                  onChange={(e) => setAccessDates(prev => ({ ...prev, [req.id]: e.target.value }))}
                                  className="h-9 w-auto"
                                  disabled={isActing || isAdminTarget}
                                />
                              </div>
                              <Button size="sm" variant="default" onClick={() => onSetAccessEnd(req)} disabled={isActing || isAdminTarget || !accDateValue}>
                                {isActing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Stichtag speichern'}
                              </Button>
                              {u.accessEndsAt && (
                                <Button size="sm" variant="outline" onClick={() => onClearAccessEnd(req)} disabled={isActing || isAdminTarget}>
                                  Stichtag entfernen
                                </Button>
                              )}
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2">
                            {!isBlocked && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                                onClick={() => onBlock(req)}
                                disabled={isActing || isAdminTarget}
                                title={isAdminTarget ? 'Admin-Konten können nicht über Compliance-Anfragen gesperrt werden.' : 'Konto sofort sperren — Login wird verhindert'}
                              >
                                {isActing ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5 mr-1.5" />}
                                Konto sofort sperren
                              </Button>
                            )}
                            {isBlocked && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                onClick={() => onUnblock(req)}
                                disabled={isActing}
                                title="Konto wieder aktiv setzen (Login erlaubt)"
                              >
                                {isActing ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 mr-1.5" />}
                                Konto reaktivieren
                              </Button>
                            )}

                            {req.type === 'data_deletion' && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => openAnonymizeModal(req)}
                                disabled={isActing || isAdminTarget}
                                title={isAdminTarget ? 'Admin-Konten können nicht anonymisiert werden.' : 'Persönliche Daten anonymisieren (endgültig)'}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
                                Daten anonymisieren
                              </Button>
                            )}
                          </div>

                          {isAdminTarget && (
                            <p className="text-[11px] text-amber-700 italic">
                              Hinweis: Admin-Konten können hier nicht gesperrt oder anonymisiert werden — bitte zuerst die Admin-Rolle entziehen.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Standalone user results (users without compliance requests) ─── */}
      {standaloneUsers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" /> Benutzerkonten (ohne offene Anfrage)
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Diese Benutzer haben keine Compliance-Anfrage, sind aber über die Suche gefunden worden.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {standaloneUsers.map((u: any) => {
                const accStatus = effectiveAccountStatus(u);
                const isAnonymized = accStatus === 'anonymized';
                const isBlocked = accStatus === 'blocked';
                const isActing = actingUserId === u.id;
                const isAdminTarget = (u.role || '').toLowerCase() === 'admin';
                const accDateValue = userAccessDates[u.id] ?? (u.accessEndsAt ? new Date(u.accessEndsAt).toISOString().slice(0, 10) : '');
                return (
                  <div key={u.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {accountStatusBadge(u)}
                        {u.emailVerified && <Badge variant="outline" className="text-[10px] bg-green-100 text-green-800 border-green-200">E-Mail bestätigt</Badge>}
                        {!u.emailVerified && <Badge variant="outline" className="text-[10px] bg-yellow-100 text-yellow-800 border-yellow-200">E-Mail nicht bestätigt</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        registriert: {formatDate(u.createdAt)}
                      </div>
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">{u.email || '—'}</span>
                      {u.name && <span className="text-muted-foreground"> • {u.name}</span>}
                      {isAdminTarget && <Badge variant="outline" className="ml-2 text-[10px] bg-purple-100 text-purple-800 border-purple-200">Admin</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">User-ID: {u.id}</div>

                    {/* Account status details */}
                    {(u.accessEndsAt || u.blockedAt || u.anonymizedAt) && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground border-l-2 border-rose-200 pl-2">
                        {u.accessEndsAt && <span>Stichtag: <strong>{formatDate(u.accessEndsAt)}</strong></span>}
                        {u.cancellationAcceptedAt && <span>Kündigung akzeptiert: {formatDate(u.cancellationAcceptedAt)}</span>}
                        {u.blockedAt && <span className="text-red-700">Gesperrt seit: {formatDate(u.blockedAt)}{u.blockedReason ? ` (${u.blockedReason})` : ''}</span>}
                        {u.anonymizedAt && <span className="text-neutral-900">Anonymisiert: {formatDate(u.anonymizedAt)}</span>}
                        {u.deletionCompletedAt && !u.anonymizedAt && <span>Löschung abgeschlossen: {formatDate(u.deletionCompletedAt)}</span>}
                      </div>
                    )}

                    {/* Anonymization confirmation inline modal */}
                    {anonOpenForUserId === u.id && (
                      <div className="border-2 border-red-300 rounded-md bg-red-50 p-3 space-y-2">
                        <div className="text-sm font-semibold text-red-900 flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4" />
                          Anonymisierung bestätigen
                        </div>
                        <p className="text-xs text-red-900">
                          Diese Aktion ist <strong>endgültig</strong>. Persönliche Daten des Nutzers werden entfernt und durch generische Werte ersetzt.
                          Geschäftliche Belege (Rechnungen, Aufträge, Audit-Log) bleiben aus rechtlichen Gründen erhalten, sind aber nicht mehr personenbezogen.
                        </p>
                        <p className="text-xs text-red-900">
                          Tippen Sie <code className="bg-white px-1 rounded">ANONYMISIEREN</code> ein, um zu bestätigen.
                        </p>
                        <Input
                          value={userAnonConfirmText}
                          onChange={(e) => setUserAnonConfirmText(e.target.value)}
                          placeholder="ANONYMISIEREN"
                          className="h-9 bg-white"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => onUserAnonymize(u)}
                            disabled={userAnonConfirmText !== 'ANONYMISIEREN' || isActing}
                          >
                            {isActing ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Wird ausgeführt...</> : 'Endgültig anonymisieren'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setAnonOpenForUserId(null); setUserAnonConfirmText(''); }}>Abbrechen</Button>
                        </div>
                      </div>
                    )}

                    {/* Account actions */}
                    {u.id && !isAnonymized && (
                      <div className="space-y-2 rounded-md bg-slate-50 border border-slate-200 p-2">
                        <div className="text-xs font-medium text-slate-700 flex items-center gap-1">
                          <Shield className="w-3.5 h-3.5" /> Konto-Aktionen
                        </div>

                        {/* Access end date */}
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] text-muted-foreground">Zugriff bis (Stichtag)</label>
                            <Input
                              type="date"
                              value={accDateValue}
                              onChange={(e) => setUserAccessDates(prev => ({ ...prev, [u.id]: e.target.value }))}
                              className="h-9 w-auto"
                              disabled={isActing || isAdminTarget}
                            />
                          </div>
                          <Button size="sm" variant="default" onClick={() => onUserSetAccessEnd(u)} disabled={isActing || isAdminTarget || !accDateValue}>
                            {isActing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Stichtag speichern'}
                          </Button>
                          {u.accessEndsAt && (
                            <Button size="sm" variant="outline" onClick={() => onUserClearAccessEnd(u)} disabled={isActing || isAdminTarget}>
                              Stichtag entfernen
                            </Button>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {!isBlocked && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                              onClick={() => onUserBlock(u)}
                              disabled={isActing || isAdminTarget}
                              title={isAdminTarget ? 'Admin-Konten können nicht gesperrt werden.' : 'Konto sofort sperren — Login wird verhindert'}
                            >
                              {isActing ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5 mr-1.5" />}
                              Konto sofort sperren
                            </Button>
                          )}
                          {isBlocked && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                              onClick={() => onUserUnblock(u)}
                              disabled={isActing}
                              title="Konto wieder aktiv setzen (Login erlaubt)"
                            >
                              {isActing ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 mr-1.5" />}
                              Konto reaktivieren
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => { setAnonOpenForUserId(u.id); setUserAnonConfirmText(''); }}
                            disabled={isActing || isAdminTarget}
                            title={isAdminTarget ? 'Admin-Konten können nicht anonymisiert werden.' : 'Persönliche Daten anonymisieren (endgültig)'}
                          >
                            <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
                            Daten anonymisieren
                          </Button>
                        </div>

                        {isAdminTarget && (
                          <p className="text-[11px] text-amber-700 italic">
                            Hinweis: Admin-Konten können hier nicht gesperrt oder anonymisiert werden — bitte zuerst die Admin-Rolle entziehen.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><ScrollText className="w-4 h-4 text-violet-600" /> Akzeptanzen (Datenschutz / AGB / AVV)</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="text-center text-muted-foreground py-6">Laden...</div>
          : consent.length === 0 ? <div className="text-center text-muted-foreground py-6">Keine Akzeptanzen erfasst.</div>
          : (
            <div className="space-y-1.5">
              {consent.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between text-sm border-b border-border/40 pb-1.5 last:border-0 gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs bg-violet-100 text-violet-800">{consentLabel(c.documentType)}</Badge>
                    <Badge variant="outline" className="text-[10px]">{c.documentVersion}</Badge>
                  </div>
                  <span className="font-medium">{c.user?.email || '—'}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(c.acceptedAt)}{c.ipAddress ? ` • ${c.ipAddress}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tester Management Tab ────────────────────────────────────────────────
function trialStatusBadge(status: string, daysRemaining: number | null) {
  switch (status) {
    case 'active':
      if (daysRemaining !== null && daysRemaining <= 7) {
        return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Läuft ab in {daysRemaining}d</Badge>;
      }
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Aktiv ({daysRemaining}d)</Badge>;
    case 'expired':
      return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Abgelaufen</Badge>;
    case 'none':
    default:
      return <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">Vollzugang</Badge>;
  }
}

function TesterRow({ u, onChanged }: { u: any; onChanged: () => void }) {
  // Pre-fill the date input with the current trialEndDate (yyyy-mm-dd) or empty.
  const initialDate = u.trialEndDate ? String(u.trialEndDate).slice(0, 10) : '';
  const [dateValue, setDateValue] = useState(initialDate);
  const [noteValue, setNoteValue] = useState(u.trialNote ?? '');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [actionLoading, setActionLoading] = useState<'activate' | 'block' | 'extend' | null>(null);

  const isDirty =
    dateValue !== initialDate ||
    (noteValue ?? '') !== (u.trialNote ?? '');

  const accountStatus = String(u.accountStatus || 'active').toLowerCase();
  const isActive = accountStatus === 'active';
  const isBlocked = accountStatus === 'blocked';
  const isAnonymized = accountStatus === 'anonymized' || Boolean(u.anonymizedAt);

  const formatUserDate = (value: string | null) => {
    if (!value) return '—';
    return new Date(value).toLocaleString('de-CH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const accountStatusBadge = () => {
    const statusMap: Record<string, { label: string; cls: string }> = {
      active: { label: 'Aktiv', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
      blocked: { label: 'Gesperrt', cls: 'bg-red-100 text-red-800 border-red-200' },
      trial: { label: 'Trial', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
      anonymized: { label: 'Anonymisiert', cls: 'bg-slate-200 text-slate-800 border-slate-300' },
    };
    const badge = statusMap[accountStatus] || {
      label: accountStatus || 'Unbekannt',
      cls: 'bg-slate-100 text-slate-700 border-slate-200',
    };

    return <Badge variant="outline" className={`text-[11px] ${badge.cls}`}>{badge.label}</Badge>;
  };

  async function save() {
    if (!dateValue) {
      toast.error('Bitte ein Ablaufdatum wählen.');
      return;
    }
    try {
      setSaving(true);
      // Use end-of-day in local timezone so the user's expectation matches Switzerland time.
      const d = new Date(`${dateValue}T23:59:59`);
      if (Number.isNaN(d.getTime())) {
        toast.error('Ungültiges Datum.');
        return;
      }
      const res = await fetch(`/api/admin/users/${u.id}/trial`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trialEndDate: d.toISOString(), trialNote: noteValue || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Speichern fehlgeschlagen');
      }
      toast.success('Testzugang gespeichert.');
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  }

  async function clearTrial() {
    if (!confirm(`Testzugang für ${u.email} wirklich entfernen?`)) return;
    try {
      setClearing(true);
      const res = await fetch(`/api/admin/users/${u.id}/trial`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trialEndDate: null, trialNote: null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Entfernen fehlgeschlagen');
      }
      toast.success('Testzugang entfernt.');
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Fehler beim Entfernen.');
    } finally {
      setClearing(false);
    }
  }

  async function runAccountAction(action: 'activate' | 'block' | 'extend') {
    try {
      setActionLoading(action);
      const endpoint =
        action === 'activate'
          ? 'activate'
          : action === 'block'
            ? 'block'
            : 'extend-trial';

      const res = await fetch(`/api/admin/users/${u.id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Aktion fehlgeschlagen');
      }

      if (action === 'activate') toast.success('Benutzer freigeschaltet.');
      if (action === 'block') toast.success('Benutzer gesperrt.');
      if (action === 'extend') toast.success('Trial um 7 Tage verlängert.');
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || 'Aktion fehlgeschlagen.');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <tr className="border-t hover:bg-muted/30">
      <td className="px-3 py-3 align-top">
        <div className="font-medium text-sm">{u.email}</div>
        {u.name ? <div className="text-xs text-muted-foreground">{u.name}</div> : null}
        <div className="text-xs text-muted-foreground mt-1">
          Rolle: <span className="font-medium">{u.role}</span>
          {u.emailVerified ? ' • verifiziert' : ' • nicht verifiziert'}
        </div>
        <div className="text-xs text-muted-foreground">Registriert: {new Date(u.createdAt).toLocaleDateString('de-CH')}</div>
        <div className="text-xs text-muted-foreground">Trial-Start: {formatUserDate(u.trialStart)}</div>
        <div className="text-xs text-muted-foreground">Trial-Ende: {formatUserDate(u.trialEndDate)}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">Konto-Status: {accountStatusBadge()}</div>
        <div className="text-xs text-muted-foreground">Abo-Status: {u.subscriptionStatus || '—'}{u.currentPeriodEnd ? ` (bis ${new Date(u.currentPeriodEnd).toLocaleDateString('de-CH')})` : ''}</div>
        <div className="text-xs text-muted-foreground">Extra-Audio: {u.audioExtraMinutes ?? 0} Min</div>
      </td>
      <td className="px-3 py-3 align-top text-xs text-muted-foreground">
        <div>Kunden: <span className="font-medium text-foreground">{u.counts?.customers ?? 0}</span></div>
        <div>Aufträge: <span className="font-medium text-foreground">{u.counts?.orders ?? 0}</span></div>
        <div>Angebote: <span className="font-medium text-foreground">{u.counts?.offers ?? 0}</span></div>
        <div>Rechnungen: <span className="font-medium text-foreground">{u.counts?.invoices ?? 0}</span></div>
      </td>
      <td className="px-3 py-3 align-top">
        <div className="flex flex-col gap-2">
          {trialStatusBadge(u.trialStatus, u.daysRemaining)}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => runAccountAction('activate')}
              disabled={actionLoading !== null || isActive || isAnonymized}
            >
              {actionLoading === 'activate' ? 'Freischalten…' : 'Freischalten'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runAccountAction('block')}
              disabled={actionLoading !== null || isBlocked || isAnonymized}
            >
              {actionLoading === 'block' ? 'Sperren…' : 'Sperren'}
            </Button>
            <Button
              size="sm"
              onClick={() => runAccountAction('extend')}
              disabled={actionLoading !== null || isAnonymized}
            >
              {actionLoading === 'extend' ? 'Verlängern…' : 'Trial verlängern (+7 Tage)'}
            </Button>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 align-top">
        <div className="flex flex-col gap-2">
          <Input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            className="w-40"
          />
          <Input
            type="text"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            placeholder="Notiz (optional)"
            className="w-60"
            maxLength={500}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving || !isDirty}>
              {saving ? 'Speichern…' : 'Speichern'}
            </Button>
            {u.trialEndDate ? (
              <Button size="sm" variant="outline" onClick={clearTrial} disabled={clearing}>
                {clearing ? '…' : 'Entfernen'}
              </Button>
            ) : null}
          </div>
        </div>
      </td>
    </tr>
  );
}

function TesterTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const url = search ? `/api/admin/users?q=${encodeURIComponent(search)}` : '/api/admin/users';
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Laden fehlgeschlagen');
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e: any) {
      setError(e?.message || 'Fehler beim Laden.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="w-5 h-5" />
            Tester-Verwaltung
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 px-4 py-3 text-sm text-blue-900 dark:text-blue-200">
            <div className="font-medium mb-1">Hinweis</div>
            <div className="text-blue-800/90 dark:text-blue-300/90">
              Hier können Sie Tester-Konten ein Ablaufdatum für ihren Testzugang zuweisen.
              Der Testzugang ist rein informativ – die Anmeldung und Nutzung der App wird
              dadurch nicht blockiert. Nach Ablauf sehen die Tester nur einen Hinweis-Banner.
            </div>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="E-Mail oder Name suchen…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {error ? (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-900">
              {error}
            </div>
          ) : null}

          {loading && users.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">Lade Benutzer…</div>
          ) : users.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {search ? 'Keine Treffer für die Suche.' : 'Keine Benutzer gefunden.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Benutzer</th>
                    <th className="px-3 py-2 font-medium">Daten</th>
                    <th className="px-3 py-2 font-medium">Status & Aktionen</th>
                    <th className="px-3 py-2 font-medium">Testzugang (manuell)</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <TesterRow key={u.id} u={u} onChanged={load} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


function AudioMinuteRequestsTab() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/audio-minutes/request');
      if (!res.ok) throw new Error('Laden fehlgeschlagen');
      const data = await res.json();
      setRequests(data.requests || []);
    } catch (e: any) {
      toast.error(e?.message || 'Audio-Anfragen konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(requestId: string, action: 'approve' | 'reject') {
    try {
      setActingId(requestId);
      const res = await fetch(`/api/audio-minutes/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Aktion fehlgeschlagen');
      toast.success(action === 'approve' ? 'Anfrage freigegeben' : 'Anfrage abgelehnt');
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Aktion fehlgeschlagen');
    } finally {
      setActingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audio-Minuten Anfragen</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Laden…</div>
        ) : requests.length === 0 ? (
          <div className="text-sm text-muted-foreground">Keine offenen oder historischen Anfragen.</div>
        ) : (
          <div className="space-y-2">
            {requests.map((req) => (
              <div key={req.id} className="border rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">{req.user?.email || '—'} • {req.requestedMinutes} Minuten</div>
                  <div className="text-xs text-muted-foreground">
                    Status: {req.status} • Erstellt: {formatDate(req.createdAt)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Extra-Minuten aktuell: {req.user?.audioExtraMinutes ?? 0}
                    {req.user?.trialStart ? ` • Trial-Start: ${formatDate(req.user.trialStart)}` : ''}
                    {req.user?.trialEndDate ? ` • Trial-Ende: ${formatDate(req.user.trialEndDate)}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => act(req.id, 'approve')}
                    disabled={req.status !== 'open' || actingId === req.id}
                  >
                    Freigeben
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => act(req.id, 'reject')}
                    disabled={req.status !== 'open' || actingId === req.id}
                  >
                    Ablehnen
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const [tab, setTab] = useState<'security' | 'logs' | 'compliance' | 'tester' | 'audio'>('security');
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (status === 'loading') return;
    if (!session || role !== 'admin') {
      router.replace('/dashboard');
    }
  }, [session, status, role, router]);

  useEffect(() => {
    if (role !== 'admin') return;
    setLoadingStats(true);
    fetch('/api/admin/stats').then(r => r.json()).then(setStats).catch(() => {}).finally(() => setLoadingStats(false));
  }, [role]);

  if (status === 'loading' || role !== 'admin') {
    return <div className="flex items-center justify-center h-[60vh]"><div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
          <Shield className="w-5 h-5 text-red-700" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Admin-Bereich</h2>
          <p className="text-sm text-muted-foreground">Sicherheit, Aktivität, Datenschutz</p>
        </div>
      </div>

      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit flex-wrap">
        <button onClick={() => setTab('security')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'security' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <Shield className="w-4 h-4 inline mr-1.5" />Sicherheit
        </button>
        <button onClick={() => setTab('logs')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'logs' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <Activity className="w-4 h-4 inline mr-1.5" />Aktivitätslog
        </button>
        <button onClick={() => setTab('compliance')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'compliance' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <FileText className="w-4 h-4 inline mr-1.5" />Datenschutz
        </button>
        <button onClick={() => setTab('tester')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'tester' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <Users className="w-4 h-4 inline mr-1.5" />Tester
        </button>
        <button onClick={() => setTab('audio')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'audio' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <Activity className="w-4 h-4 inline mr-1.5" />Audio-Minuten
        </button>
      </div>

      {tab === 'security' && (
        loadingStats ? <div className="text-center text-muted-foreground py-8">Laden...</div> : <SecurityOverview stats={stats} />
      )}
      {tab === 'logs' && <LogViewer />}
      {tab === 'compliance' && <ComplianceTab />}
      {tab === 'tester' && <TesterTab />}
      {tab === 'audio' && <AudioMinuteRequestsTab />}
    </div>
  );
}