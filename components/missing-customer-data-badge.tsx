'use client';

import { AlertTriangle } from 'lucide-react';

/**
 * Phase 2g – Block D: Unified "Kundendaten fehlen" badge.
 *
 * One visual element used everywhere the app displays the
 * "missing customer core data" warning (customer list, customer detail,
 * order list, offer list, invoice list, and inside the edit/summary panels).
 *
 * Responsive label:
 *   - < 640px (sm:hidden):   "Prüfen"                   (short — fits mobile rows)
 *   - ≥ 640px (hidden sm:inline): "Kundendaten unvollständig" (full context)
 *
 * The warning rule itself lives in lib/customer-links.ts
 * (`isCustomerDataIncomplete`) — this component is ONLY the visual.
 *
 * Variants:
 *   - `compact`   → tiny pill used on list row headers (inline with name).
 *   - `standard`  → badge-sized element used in edit dialogs / summaries.
 *
 * Both variants share the same amber/orange color token so the chip
 * looks identical across list, detail, and dialog contexts.
 */
interface MissingCustomerDataBadgeProps {
  /** Layout preset. Default: 'compact'. */
  variant?: 'compact' | 'standard';
  /** Optional extra class names to merge. */
  className?: string;
  /**
   * Optional click handler. When provided, the badge renders as a
   * `<button type="button">` and triggers the handler on click. Useful in
   * list rows to jump directly into the customer-edit section of the parent
   * record dialog. The component automatically calls `e.stopPropagation()`
   * before invoking the handler so that an outer card-level `onClick` is not
   * also fired (avoids double-open / wrong context).
   *
   * When `undefined`, the badge renders as an inert `<span role="status">`
   * (the original behavior used in summary panels / customer detail page).
   */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Optional aria-label override when rendering as a button. */
  ariaLabel?: string;
  /** Optional title override when rendering as a button. */
  title?: string;
}

export function MissingCustomerDataBadge({
  variant = 'compact',
  className = '',
  onClick,
  ariaLabel,
  title,
}: MissingCustomerDataBadgeProps) {
  const base =
    variant === 'standard'
      ? 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md font-medium bg-orange-100 text-orange-700 border border-orange-200 shrink-0'
      : 'inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700 shrink-0';

  const iconSize = variant === 'standard' ? 'w-3 h-3' : 'w-2.5 h-2.5';

  const content = (
    <>
      <AlertTriangle className={iconSize} aria-hidden="true" />
      {/* Responsive label: compact on mobile, full on desktop.
          Desktop MUST NOT show "Prüfen" for this warning state — the
          hamburger switch below hides the short label at ≥ sm and
          reveals the full desktop label. */}
      <span className="sm:hidden">Prüfen</span>
      <span className="hidden sm:inline">Kundendaten unvollständig</span>
    </>
  );

  if (onClick) {
    // Clickable variant — used inside list rows so the user can jump
    // directly into the customer-edit section of the record dialog.
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        className={`tap-safe min-h-[28px] cursor-pointer hover:bg-orange-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 transition-colors ${base} ${className}`}
        aria-label={ariaLabel || 'Kundendaten unvollständig — Kunde bearbeiten'}
        title={title || 'Kundendaten unvollständig — Kunde bearbeiten'}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={`${base} ${className}`} role="status" aria-label="Kundendaten unvollständig">
      {content}
    </span>
  );
}

export default MissingCustomerDataBadge;
