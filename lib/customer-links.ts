/**
 * Single source of truth for counting records linked to a customer in a way that
 * matches exactly what the user sees in the module list pages.
 *
 * Visibility rules (DUPLICATED from the corresponding module list pages — keep in sync):
 *
 *   Orders        (/auftraege)          deletedAt=null && !offerId && !invoiceId
 *                                         └─> i.e. only orders NOT yet converted to an offer/invoice
 *                                         └─> source: app/(app)/auftraege/page.tsx line ~211
 *
 *   Offers        (/angebote, default)   deletedAt=null && status ∈ {Entwurf, Gesendet}
 *                                         └─> "Aktive" filter is the default in the page
 *                                         └─> source: app/(app)/angebote/page.tsx line ~33, ~480
 *
 *   Invoices      (/rechnungen)          deletedAt=null && status !== 'Erledigt'
 *                                         └─> "Erledigt" is archived to /archiv
 *                                         └─> source: app/(app)/rechnungen/page.tsx line ~156
 *
 *   Archived inv. (/archiv)              deletedAt=null && status === 'Erledigt'
 *                                         └─> source: app/(app)/archiv/page.tsx
 *
 * Any customer-facing count (badge on /kunden list, tab counter on /kunden/[id],
 * delete warning count, delete hard-block rule) MUST use these helpers so numbers
 * stay consistent end-to-end.
 */

export type RawOrder = {
  id: string;
  offerId?: string | null;
  invoiceId?: string | null;
};

export type RawOffer = {
  id: string;
  status: string;
};

export type RawInvoice = {
  id: string;
  status: string;
  sourceOfferId?: string | null;
};

/** Offer statuses that make an offer visible in the /angebote default list. */
export const ACTIVE_OFFER_STATUSES = ['Entwurf', 'Gesendet'] as const;

/** Order is visible in /auftraege. */
export function isVisibleOrder(o: RawOrder): boolean {
  return !o.offerId && !o.invoiceId;
}

/** Offer is visible in /angebote default ("Aktive") view. */
export function isVisibleOffer(o: RawOffer): boolean {
  return (ACTIVE_OFFER_STATUSES as readonly string[]).includes(o.status);
}

/** Invoice is visible in /rechnungen (i.e. NOT archived). */
export function isVisibleInvoice(i: RawInvoice): boolean {
  return i.status !== 'Erledigt';
}

/** Invoice is archived (visible in /archiv). */
export function isArchivedInvoice(i: RawInvoice): boolean {
  return i.status === 'Erledigt';
}

/** Filter helpers that preserve the original typed shape (useful for detail route). */
export function filterVisibleOrders<T extends RawOrder>(orders: T[]): T[] {
  return orders.filter(isVisibleOrder);
}
export function filterVisibleOffers<T extends RawOffer>(offers: T[]): T[] {
  return offers.filter(isVisibleOffer);
}
export function filterVisibleInvoices<T extends RawInvoice>(invoices: T[]): T[] {
  return invoices.filter(isVisibleInvoice);
}

/** Canonical VISIBLE counts (Rule C) — used for customer list badges/chips and
 *  detail-page tabs. "Visible" = exactly what shows up in the respective module list. */
export function countVisibleLinked(
  orders: RawOrder[],
  offers: RawOffer[],
  invoices: RawInvoice[],
) {
  return {
    orders: orders.filter(isVisibleOrder).length,
    offers: offers.filter(isVisibleOffer).length,
    invoices: invoices.filter(isVisibleInvoice).length,
    archivedInvoices: invoices.filter(isArchivedInvoice).length,
  };
}

/** STRICT block-rule counts — used by the customer delete hard-block and the
 *  delete warning dialog. Includes every non-soft-deleted linked record,
 *  regardless of conversion status / offer status / invoice status. The warning
 *  dialog displays these as four separate lines so the user sees the full
 *  blocking reason (incl. archived invoices). Source of truth: `DELETE /api/customers/[id]`. */
export function countTotalLinked(
  orders: RawOrder[],
  offers: RawOffer[],
  invoices: RawInvoice[],
) {
  return {
    orders: orders.length,
    offers: offers.length,
    currentInvoices: invoices.filter((i) => !isArchivedInvoice(i)).length,
    archivedInvoices: invoices.filter(isArchivedInvoice).length,
  };
}

/** Shared prisma `where` fragments so the DELETE endpoint can count in SQL without a re-fetch. */
export const VISIBLE_ORDER_WHERE = { deletedAt: null, offerId: null, invoiceId: null } as const;
export const VISIBLE_OFFER_WHERE = {
  deletedAt: null,
  status: { in: ACTIVE_OFFER_STATUSES as unknown as string[] },
} as const;
export const VISIBLE_INVOICE_WHERE = {
  deletedAt: null,
  status: { not: 'Erledigt' },
} as const;

