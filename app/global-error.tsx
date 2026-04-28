'use client';

import { useEffect } from 'react';

/**
 * Root-level error boundary — catches errors that escape (app)/error.tsx,
 * including layout crashes and provider errors.
 * Must render its own <html>/<body> because root layout may be broken.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError] Root-level error caught:', error);
  }, [error]);

  return (
    <html lang="de">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', padding: '2rem', textAlign: 'center',
        }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Seite konnte nicht geladen werden</h1>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
              Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={reset}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none',
                  background: '#059669', color: '#fff', fontWeight: 600,
                  fontSize: 14, cursor: 'pointer',
                }}
              >
                Erneut versuchen
              </button>
              <button
                onClick={() => window.location.href = '/dashboard'}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: '1px solid #d1d5db',
                  background: '#fff', color: '#374151', fontWeight: 500,
                  fontSize: 14, cursor: 'pointer',
                }}
              >
                Zum Dashboard
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
