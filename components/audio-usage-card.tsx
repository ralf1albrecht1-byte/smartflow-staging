'use client';

import { useState } from 'react';
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
  } | null;
}) {
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

  const used = Math.max(0, data.usedMinutes || 0);
  const included = 20;
  const pctRaw = included > 0 ? Math.round((used / included) * 100) : 0;
  const pctClamped = Math.min(100, Math.max(0, pctRaw));
  const overLimit = pctRaw >= 100;
  const nearLimit = !overLimit && pctRaw >= 80;

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

  const formatMinutes = (val: number): string => {
    if (!isFinite(val)) return '0';
    return Number.isInteger(val) ? `${val}` : val.toFixed(1).replace(/\.0$/, '');
  };

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
                Standard-Abo · CHF 39 / Monat · 20 Min inklusive
              </p>
            </div>
          </div>

        {subscription?.isActive ? (
  <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
    Abo aktiv
  </span>
) : (
  <Button size="sm" onClick={handleCheckout} disabled={busy}>
    {busy ? 'Öffne Stripe…' : 'Abo starten'}
  </Button>
)}
        </div>

        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="font-mono">
            <span className="text-2xl font-bold tabular-nums">{formatMinutes(used)}</span>
            <span className="text-base text-muted-foreground"> / {formatMinutes(included)} Min genutzt</span>
          </div>

          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
              overLimit
                ? 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800'
                : nearLimit
                ? 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800'
                : 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800'
            }`}
          >
            {pctRaw}%
          </span>
        </div>

        <Progress value={pctClamped} className={`h-2 ${progressColorClass}`} />

        <p className="text-[11px] text-muted-foreground">
          Bei höherem Bedarf erstellen wir ein individuelles Angebot.
        </p>

        {overLimit && (
          <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 p-3">
            <p className="text-xs font-semibold text-red-800 dark:text-red-200 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Audio-Limit erreicht. Bitte Abo prüfen oder Support kontaktieren.
            </p>
          </div>
        )}

        {nearLimit && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 p-2.5">
            <p className="text-xs text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Du hast fast dein Audio-Limit erreicht.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}