'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, ClipboardList, FileText, FileCheck, Plus, ArrowRight, Calendar, AlertTriangle, Users, HelpCircle, Copy, Check, Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { ORDER_STATUS_STYLES, OFFER_STATUS_STYLES, INVOICE_STATUS_STYLES, getStatusStyle } from '@/lib/status-colors';
import { AudioUsageCard, type AudioUsageData } from '@/components/audio-usage-card';

interface ReviewData {
  total: number;
  incompleteCustomers: number;
  uncertainAssignments: number;
}

interface DashboardData {
  activeOrders: number;
  activeOffers: number;
  totalInvoices: number;
  needsReview: number;
  review: ReviewData;
  recentOrders: any[];
  recentOffers: any[];
  recentInvoices: any[];
  // Stage I — audio usage block (always present in payload but tolerated as optional here)
  audioUsage?: AudioUsageData;
}

const statusColors: Record<string, string> = {
  'Offen': 'bg-orange-200 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200 border border-orange-300',
  'In Bearbeitung': 'bg-blue-200 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200 border border-blue-300',
  'Erledigt': 'bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-200 border border-green-300',
  'Entwurf': 'bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border border-gray-300',
  'Gesendet': 'bg-blue-200 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200 border border-blue-300',
  'Angenommen': 'bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-200 border border-green-300',
  'Abgelehnt': 'bg-purple-200/60 text-purple-900 dark:bg-purple-900/30 dark:text-purple-200 border border-purple-300',
  'Bezahlt': 'bg-green-200 text-green-900 dark:bg-green-900/40 dark:text-green-200 border border-green-300',
};

