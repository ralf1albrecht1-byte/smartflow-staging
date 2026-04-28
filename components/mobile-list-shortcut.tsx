'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/**
 * Mobile-only navigation shortcut for list/overview pages.
 *
 * - Purpose: offer a quick, obvious way on phones to jump to the *next*
 *   main list (Aufträge → Angebote, Angebote → Rechnungen) without
 *   opening the hamburger menu. It is **navigation only** and MUST NOT
 *   create or convert anything.
 *
 * - Placement: `fixed` to the viewport, pinned to the bottom centre.
 *   Using `fixed` (not `sticky`) guarantees the pill is always visible
 *   on mobile regardless of content height, scroll container quirks or
 *   flex-parent sizing edge-cases. `sticky` was unreliable when a list
 *   happened to be shorter than the viewport (it sat in flow below the
 *   last card, often below the fold on short lists).
 *
 * - Visibility: `md:hidden` — desktop users already have the sidebar,
 *   so the shortcut is hidden on ≥ md.
 *
 * - Style: intentionally smaller and more subtle than the primary
 *   green "Neuer Auftrag" / "Neues Angebot" create button, so it never
 *   visually competes with or is mistaken for a create action.
 *
 * - Pointer handling: the fixed wrapper uses `pointer-events-none` so
 *   it doesn't intercept taps on list cards underneath; the inner
 *   button opts back in with `pointer-events-auto`.
 */
interface MobileListShortcutProps {
  /** Navigation target, e.g. '/angebote' or '/rechnungen'. */
  href: string;
  /** Short visible label, e.g. 'Angebote'. */
  label: string;
  /** Accessible description, e.g. 'Zu Angebote'. */
  ariaLabel: string;
}

export function MobileListShortcut({ href, label, ariaLabel }: MobileListShortcutProps) {
  return (
    <div
      className={
        'md:hidden fixed inset-x-0 z-30 flex justify-center pointer-events-none ' +
        // bottom-4 + safe-area so the button clears the iOS home indicator
        'bottom-[calc(1rem+env(safe-area-inset-bottom))]'
      }
      aria-hidden={false}
    >
      <Link
        href={href}
        aria-label={ariaLabel}
        prefetch={false}
        className={
          'pointer-events-auto inline-flex items-center gap-1.5 ' +
          'rounded-full bg-background/95 backdrop-blur-sm ' +
          'border border-border shadow-md ' +
          'px-3.5 py-1.5 h-9 text-xs font-medium text-foreground/90 ' +
          'hover:bg-muted hover:text-foreground active:scale-[0.98] ' +
          'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'
        }
      >
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        {label}
      </Link>
    </div>
  );
}

export default MobileListShortcut;
