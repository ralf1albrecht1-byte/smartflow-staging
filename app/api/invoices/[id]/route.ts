export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveDataScope } from "@/lib/data-scope";
import {
  requireUserId,
  unauthorizedResponse,
  getSessionUser,
} from "@/lib/get-session";
import { logAuditAsync } from "@/lib/audit";
import { createArchivedPdfSnapshot } from "@/lib/archived-pdf";
import {
  assertCustomerNotArchived,
  CustomerArchivedError,
} from "@/lib/customer-links";


const invoiceOrderInclude = {
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
    },
  },
  workSites: {
    select: {
      id: true,
      siteName: true,
      siteAddress: true,
      sitePlz: true,
      siteCity: true,
      siteNote: true,
      isPrimary: true,
      sortOrder: true,
      sourceOrderId: true,
    },
  },
} as const;

function validateDocumentItemsForUpdate(items: any[]) {
  if (!Array.isArray(items)) return null;
  if (items.length === 0) return "Mindestens eine Leistung ist erforderlich.";

  const invalid = items.some(
    (item: any) =>
      !String(item?.description || "").trim() ||
      Number(item?.quantity || 0) <= 0 ||
      Number(item?.unitPrice || 0) <= 0,
  );

  return invalid
    ? "Preis/Menge prüfen: Dokument kann nicht mit leeren oder 0-Positionen gespeichert werden."
    : null;
}

const DEFAULT_PAYMENT_DAYS = 14;
const MIN_PAYMENT_DAYS = 1;
const MAX_PAYMENT_DAYS = 365;

function normalizeInvoicePaymentDays(value: unknown): number | null {
  const days = Number(value);
  if (!Number.isInteger(days)) return null;
  if (days < MIN_PAYMENT_DAYS || days > MAX_PAYMENT_DAYS) return null;
  return days;
}

async function resolveInvoicePaymentDays(
  userId: string,
  requestedValue: unknown,
): Promise<number> {
  const requested = normalizeInvoicePaymentDays(requestedValue);
  if (requested !== null) return requested;

  try {
    const stored = await prisma.counter.findUnique({
      where: { name: `invoice-payment-days:${userId}` },
      select: { value: true },
    });
    return normalizeInvoicePaymentDays(stored?.value) ?? DEFAULT_PAYMENT_DAYS;
  } catch {
    return DEFAULT_PAYMENT_DAYS;
  }
}

