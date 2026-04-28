/**
 * Shared status color definitions for dropdown styling.
 * Returns CSS background/text color pairs for inline styling of <select> and <option> elements.
 */

export const ORDER_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'Offen': { bg: '#fed7aa', text: '#7c2d12' },     // orange-200/900
  'Erledigt': { bg: '#bbf7d0', text: '#14532d' },   // green-200/900
};

export const OFFER_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'Entwurf': { bg: '#e5e7eb', text: '#1f2937' },    // gray-200/800
  'Gesendet': { bg: '#bfdbfe', text: '#1e3a8a' },   // blue-200/900
  'Angenommen': { bg: '#bbf7d0', text: '#14532d' },  // green-200/900
  'Abgelehnt': { bg: '#e8d5e0', text: '#6b2148' },   // wine-red (muted purple-red)
  'Erledigt': { bg: '#a7f3d0', text: '#064e3b' },    // emerald-200/900
};

export const INVOICE_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'Entwurf': { bg: '#e5e7eb', text: '#1f2937' },    // gray-200/800
  'Gesendet': { bg: '#bfdbfe', text: '#1e3a8a' },   // blue-200/900
  'Überfällig': { bg: '#fecaca', text: '#7f1d1d' }, // red-200/900 — clear overdue warning
  'Bezahlt': { bg: '#bbf7d0', text: '#14532d' },    // green-200/900
};

export function getStatusStyle(styles: Record<string, { bg: string; text: string }>, status: string): React.CSSProperties {
  const s = styles[status];
  if (!s) return {};
  return { backgroundColor: s.bg, color: s.text, fontWeight: 500 };
}
