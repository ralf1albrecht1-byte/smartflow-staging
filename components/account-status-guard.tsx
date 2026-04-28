'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

/**
 * Block U — Client-side account-status guard.
 *
 * The server-side gate in `app/(app)/layout.tsx` catches blocked/expired users
 * on full page loads.  But during SPA navigation (Link clicks), the Next.js
 * Router Cache may serve the cached layout RSC response without re-running
 * the server component.  This lightweight client component bridges that gap:
 *
 *   • On every pathname change it pings `/api/auth/account-status`.
 *   • If the API returns `{ active: false }` the user is signed out immediately.
 *
 * The endpoint is tiny and only returns `{ active: boolean }`, so the extra
 * round-trip cost is negligible.
 */
export default function AccountStatusGuard() {
  const pathname = usePathname();
  const checking = useRef(false);

  useEffect(() => {
    // Avoid overlapping checks during rapid navigation.
    if (checking.current) return;
    checking.current = true;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/auth/account-status', {
          cache: 'no-store',
          headers: { 'x-status-check': '1' },
        });
        if (cancelled) return;

        if (res.status === 401 || res.status === 403) {
          // Account is blocked / expired / anonymized — kick out.
          const data = await res.json().catch(() => ({}));
          const code = data?.code || 'ACCOUNT_BLOCKED';
          await signOut({ redirect: false });
          window.location.href = `/login?error=account_inactive&code=${code}`;
          return;
        }

        // 200 OK → user is active, nothing to do.
      } catch {
        // Network error — don't kick the user out for transient failures.
      } finally {
        checking.current = false;
      }
    })();

    return () => { cancelled = true; };
  }, [pathname]);

  return null; // This component renders nothing.
}