const formatDate = (d: string | null | undefined) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' + dt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [whatsappNumber, setWhatsappNumber] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let retries = 0;
    const loadDashboard = async () => {
      try {
        const res = await fetch('/api/dashboard');
        const d = await res.json();
        if (retries < 2 && d && d.activeOrders === 0 && d.activeOffers === 0 && d.totalInvoices === 0 && (d.recentOrders?.length ?? 0) === 0) {
          retries++;
          setTimeout(loadDashboard, 1500);
          return;
        }
        setData(d);
      } catch {} finally { setLoading(false); }
    };
    loadDashboard();
    // Load settings for WhatsApp number
    fetch('/api/settings').then(r => r.json()).then(s => {
      setWhatsappNumber(s?.whatsappIntakeNumber || null);
    }).catch(() => {});
  }, []);

  const copyNumber = () => {
    if (!whatsappNumber) return;
    navigator.clipboard.writeText(whatsappNumber).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  // Format phone for display: +41761234567 → +41 76 123 45 67
  const formatPhone = (num: string) => {
    if (!num) return '';
    // Swiss numbers
    const m = num.match(/^\+41(\d{2})(\d{3})(\d{2})(\d{2})$/);
    if (m) return `+41 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
    // German numbers
    const de = num.match(/^\+49(\d{3,4})(\d+)$/);
    if (de) return `+49 ${de[1]} ${de[2]}`;
    return num;
  };

  const review = data?.review || { total: 0, incompleteCustomers: 0, uncertainAssignments: 0 };

  const stats = [
    { label: 'Aufträge', value: data?.activeOrders ?? 0, icon: ClipboardList, href: '/auftraege', color: 'text-orange-600 bg-orange-50 dark:bg-orange-900/20' },
    { label: 'Angebote', value: data?.activeOffers ?? 0, icon: FileCheck, href: '/angebote', color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20' },
    { label: 'Rechnungen', value: data?.totalInvoices ?? 0, icon: FileText, href: '/rechnungen', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20' },
  ];

  // Skeleton for loading
  const SkeletonCard = () => (
    <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><div className="h-3.5 w-20 bg-muted rounded animate-pulse" /><div className="h-7 w-14 bg-muted rounded animate-pulse mt-1.5" /></div><div className="w-10 h-10 bg-muted rounded-lg animate-pulse" /></div></CardContent></Card>
  );

  const SkeletonList = () => (
    <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => (
      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50"><div className="flex items-center gap-2.5 flex-1"><div className="h-3.5 w-28 bg-muted rounded animate-pulse" /><div className="h-3 w-16 bg-muted rounded animate-pulse" /></div><div className="h-4 w-16 bg-muted rounded animate-pulse" /></div>
    ))}</div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-primary" /> Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Übersicht aller Aktivitäten</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Link href="/auftraege?new=1" className="w-full sm:w-auto"><Button size="sm" className="w-full sm:w-auto justify-center"><Plus className="w-4 h-4 mr-1.5" />Neuer Auftrag</Button></Link>
          <Link href="/angebote?new=1" className="w-full sm:w-auto"><Button size="sm" variant="outline" className="w-full sm:w-auto justify-center"><FileCheck className="w-4 h-4 mr-1.5" />Neues Angebot</Button></Link>
          <Link href="/rechnungen?new=1" className="w-full sm:w-auto"><Button size="sm" variant="outline" className="w-full sm:w-auto justify-center"><FileText className="w-4 h-4 mr-1.5" />Neue Rechnung</Button></Link>
        </div>
      </div>

      {/* Stat tiles: 3 counts + 1 review tile */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            {stats.map((stat, i) => (
              <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                <Link href={stat.href}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground">{stat.label}</p>
                          <p className="text-2xl font-bold font-mono mt-0.5">{stat.value}</p>
                        </div>
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.color}`}>
                          <stat.icon className="w-5 h-5" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}

            {/* Review tile with subcategories */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <Card className={`hover:shadow-md transition-shadow cursor-pointer ${review.total > 0 ? 'border-orange-200 dark:border-orange-800' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Zu prüfen</p>
                      <p className="text-2xl font-bold font-mono mt-0.5">{review.total}</p>
                    </div>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${review.total > 0 ? 'text-orange-600 bg-orange-50 dark:bg-orange-900/20' : 'text-green-600 bg-green-50 dark:bg-green-900/20'}`}>
                      {review.total > 0 ? <AlertTriangle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                    </div>
                  </div>
                  {/* Subcategories */}
                  {review.total > 0 ? (
                    <div className="mt-2 space-y-1 border-t pt-2">
                      {review.incompleteCustomers > 0 && (
                        <Link href="/kunden" className="flex items-center gap-1.5 text-xs text-orange-700 dark:text-orange-300 hover:underline">
                          <Users className="w-3 h-3" />{review.incompleteCustomers} Kundendaten unvollständig
                        </Link>
                      )}
                      {review.uncertainAssignments > 0 && (
                        <Link href="/auftraege" className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300 hover:underline">
                          <HelpCircle className="w-3 h-3" />{review.uncertainAssignments} unsichere Zuordnung
                        </Link>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-1.5">Alles in Ordnung</p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </div>

      {/* WhatsApp Intake Info Block */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
        <Card className={`${whatsappNumber ? 'border-green-200 dark:border-green-800/50 bg-green-50/30 dark:bg-green-900/10' : 'border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-900/10'}`}>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${whatsappNumber ? 'bg-green-100 dark:bg-green-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                  <span className="text-lg">📱</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold flex items-center gap-1.5">WhatsApp-Auftragseingang</p>
                  {whatsappNumber ? (
                    <>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Kunden können WhatsApp-Nachrichten, Fotos und Sprachnachrichten an diese Nummer senden — sie werden automatisch als Aufträge erfasst.
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="font-mono text-base font-bold text-foreground tracking-wide select-all">{formatPhone(whatsappNumber)}</span>
                        <button
                          type="button"
                          onClick={copyNumber}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-background border border-input hover:bg-accent transition-colors shrink-0"
                          title="Nummer kopieren"
                        >
                          {copied ? <><Check className="w-3.5 h-3.5 text-green-600" /><span className="text-green-700">Kopiert</span></> : <><Copy className="w-3.5 h-3.5 text-muted-foreground" /><span>Kopieren</span></>}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                      WhatsApp-Auftragseingang wird vorbereitet. Details in den <Link href="/einstellungen" className="underline font-medium hover:text-amber-900 dark:hover:text-amber-100">Einstellungen</Link>.
                    </p>
                  )}
                </div>
              </div>
              {whatsappNumber && (
                <Link href="/einstellungen" className="shrink-0">
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">
                    <Settings className="w-3.5 h-3.5 mr-1" />Ändern
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Stage I — Audio-Minuten-Karte */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }}>
        <AudioUsageCard
          data={data?.audioUsage ?? null}
          loading={loading}
        />
      </motion.div>

      {/* Recent sections: Orders, Offers, Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Orders */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-display flex items-center gap-1.5"><ClipboardList className="w-4 h-4 text-orange-500" />Letzte Aufträge</CardTitle>
              <Link href="/auftraege"><Button variant="ghost" size="sm" className="h-7 text-xs">Alle <ArrowRight className="w-3 h-3 ml-1" /></Button></Link>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {loading ? <SkeletonList /> : (data?.recentOrders?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-center py-4 text-xs">Keine Aufträge</p>
              ) : (
                <div className="space-y-1">
                  {data?.recentOrders?.map((order: any) => (
                    <div key={order?.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted transition-all cursor-pointer" onClick={() => router.push(`/auftraege?edit=${order?.id}`)}>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs truncate">{order?.serviceName ?? order?.description ?? 'Ohne Beschreibung'}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{order?.customer?.name || '(kein Name)'}{order?.customer?.customerNumber ? ` (${order.customer.customerNumber})` : ''}</p>
                        <p className="text-[10px] text-muted-foreground">{formatDate(order?.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusColors[order?.status ?? ''] ?? ''}`}>{order?.status ?? ''}</Badge>
                        <span className="font-mono text-xs font-bold whitespace-nowrap tabular-nums">CHF {Number(order?.total || order?.totalPrice || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  )) ?? []}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent Offers */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-display flex items-center gap-1.5"><FileCheck className="w-4 h-4 text-blue-500" />Letzte Angebote</CardTitle>
              <Link href="/angebote"><Button variant="ghost" size="sm" className="h-7 text-xs">Alle <ArrowRight className="w-3 h-3 ml-1" /></Button></Link>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {loading ? <SkeletonList /> : (data?.recentOffers?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-center py-4 text-xs">Keine Angebote</p>
              ) : (
                <div className="space-y-1">
                  {data?.recentOffers?.map((off: any) => (
                    <div key={off?.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted transition-all cursor-pointer" onClick={() => router.push(`/angebote?edit=${off?.id}`)}>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs truncate">{off?.items?.[0]?.description || off?.offerNumber}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{off?.customer?.name || '(kein Name)'}{off?.customer?.customerNumber ? ` (${off.customer.customerNumber})` : ''}</p>
                        <p className="text-[10px] text-muted-foreground">{off?.intakeTime ? `Eingang: ${formatDate(off.intakeTime)}` : formatDate(off?.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusColors[off?.status ?? ''] ?? ''}`}>{off?.status ?? ''}</Badge>
                        <span className="font-mono text-xs font-bold whitespace-nowrap tabular-nums">CHF {Number(off?.total ?? 0).toFixed(2)}</span>
                      </div>
                    </div>
                  )) ?? []}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent Invoices */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-display flex items-center gap-1.5"><FileText className="w-4 h-4 text-emerald-500" />Letzte Rechnungen</CardTitle>
              <Link href="/rechnungen"><Button variant="ghost" size="sm" className="h-7 text-xs">Alle <ArrowRight className="w-3 h-3 ml-1" /></Button></Link>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {loading ? <SkeletonList /> : (data?.recentInvoices?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-center py-4 text-xs">Keine Rechnungen</p>
              ) : (
                <div className="space-y-1">
                  {data?.recentInvoices?.map((inv: any) => (
                    <div key={inv?.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted transition-all cursor-pointer" onClick={() => router.push(`/rechnungen?edit=${inv?.id}`)}>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs truncate">{inv?.items?.[0]?.description || inv?.invoiceNumber}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{inv?.customer?.name || '(kein Name)'}{inv?.customer?.customerNumber ? ` (${inv.customer.customerNumber})` : ''}</p>
                        <p className="text-[10px] text-muted-foreground">{inv?.intakeTime ? `Eingang: ${formatDate(inv.intakeTime)}` : formatDate(inv?.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusColors[inv?.status ?? ''] ?? ''}`}>{inv?.status ?? ''}</Badge>
                        <span className="font-mono text-xs font-bold whitespace-nowrap tabular-nums">CHF {Number(inv?.total ?? 0).toFixed(2)}</span>
                      </div>
                    </div>
                  )) ?? []}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
