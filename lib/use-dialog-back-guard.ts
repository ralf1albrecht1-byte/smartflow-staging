'use client';
import { useEffect, useRef } from 'react';

/**
 * useDialogBackGuard
 * ------------------
 * When a dialog/modal is open, pressing the Android/browser back button should
 * CLOSE THE DIALOG FIRST instead of navigating away to the previous page.
 *
 * How it works:
 *   - On open: push a sentinel entry into window.history + install a popstate
 *     listener. Android back now pops our sentinel (not the page), popstate
 *     fires, we call `close()`.
 *   - On close via button/ESC/programmatic: effect cleanup removes the listener
 *     FIRST, then pops our sentinel silently via history.back() so the URL
 *     history stays tidy.
 *
 * Safety / why this version will NOT re-introduce the "dialog closes instantly"
 * regression:
 *   - `close` is captured in a ref, and the effect depends ONLY on `open`.
 *   - Previously the effect depended on [open, close] — but pages pass inline
 *     arrow functions like `() => setDialogOpen(false)`. Each render creates a
 *     new reference, so the effect re-ran every render. Its cleanup called
 *     `history.back()`, which fired popstate on the NEW listener (just attached
 *     by the re-run), which invoked close() and closed the dialog immediately.
 *   - Here the effect is stable across re-renders; it only runs when `open`
 *     actually flips.
 *
 * Edge cases handled:
 *   - Component unmount while open (e.g. user navigates via router.push from
 *     inside the dialog): cleanup runs, but the sentinel check
 *     `history.state?.__dialogBackGuard === true` fails after router.pushState,
 *     so we correctly skip the stray history.back().
 *   - Popstate from our own history.back() during cleanup: listener is removed
 *     BEFORE history.back(), so nothing reacts.
 *   - Strict mode / dev double-invocation: ref-driven state is idempotent.
 */
export function useDialogBackGuard(open: boolean, close: () => void) {
  // Always point to the latest close fn without re-triggering the effect.
  const closeRef = useRef(close);
  closeRef.current = close;

  const pushedRef = useRef(false);
  const closedByPopRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined') return;

    pushedRef.current = false;
    closedByPopRef.current = false;

    // Push a sentinel history entry so that the next "back" pops inside-the-module.
    try {
      const existing = window.history.state;
      const merged = { ...(existing || {}), __dialogBackGuard: true };
      window.history.pushState(merged, '');
      pushedRef.current = true;
    } catch {
      pushedRef.current = false;
    }

    const onPop = () => {
      // User pressed back -> our sentinel was just popped by the browser.
      closedByPopRef.current = true;
      pushedRef.current = false;
      try { closeRef.current(); } catch { /* noop */ }
    };
    window.addEventListener('popstate', onPop);

    return () => {
      // Remove listener FIRST so the optional history.back() below does not re-enter.
      window.removeEventListener('popstate', onPop);

      // If dialog closed by non-back means (button / ESC / programmatic) AND the
      // sentinel is still on top, pop it silently.
      if (pushedRef.current && !closedByPopRef.current) {
        try {
          if ((window.history.state as any)?.__dialogBackGuard === true) {
            window.history.back();
          }
        } catch { /* noop */ }
      }

      pushedRef.current = false;
      closedByPopRef.current = false;
    };
    // IMPORTANT: only depend on `open`. Do NOT add `close` — it is captured in closeRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
