'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Error boundary for the (app) route group.
 * Catches unhandled render errors and shows a fallback UI
 * instead of a blank white page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[AppError] Unhandled error caught by error boundary:', error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-600 dark:text-red-400" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Seite konnte nicht geladen werden</h2>
        <p className="text-sm text-muted-foreground">
          Ein unerwarteter Fehler ist aufgetreten. Das kann an einer kurzen Verbindungsunterbrechung liegen.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <Button onClick={reset} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Erneut versuchen
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Seite neu laden
          </Button>
        </div>
        {process.env.NODE_ENV === 'development' && error?.message && (
          <details className="mt-4 text-left">
            <summary className="text-xs text-muted-foreground cursor-pointer">Technische Details</summary>
            <pre className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-auto max-h-40">{error.message}\n{error.stack}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