/** STRICT block-rule prisma `where` fragments — ANY non-soft-deleted record blocks deletion. */
export const BLOCK_ORDER_WHERE = { deletedAt: null } as const;
export const BLOCK_OFFER_WHERE = { deletedAt: null } as const;
export const BLOCK_INVOICE_WHERE = { deletedAt: null } as const;

/* =============================================================================
 * CANONICAL CUSTOMER DELETE RULE (Paket K, 2026-04-18)
 *
 * Single source of truth — used by BOTH:
 *   - DELETE /api/customers/[id]          (move-to-trash: soft delete)
 *   - POST   /api/papierkorb action=delete/empty  (permanent delete from trash)
 *   - GET    /api/papierkorb              (6-month auto-cleanup)
 *
 * ALLOW delete if the customer has ONLY pure history and no archived invoice:
 *   - active orders   = 0   (orders with deletedAt=null && !offerId && !invoiceId)
 *   - active offers   = 0   (status ∈ Entwurf/Gesendet)
 *   - active invoices = 0   (status ≠ 'Erledigt')
 *   - archived inv.   = 0   (status = 'Erledigt' — still blocks, accounting reasons)
 *
 * Pure history (converted orders with offerId/invoiceId set, offers in
 * Angenommen/Abgelehnt/Abgelaufen) does NOT block. Historie dialogs continue
 * to show these records after the customer is gone via the soft-deleted path.
 *
 * The previous Papierkorb rule counted ALL non-soft-deleted records as
 * blockers — which is WHY a customer with only history could be sent to
 * trash by the soft-delete path but the permanent-delete path still said
 * "aktive Aufträge vorhanden". Both paths now share this exact helper.
 * =============================================================================
 */
export type CustomerDeleteBlockerCounts = {
  activeOrders: number;
  activeOffers: number;
  activeInvoices: number;
  archivedInvoices: number;
  historicalOrders: number;
  historicalOffers: number;
};

/** Count active/historical records for a customer via Prisma. Shared by every
 *  delete path so the rule cannot drift. `prisma` is passed in to avoid a
 *  circular import from the API routes. */
export async function getCustomerDeleteBlockerCounts(
  prisma: any,
  customerId: string,
  userId: string,
): Promise<CustomerDeleteBlockerCounts> {
  const [activeOrders, activeOffers, activeInvoices, archivedInvoices, historicalOrders, historicalOffers] = await Promise.all([
    prisma.order.count({ where: { customerId, deletedAt: null, userId, offerId: null, invoiceId: null } }),
    prisma.offer.count({ where: { customerId, deletedAt: null, userId, status: { in: ACTIVE_OFFER_STATUSES as unknown as string[] } } }),
    prisma.invoice.count({ where: { customerId, deletedAt: null, userId, status: { not: 'Erledigt' } } }),
    prisma.invoice.count({ where: { customerId, deletedAt: null, userId, status: 'Erledigt' } }),
    prisma.order.count({ where: { customerId, deletedAt: null, userId, OR: [{ offerId: { not: null } }, { invoiceId: { not: null } }] } }),
    prisma.offer.count({ where: { customerId, deletedAt: null, userId, status: { notIn: ACTIVE_OFFER_STATUSES as unknown as string[] } } }),
  ]);
  return { activeOrders, activeOffers, activeInvoices, archivedInvoices, historicalOrders, historicalOffers };
}

/** True iff deletion is blocked by any active record OR any archived invoice. */
export function isCustomerDeleteBlocked(counts: CustomerDeleteBlockerCounts): boolean {
  return counts.activeOrders > 0
      || counts.activeOffers > 0
      || counts.activeInvoices > 0
      || counts.archivedInvoices > 0;
}

/** Build the German user-facing blocker message that lists all reasons. */
export function formatCustomerDeleteBlockerMessage(counts: CustomerDeleteBlockerCounts): string {
  const parts: string[] = [];
  if (counts.activeOrders > 0) parts.push(`${counts.activeOrders} ${counts.activeOrders === 1 ? 'aktiven Auftrag' : 'aktive Aufträge'}`);
  if (counts.activeOffers > 0) parts.push(`${counts.activeOffers} ${counts.activeOffers === 1 ? 'aktives Angebot' : 'aktive Angebote'}`);
  if (counts.activeInvoices > 0) parts.push(`${counts.activeInvoices} ${counts.activeInvoices === 1 ? 'aktive Rechnung' : 'aktive Rechnungen'}`);
  if (counts.archivedInvoices > 0) parts.push(`${counts.archivedInvoices} ${counts.archivedInvoices === 1 ? 'archivierte Rechnung' : 'archivierte Rechnungen'}`);
  return `Dieser Kunde hat noch ${parts.join(', ')}. Löschen ist nicht möglich.`;
}

