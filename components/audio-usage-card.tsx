'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Mic, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export interface AudioUsageData {
  plan: 'Standard' | 'Pro';
  planIsFallback: boolean;
  includedMinutes: number;
  usedMinutes: number;
  monthlyPriceChf: number;
  extraMinutePriceChf: number;
  usagePercent: number;
  audioOrderCount?: number;
}

function formatDateTime(value: string | null): string {
  if (!value) return '';

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) return '';

  return `${date.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })} um ${date.toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
  })} Uhr`;
}

function formatTrialRemaining(currentPeriodEnd: string | null): string {
  if (!currentPeriodEnd) return 'Testphase aktiv';

  const endDate = new Date(currentPeriodEnd);
  const end = endDate.getTime();
  const now = Date.now();
  const diffMs = end - now;
  const formattedEnd = formatDateTime(currentPeriodEnd);

  if (!Number.isFinite(end)) return 'Testphase aktiv';

  if (diffMs <= 0) {
    return `Testphase beendet. Endete am ${formattedEnd}`;
  }

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  let remainingText = '';

  if (days > 0) {
    remainingText = `Noch ${days} ${days === 1 ? 'Tag' : 'Tage'} und ${hours} ${
      hours === 1 ? 'Stunde' : 'Stunden'
    } kostenlos`;
  } else if (totalHours > 0) {
    remainingText = `Noch ${totalHours} ${totalHours === 1 ? 'Stunde' : 'Stunden'} kostenlos`;
  } else {
    remainingText = `Noch ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'} kostenlos`;
  }

  return `${remainingText}. Endet am ${formattedEnd}`;
}

