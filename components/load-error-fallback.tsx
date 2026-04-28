'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Reusable error fallback shown when initial data loading fails.
 * Displays a clear message and retry button instead of a blank page.
 */
export function LoadErrorFallback({
  message,
  details,
  onRetry,
}: {
  message?: string;
  details?: string[];
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[40vh] px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-orange-600 dark:text-orange-400" />
        </div>
        <h2 className="text-lg font-bold text-foreground">
          {message || 'Daten konnten nicht geladen werden'}
        </h2>
        <p className="text-sm text-muted-foreground">
          Möglicherweise liegt eine kurze Verbindungsunterbrechung vor. Bitte versuche es erneut.
        </p>
        {details && details.length > 0 && (
          <div className="text-left bg-muted/50 rounded-lg p-3 space-y-1">
            {details.map((d, i) => (
              <p key={i} className="text-xs text-muted-foreground truncate">• {d}</p>
            ))}
          </div>
        )}
        <Button onClick={onRetry} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Erneut laden
        </Button>
      </div>
    </div>
  );
}