/* =============================================================================
 * CANONICAL "Kundendaten fehlen" RULE
 *
 * Single source of truth for "this customer has missing core data". Used by:
 *   - Customer list chip "⚠ Kundendaten fehlen" (app/(app)/kunden/page.tsx)
 *   - Dashboard "Zu prüfen" → "Kundendaten fehlen" sub-count
 *     (app/api/dashboard/route.ts)
 *   - Customer-info warning badge inside order/offer/invoice edit dialogs
 *     (app/(app)/auftraege/page.tsx, angebote/page.tsx, rechnungen/page.tsx)
 *   - Customer detail page warning (app/(app)/kunden/[id]/page.tsx)
 *
 * REQUIRED CORE FIELDS (all four must be present after trim):
 *   - name     (Kundenname)
 *   - address  (Strasse + Hausnr.)
 *   - plz      (Postleitzahl)
 *   - city     (Ort)
 *
 * OPTIONAL (never trigger the warning, never painted red in the UI):
 *   - phone    (Telefon)
 *   - email    (E-Mail)
 *
 * Every place that decides "this customer is missing core data" MUST call
 * `isCustomerDataIncomplete()`. Every place that decides "this particular
 * field should be painted red" MUST call `isRequiredCustomerFieldMissing()`.
 * Do not inline a local rule anywhere — that is exactly what caused the
 * dashboard-vs-list drift.
 * =============================================================================
 */
export type CustomerContactFields = {
  name?: string | null;
  address?: string | null;
  plz?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
};

/** The set of core fields a customer MUST have. Phone and email are NOT included. */
export const REQUIRED_CUSTOMER_FIELDS = ['name', 'address', 'plz', 'city'] as const;
export type RequiredCustomerField = typeof REQUIRED_CUSTOMER_FIELDS[number];

/** True iff the given value (for a required field) is missing. Uses the same
 *  trim rule as `isCustomerDataIncomplete` so the red-highlight in individual
 *  field rows always matches the chip/badge state. Phone/email are NOT a
 *  required field — do not call this with 'phone' or 'email'. */
export function isRequiredCustomerFieldMissing(value: string | null | undefined): boolean {
  return !value || !String(value).trim();
}

/* =============================================================================
 * ARCHIVED-CUSTOMER GUARD (Paket K, 2026-04-20)
 *
 * Prevents contradictory state where an archived (soft-deleted) customer
 * owns active business records. Two helpers:
 *
 *   isCustomerArchived(prisma, id)
 *     → Quick check: returns true if the customer has deletedAt set.
 *
 *   assertCustomerNotArchived(prisma, customerId)
 *     → Throws with a descriptive error if the customer is archived.
 *       Used as a guard in write paths (order/offer creation, reassignment,
 *       quick-intake, webhook intake) so that records are never linked to
 *       an archived customer.
 *
 * Both accept `prisma` as a parameter to avoid circular imports.
 * =============================================================================
 */

/** Returns true if the customer exists and has `deletedAt` set (= archived / in trash). */
export async function isCustomerArchived(
  prisma: any,
  customerId: string,
): Promise<boolean> {
  if (!customerId) return false;
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { deletedAt: true },
  });
  // Customer not found → treat as "not available" but not archived per se
  if (!c) return false;
  return c.deletedAt !== null;
}

/** Throws if the target customer is archived. Call this before assigning any
 *  record to a customerId in write endpoints. The error message is German to
 *  match the rest of the UI. */
export async function assertCustomerNotArchived(
  prisma: any,
  customerId: string,
): Promise<void> {
  if (!customerId) return;
  const archived = await isCustomerArchived(prisma, customerId);
  if (archived) {
    throw new CustomerArchivedError(customerId);
  }
}

/** Typed error so callers can distinguish from generic errors. */
export class CustomerArchivedError extends Error {
  public readonly customerId: string;
  constructor(customerId: string) {
    super(`Kunde ${customerId} ist archiviert (Papierkorb). Zuweisung nicht möglich.`);
    this.name = 'CustomerArchivedError';
    this.customerId = customerId;
  }
}

/** True iff the customer is missing at least one REQUIRED core field
 *  (name / address / plz / city). Phone and email are optional and never
 *  trigger this. */
export function isCustomerDataIncomplete(c: CustomerContactFields | null | undefined): boolean {
  if (!c) return true;
  return (
    isRequiredCustomerFieldMissing(c.name) ||
    isRequiredCustomerFieldMissing(c.address) ||
    isRequiredCustomerFieldMissing(c.plz) ||
    isRequiredCustomerFieldMissing(c.city)
  );
}