export function AudioUsageCard({
  data,
  loading,
  subscription,
}: {
  data: AudioUsageData | null;
  loading?: boolean;
  subscription?: {
    isActive: boolean;
    status: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd?: boolean;
  } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (loading || !data) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="h-4 w-44 bg-muted rounded animate-pulse" />
          <div className="h-7 w-32 bg-muted rounded animate-pulse" />
          <div className="h-2 w-full bg-muted rounded animate-pulse" />
          <div className="h-3 w-64 bg-muted rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

   const status = subscription?.status || null;
  const isCanceled = status === 'canceled';
  const isTrialing = status === 'trialing';
  const isActive = status === 'active';
  const isCancelledAtPeriodEnd =
    !isCanceled &&
    Boolean(subscription?.cancelAtPeriodEnd) &&
    Boolean(subscription?.currentPeriodEnd);
  const needsPaymentAttention = status === 'past_due' || status === 'unpaid' || status === 'incomplete';
  const used = Math.max(0, data.usedMinutes || 0);
  const included = 20;
  const pctRaw = included > 0 ? Math.round((used / included) * 100) : 0;
  const pctClamped = Math.min(100, Math.max(0, pctRaw));
  const overLimit = pctRaw >= 100;
  const nearLimit = !overLimit && pctRaw >= 80;

  const formatMinutes = (val: number): string => {
    if (!isFinite(val)) return '0';
    return Number.isInteger(val) ? `${val}` : val.toFixed(1).replace(/\.0$/, '');
  };

  const refreshDashboard = () => {
    router.refresh();

    setTimeout(() => {
      router.refresh();
    }, 1200);
  };

  const handleCheckout = async () => {
    if (busy) return;

    try {
      setBusy(true);

      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const result = await res.json().catch(() => null);

      if (!res.ok || !result?.url) {
        throw new Error(result?.error || 'Stripe Checkout konnte nicht gestartet werden.');
      }

      window.location.href = result.url;
    } catch (error: any) {
      toast.error('Abo konnte nicht gestartet werden', {
        description: error?.message || 'Bitte später erneut versuchen.',
      });
      setBusy(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (busy) return;

    const confirmed = window.confirm(
      'Abo wirklich kündigen? Dein Zugang bleibt bis zum Ende der aktuellen Laufzeit aktiv.',
    );

    if (!confirmed) return;

    try {
      setBusy(true);

      const res = await fetch('/api/stripe/cancel-subscription', {
        method: 'POST',
      });

      const result = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(result?.error || 'Abo konnte nicht gekündigt werden.');
      }

      toast.success('Kündigung geplant.', {
        description: result?.currentPeriodEnd
          ? `Dein Zugang bleibt bis ${formatDateTime(result.currentPeriodEnd)} aktiv.`
          : 'Dein Zugang bleibt bis zum Periodenende aktiv.',
      });

      refreshDashboard();
    } catch (error: any) {
      toast.error('Abo konnte nicht gekündigt werden', {
        description: error?.message || 'Bitte später erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReactivateSubscription = async () => {
    if (busy) return;

    try {
      setBusy(true);

      const res = await fetch('/api/stripe/reactivate-subscription', {
        method: 'POST',
      });

      const result = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(result?.error || 'Abo konnte nicht fortgesetzt werden.');
      }

      toast.success('Abo wurde fortgesetzt.');
      refreshDashboard();
    } catch (error: any) {
      toast.error('Abo konnte nicht fortgesetzt werden', {
        description: error?.message || 'Bitte später erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  };

  const progressColorClass = overLimit
    ? '[&>div]:bg-red-500'
    : nearLimit
      ? '[&>div]:bg-amber-500'
      : '[&>div]:bg-emerald-500';

  const cardBorderClass = overLimit
    ? 'border-red-200 dark:border-red-800/60 bg-red-50/40 dark:bg-red-900/10'
    : nearLimit
      ? 'border-amber-200 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-900/10'
      : 'border-border';

  const periodEndLabel = formatDateTime(subscription?.currentPeriodEnd || null);

  return (
    <Card className={cardBorderClass}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Mic className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">Audio-Minuten diesen Monat</p>
              <p className="text-[11px] text-muted-foreground truncate">
                Standard · CHF 39 / Monat · 20 Min inklusive
              </p>
            </div>
          </div>

          {isCancelledAtPeriodEnd ? (
  <div className="flex items-center gap-2 flex-wrap justify-end">
    <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
      Kündigung geplant
    </span>

    <Button size="sm" variant="outline" onClick={handleReactivateSubscription} disabled={busy}>
      {busy ? 'Bitte warten…' : 'Abo fortsetzen'}
    </Button>
  </div>
) : isTrialing ? (
  <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
    Testphase aktiv
  </span>
) : isActive ? (
  <div className="flex items-center gap-2 flex-wrap justify-end">
    <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
      Abo aktiv
    </span>

    ) : isActive ? (
  <div className="flex items-center gap-2 flex-wrap justify-end">
    <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
      Abo aktiv
    </span>
  </div>
) : needsPaymentAttention ? (
  </div>
) : needsPaymentAttention ? (
  <Button size="sm" variant="destructive" onClick={handleCheckout} disabled={busy}>
    {busy ? 'Öffne Stripe…' : 'Zahlung prüfen'}
  </Button>
) : (
  <Button size="sm" onClick={handleCheckout} disabled={busy}>
    {busy ? 'Öffne Stripe…' : 'Abo starten'}
  </Button>
)}
        </div>

        {isTrialing && !isCancelledAtPeriodEnd && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-1">
            <p className="text-sm font-semibold text-blue-900">Testphase aktiv</p>
            <p className="text-xs text-blue-800">
              {formatTrialRemaining(subscription?.currentPeriodEnd || null)}
            </p>

          </div>
        )}

        {isCancelledAtPeriodEnd && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
            <p className="text-sm font-semibold text-amber-900">Kündigung geplant</p>
            <p className="text-xs text-amber-800">
              Dein Abo läuft noch bis {periodEndLabel || 'zum Ende der aktuellen Laufzeit'}.
            </p>
            <p className="text-xs text-amber-800">
              Danach endet dein Zugriff automatisch. Du kannst das Abo vorher jederzeit fortsetzen.
            </p>
          </div>
        )}

        {isActive && !isCancelledAtPeriodEnd && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-1">
            <p className="text-sm font-semibold text-emerald-900">Abo aktiv</p>
            <p className="text-xs text-emerald-800">
              Dein Standard-Abo läuft aktiv für CHF 39 monatlich.
            </p>
            {periodEndLabel && (
              <p className="text-xs text-emerald-800">
                Aktuelle Periode läuft bis {periodEndLabel}.
              </p>
            )}
          </div>
        )}

        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="font-mono">
            <span className="text-2xl font-bold tabular-nums">{formatMinutes(used)}</span>
            <span className="text-base text-muted-foreground">
              {' '} / {formatMinutes(included)} Min genutzt
            </span>
          </div>

          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border">
            {pctRaw}%
          </span>
        </div>

        <Progress value={pctClamped} className={`h-2 ${progressColorClass}`} />

        {!isTrialing && (
          <p className="text-[11px] text-muted-foreground">
            Bei höherem Bedarf erstellen wir ein individuelles Angebot.
          </p>
        )}

        {overLimit && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-semibold text-red-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Audio-Limit erreicht. Bitte Abo prüfen.
            </p>
          </div>
        )}

        {nearLimit && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
            <p className="text-xs text-amber-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Du hast fast dein Audio-Limit erreicht.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}