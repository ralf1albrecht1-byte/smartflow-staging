'use client';

/**
 * Phase 2d — Auto-reuse banner.
 *
 * Renders ONLY when the order carries an `AUTO_REUSED*` tag in reviewReasons.
 * Shows: type (exact / near-exact), linked customer number, completed field
 * (for near-exact), and an Undo button IF AND ONLY IF the order has no
 * follow-up document (no invoiceId, no offerId).
 *
 * Undo calls POST /api/orders/:id/split-customer which:
 *   - verifies tenancy,
 *   - refuses if a follow-up exists,
 *   - creates a new customer (name only) and reassigns the order.
 */

import * as React from 'react';
import { Info, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export interface AutoReuseBannerOrder {
  id: string;
  reviewReasons?: string[] | null;
  invoiceId?: string | null;
  offerId?: string | null;
}

export interface AutoReuseUndoResult {
  newCustomerId: string;
  newCustomerNumber: string;
  newCustomerName: string;
  /**
   * Phase 2d fix: the address the order was previously bound to, for a
   * temporary read-only info hint in the edit dialog. NOT a write trigger.
   */
  previousAddress?: {
    address: string | null;
    plz: string | null;
    city: string | null;
  } | null;
}

export interface AutoReuseBannerProps {
  order: AutoReuseBannerOrder | null | undefined;
  /**
   * Optional pre-undo customer snapshot (address/plz/city) so the banner can
   * pass it back to the parent on undo. The parent then shows a read-only
   * info line ("Vorherige Adresse: …"). We do NOT write this back into the
   * new customer — safety rule kept as-is.
   */
  previousCustomerSnapshot?: {
    address: string | null;
    plz: string | null;
    city: string | null;
  } | null;
  onUndone?: (result: AutoReuseUndoResult) => void;
}

interface ParsedTag {
  raw: string;
  kind: 'exact' | 'near_exact';
  customerNumber: string | null;
  completedField: 'plz' | 'city' | null;
}

function parseAutoReuseTag(tag: string): ParsedTag | null {
  if (tag === 'AUTO_REUSED') {
    return { raw: tag, kind: 'exact', customerNumber: null, completedField: null };
  }
  if (tag.startsWith('AUTO_REUSED_NEAR_EXACT:')) {
    // Format: AUTO_REUSED_NEAR_EXACT:<cno>:<plz|city>_completed
    const parts = tag.split(':');
    const cno = parts[1] || null;
    const completedChunk = parts[2] || '';
    let completed: 'plz' | 'city' | null = null;
    if (completedChunk === 'plz_completed') completed = 'plz';
    else if (completedChunk === 'city_completed') completed = 'city';
    return { raw: tag, kind: 'near_exact', customerNumber: cno, completedField: completed };
  }
  if (tag.startsWith('AUTO_REUSED:')) {
    const parts = tag.split(':');
    return { raw: tag, kind: 'exact', customerNumber: parts[1] || null, completedField: null };
  }
  return null;
}

export function AutoReuseBanner({ order, previousCustomerSnapshot, onUndone }: AutoReuseBannerProps) {
  const [busy, setBusy] = React.useState(false);

  if (!order || !order.reviewReasons || order.reviewReasons.length === 0) return null;

  const parsed = order.reviewReasons
    .map((r) => parseAutoReuseTag(r))
    .find((p): p is ParsedTag => p !== null);
  if (!parsed) return null;

  const hasFollowUp = !!(order.invoiceId || order.offerId);

  async function handleUndo() {
    if (!order) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/split-customer`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error('Rückgängig nicht möglich', {
          description: json?.error || 'Unbekannter Fehler.',
        });
        return;
      }
      toast.success('Wiederverwendung zurückgesetzt', {
        description: json?.newCustomer
          ? `Neuer Kunde ${json.newCustomer.customerNumber} angelegt.`
          : 'Auftrag einem neuen Kunden zugeordnet.',
      });
      if (json?.newCustomer?.id) {
        onUndone?.({
          newCustomerId: json.newCustomer.id,
          newCustomerNumber: json.newCustomer.customerNumber || '',
          newCustomerName: json.newCustomer.name || '',
          previousAddress: previousCustomerSnapshot ?? null,
        });
      }
    } catch (e: any) {
      toast.error('Netzwerkfehler', {
        description: e?.message || 'Bitte erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  }

  const kindLabel = parsed.kind === 'exact' ? 'exakt' : 'nahezu exakt';
  const cnoText = parsed.customerNumber ? `Kunde ${parsed.customerNumber}` : 'bestehendem Kunden';
  const completedText =
    parsed.kind === 'near_exact' && parsed.completedField
      ? ` (${parsed.completedField === 'plz' ? 'PLZ' : 'Ort'} aus Kundendaten ergänzt)`
      : '';

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-900 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-blue-900 dark:text-blue-100">
            Kunde automatisch wiederverwendet ({kindLabel})
          </div>
          <div className="text-blue-800 dark:text-blue-200 mt-0.5">
            Dieser Auftrag wurde deterministisch {cnoText} zugeordnet{completedText}. Keine Duplikatprüfung notwendig.
          </div>
          {hasFollowUp && (
            <div className="mt-1.5 text-xs text-blue-700 dark:text-blue-300">
              Rückgängig nicht möglich: Auftrag hat bereits ein Folgedokument (Rechnung oder Angebot).
            </div>
          )}
        </div>
        {!hasFollowUp && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleUndo}
            disabled={busy}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            {busy ? '…' : 'Rückgängig'}
          </Button>
        )}
      </div>
    </div>
  );
}

export default AutoReuseBanner;
