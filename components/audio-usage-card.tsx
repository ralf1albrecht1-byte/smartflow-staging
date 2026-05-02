'use client';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Mic, AlertTriangle, Sparkles } from 'lucide-react';
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

/**
 * Stage I — Dashboard card showing this month's audio-minute usage.
 *
 * Visual hierarchy:
 *   1. Title + plan label
 *   2. Big used / included number
 *   3. Progress bar (color shifts amber ≥ 80 %, red ≥ 100 %)
 *   4. Plan price line
 *   5. Conditional warning + placeholder upgrade buttons (Stripe TODO)
 *
 * The upgrade / extra-minutes buttons are intentionally inert today — they
 * show a Sonner toast "Demnächst verfügbar" instead of triggering Stripe.
 */
export function AudioUsageCard({ data, loading }: { data: AudioUsageData | null; loading?: boolean }) {
  const [busy, setBusy] = useState(false);

  // Skeleton during initial load.
  if (loading || !data) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-4 w-44 bg-muted rounded animate-pulse" />
            <div className="h-5 w-16 bg-muted rounded-full animate-pulse" />
          </div>
          <div className="h-7 w-32 bg-muted rounded animate-pulse" />
          <div className="h-2 w-full bg-muted rounded animate-pulse" />
          <div className="h-3 w-64 bg-muted rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  const used = Math.max(0, data.usedMinutes || 0);
  const included = Math.max(0, data.includedMinutes || 0);
  const pctRaw = data.usagePercent || (included > 0 ? Math.round((used / included) * 100) : 0);
  // Cap progress visual at 100 % even if the user has overflowed.
  const pctClamped = Math.min(100, Math.max(0, pctRaw));
  const overLimit = pctRaw >= 100;
  const nearLimit = !overLimit && pctRaw >= 80;

  const planLabel = data.plan;
  const planNote = data.plan === 'Pro'
    ? `Pro: CHF ${data.monthlyPriceChf} / Monat · ${included} Min inklusive`
    : `Standard: CHF ${data.monthlyPriceChf} / Monat · ${included} Min inklusive`;

  const startCheckout = async (priceId: 'basic' | 'pro') => {
    if (busy) return;

    try {
      setBusy(true);

      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Stripe Checkout konnte nicht gestartet werden.');
      }

      window.location.href = payload.url;
    } catch (error: any) {
      console.error('[audio-usage-card] checkout failed', { message: error?.message });
      toast.error('Checkout fehlgeschlagen', {
        description: error?.message || 'Bitte versuche es in wenigen Minuten erneut.',
      });
    } finally {
      setBusy(false);
    }
  };

  // Color tokens for the progress bar.
  const progressColorClass = overLimit
    ? '[&>div]:bg-red-500'
    : nearLimit
    ? '[&>div]:bg-amber-500'
    : '[&>div]:bg-emerald-500';

  // Card border tone follows the same severity ladder.
  const cardBorderClass = overLimit
    ? 'border-red-200 dark:border-red-800/60 bg-red-50/40 dark:bg-red-900/10'
    : nearLimit
    ? 'border-amber-200 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-900/10'
    : 'border-border';

  // Number formatting: show 1 decimal only if the value is fractional.
  const formatMinutes = (val: number): string => {
    if (!isFinite(val)) return '0';
    return Number.isInteger(val) ? `${val}` : val.toFixed(1).replace(/\.0$/, '');
  };

  return (
    <Card className={cardBorderClass}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Mic className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">Audio-Minuten diesen Monat</p>
              <p className="text-[11px] text-muted-foreground truncate">
                Plan: {planLabel}
                {data.planIsFallback ? <span className="ml-1 italic">(angenommen)</span> : null}
              </p>
            </div>
          </div>
        </div>

        {/* Big number + percent badge */}
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

        {/* Progress bar */}
        <Progress value={pctClamped} className={`h-2 ${progressColorClass}`} />

        {/* Plan price note */}
        <p className="text-[11px] text-muted-foreground">{planNote}</p>

        {/* Severity messages + upgrade placeholders */}
        {overLimit && (
          <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 p-3 space-y-2">
            <p className="text-xs font-semibold text-red-800 dark:text-red-200 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> ⚠️ Audio-Limit erreicht.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 justify-start"
                onClick={() => startCheckout('pro')}
                disabled={busy}
                aria-label="Upgrade auf Pro"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1" />
                Upgrade auf Pro – CHF 79/Monat
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 justify-start"
                onClick={() => startCheckout('basic')}
                disabled={busy}
                aria-label="Zusatz-Minuten aktivieren"
              >
                Zusatz-Minuten aktivieren – CHF {data.extraMinutePriceChf.toFixed(2)}/Minute
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground italic">Sichere Bezahlung über Stripe Checkout.</p>
          </div>
        )}
        {nearLimit && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 p-2.5">
            <p className="text-xs text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> ⚠️ Du hast fast dein Audio-Limit erreicht.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