function parseInvoiceDateValue(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addInvoiceDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const dataScope = await getActiveDataScope(userId);
    const invoice = await prisma.invoice.findFirst({
      where: { id: params?.id, userId, dataScope },
      include: {
        customer: true,
        items: true,
        orders: { include: invoiceOrderInclude },
      },
    });
    if (!invoice)
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    return NextResponse.json({
      ...invoice,
      subtotal: Number(invoice?.subtotal ?? 0),
      vatAmount: Number(invoice?.vatAmount ?? 0),
      total: Number(invoice?.total ?? 0),
      items:
        invoice?.items?.map((i: any) => ({
          ...i,
          quantity: Number(i?.quantity ?? 0),
          unitPrice: Number(i?.unitPrice ?? 0),
          totalPrice: Number(i?.totalPrice ?? 0),
        })) ?? [],
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const dataScope = await getActiveDataScope(userId);
    const existing = await prisma.invoice.findFirst({
      where: { id: params?.id, userId, dataScope },
    });
    if (!existing)
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    const data = await request.json();
    const itemError = validateDocumentItemsForUpdate(data?.items);
    if (itemError)
      return NextResponse.json({ error: itemError }, { status: 400 });

    // ── Guard: block data-changing edits on archived (Erledigt) invoices ──
    // Allowed on archived: status changes (e.g. re-open) and notes.
    // Blocked on archived: items, dates, vatRate — these would create a mismatch
    // with the immutable archived PDF snapshot.
    if (existing.status === "Erledigt") {
      const hasDataEdit =
        Array.isArray(data?.items) ||
        data?.invoiceDate !== undefined ||
        data?.dueDate !== undefined ||
        data?.vatRate !== undefined;
      if (hasDataEdit) {
        return NextResponse.json(
          {
            error:
              'Archivierte Rechnungen (Status „Erledigt") können nicht mehr inhaltlich bearbeitet werden. Das archivierte PDF bleibt unverändert. Ändern Sie zuerst den Status, um die Rechnung wieder zu öffnen.',
          },
          { status: 400 },
        );
      }
    }

    // ── REOPEN: invalidate archived PDF snapshot when leaving "Erledigt" ──
    // When an invoice is reopened (status moves AWAY from Erledigt), the old
    // snapshot is immediately invalidated. This ensures that if the invoice is
    // later edited and re-archived, a FRESH snapshot is generated from the
    // updated content — the old snapshot is never served again.
    const isReopen =
      existing.status === "Erledigt" &&
      data?.status !== undefined &&
      data.status !== "Erledigt";
    if (isReopen && existing.archivedPdfPath) {
      console.log(
        `[archived-pdf] REOPEN: clearing archivedPdfPath for invoice ${params?.id} (was: ${existing.archivedPdfPath})`,
      );
    }

    // Guard: reject reassignment to an archived customer
    if (data?.customerId && data.customerId !== existing.customerId) {
      const activeCustomer = await prisma.customer.findFirst({
        where: { id: data.customerId, userId, dataScope, deletedAt: null },
        select: { id: true },
      });
      if (!activeCustomer) {
        return NextResponse.json({ error: "Kunde gehört nicht zum aktiven TEST-/LIVE-Bestand oder liegt im Papierkorb." }, { status: 409 });
      }
      await assertCustomerNotArchived(prisma, data.customerId);
    }

    const parsedInvoiceDate =
      data?.invoiceDate !== undefined
        ? parseInvoiceDateValue(data.invoiceDate)
        : null;
    if (data?.invoiceDate !== undefined && !parsedInvoiceDate) {
      return NextResponse.json(
        { error: "Das Rechnungsdatum ist ungültig." },
        { status: 400 },
      );
    }

    const parsedDueDate =
      data?.dueDate !== undefined && data?.dueDate !== null && data?.dueDate !== ""
        ? parseInvoiceDateValue(data.dueDate)
        : null;
    if (
      data?.dueDate !== undefined &&
      data?.dueDate !== null &&
      data?.dueDate !== "" &&
      !parsedDueDate
    ) {
      return NextResponse.json(
        { error: "Das Fälligkeitsdatum ist ungültig." },
        { status: 400 },
      );
    }

    const effectiveInvoiceDate =
      parsedInvoiceDate ?? new Date(existing.invoiceDate);
    let effectiveDueDate: Date | null | undefined;

    if (data?.dueDate !== undefined) {
      effectiveDueDate = parsedDueDate;
    } else if (data?.invoiceDate !== undefined) {
      const paymentDays = await resolveInvoicePaymentDays(
        userId,
        data?.paymentDays,
      );
      effectiveDueDate = addInvoiceDays(effectiveInvoiceDate, paymentDays);
    }

    if (
      effectiveDueDate &&
      effectiveDueDate.getTime() < effectiveInvoiceDate.getTime()
    ) {
      return NextResponse.json(
        { error: "Das Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen." },
        { status: 400 },
      );
    }

    const updateData: any = {};
    if (data?.customerId) updateData.customerId = data.customerId;
    if (isReopen) {
      // Explicitly null out the archived snapshot — mandatory on reopen
      updateData.archivedPdfPath = null;
    }
    if (data?.status !== undefined) updateData.status = data.status;
    if (data?.notes !== undefined) updateData.notes = data.notes;
    if (data?.currency !== undefined)
      updateData.currency = data.currency === "EUR" ? "EUR" : "CHF";
    if (data?.invoiceDate !== undefined)
      updateData.invoiceDate = parsedInvoiceDate;
    if (data?.dueDate !== undefined)
      updateData.dueDate = effectiveDueDate ?? null;
    else if (data?.invoiceDate !== undefined && effectiveDueDate)
      updateData.dueDate = effectiveDueDate;
    if (Array.isArray(data?.items)) {
      const vatRate =
        data.vatRate !== undefined && data.vatRate !== null
          ? Number(data.vatRate)
          : 8.1;
      let subtotal = 0;
      const itemsData = data.items.map((item: any) => {
        const qty = Number(item?.quantity ?? 0);
        const price = Number(item?.unitPrice ?? 0);
        const totalPrice = qty * price;
        subtotal += totalPrice;
        return {
          description: item?.description ?? "",
          quantity: qty,
          unit: item?.unit ?? "Stunde",
          unitPrice: price,
          totalPrice,
          siteName: item?.siteName || null,
          siteAddress: item?.siteAddress || null,
          sitePlz: item?.sitePlz || null,
          siteCity: item?.siteCity || null,
          siteNote: item?.siteNote || null,
          sourceOrderId: item?.sourceOrderId || null,
        };
      });
      const vatAmount = subtotal * (vatRate / 100);
      const total = subtotal + vatAmount;
      updateData.subtotal = subtotal;
      updateData.vatRate = vatRate;
      updateData.vatAmount = vatAmount;
      updateData.total = total;
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: params?.id } });
      await prisma.invoiceItem.createMany({
        data: itemsData.map((item: any) => ({
          ...item,
          invoiceId: params?.id,
        })),
      });
    }
    const invoice = await prisma.invoice.update({
      where: { id: params?.id },
      data: updateData,
      include: { customer: true, items: true },
    });
    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: "INVOICE_UPDATE",
      area: "INVOICES",
      targetType: "Invoice",
      targetId: params?.id,
      request,
    });

    // Trigger PDF snapshot when invoice is archived (status → Erledigt).
    // Fire-and-forget (best-effort async): archiving succeeds even if PDF generation fails.
    // If the invoice was previously archived, reopened, edited, and re-archived,
    // archivedPdfPath was cleared on reopen (see above), so this creates a FRESH snapshot.
    if (data?.status === "Erledigt" && existing.status !== "Erledigt") {
      createArchivedPdfSnapshot(params?.id, userId).catch(() => {});
    }

    return NextResponse.json({
      ...invoice,
      subtotal: Number(invoice?.subtotal ?? 0),
      vatAmount: Number(invoice?.vatAmount ?? 0),
      total: Number(invoice?.total ?? 0),
      items:
        invoice?.items?.map((i: any) => ({
          ...i,
          quantity: Number(i?.quantity ?? 0),
          unitPrice: Number(i?.unitPrice ?? 0),
          totalPrice: Number(i?.totalPrice ?? 0),
        })) ?? [],
    });
  } catch (error: any) {
    if (error instanceof CustomerArchivedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }
  try {
    const dataScope = await getActiveDataScope(userId);
    const existing = await prisma.invoice.findFirst({
      where: { id: params?.id, userId, dataScope },
    });
    if (!existing)
      return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    // Soft-delete the invoice — do NOT null invoiceId on linked orders to prevent them from resurfacing in active orders list
    await prisma.invoice.update({
      where: { id: params?.id },
      data: { deletedAt: new Date() },
    });
    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: "INVOICE_DELETE",
      area: "INVOICES",
      targetType: "Invoice",
      targetId: params?.id,
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
