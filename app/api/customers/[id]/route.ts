export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeCustomerData } from '@/lib/normalize';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';
import { generateCustomerNumber } from '@/lib/customer-number';
import {
  getCustomerDeleteBlockerCounts,
  isCustomerDeleteBlocked,
  formatCustomerDeleteBlockerMessage,
} from '@/lib/customer-links';
import { getActiveDataScope } from '@/lib/data-scope';

/**
 * Unicode-sichere Normalisierung für manuell eingegebene Kundennamen.
 *
 * Wichtig:
 * - arbeitet direkt mit raw.name, damit eine ältere ASCII-Wortgrenzenlogik
 *   aus normalizeCustomerData() Umlaute nicht erneut beschädigen kann;
 * - NFC normalisiert zusammengesetzte Unicode-Zeichen;
 * - vollständig kleingeschriebene Wörter erhalten nur einen großen Anfang;
 * - bereits bewusst gemischte Eigenschreibweisen bleiben erhalten;
 * - vollständig großgeschriebene Kürzel bleiben erhalten.
 */
function normalizeCustomerNameUnicode(value: unknown): string {
  const input = String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ');

  if (!input) return '';

  return input
    .split(/(\s+|[-/])/u)
    .map((part) => {
      if (!part || /^\s+$/u.test(part) || /^[-/]$/u.test(part)) return part;

      const hasLetter = /\p{L}/u.test(part);
      if (!hasLetter) return part;

      const lower = part.toLocaleLowerCase('de-CH');
      const upper = part.toLocaleUpperCase('de-CH');

      // Bereits komplett großgeschriebene Kürzel wie AG, GmbH-Teile usw. behalten.
      if (part === upper) return part;

      // Bewusste Eigenschreibweisen mit inneren Großbuchstaben beibehalten.
      const withoutFirst = Array.from(part).slice(1).join('');
      if (/\p{Lu}/u.test(withoutFirst)) return part;

      // Vollständig kleingeschriebene Wörter Unicode-sicher groß beginnen.
      if (part === lower) {
        const chars = Array.from(part);
        const first = chars.shift() ?? '';
        return first.toLocaleUpperCase('de-CH') + chars.join('');
      }

      // Bereits korrekt geschriebene Namen unverändert lassen.
      return part;
    })
    .join('');
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }

  try {
    const dataScope = await getActiveDataScope(userId);
    const customer = await prisma.customer.findFirst({
      where: { id: params?.id, userId, dataScope },
      include: {
        orders: { where: { dataScope }, orderBy: { date: 'desc' } },
        executionAddresses: {
          where: { deletedAt: null },
          orderBy: [{ lastUsedAt: 'desc' }, { updatedAt: 'desc' }],
        },
        invoices: { where: { dataScope }, orderBy: { invoiceDate: 'desc' } },
        offers: { where: { dataScope }, orderBy: { offerDate: 'desc' } },
      },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    }

    return NextResponse.json(customer);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }

  try {
    const dataScope = await getActiveDataScope(userId);
    const existing = await prisma.customer.findFirst({
      where: { id: params?.id, userId, dataScope },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    }

    const raw = await request.json();
    const data = normalizeCustomerData(raw);

    // V17.90L68B: Kundennamen aus der manuellen Eingabe Unicode-sicher
    // normalisieren und eine ältere fehlerhafte Umlaut-Wortgrenze überschreiben.
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'name')) {
      data.name = normalizeCustomerNameUnicode(raw?.name);
    }

    const oldCustomer = existing;

    // Phase 2f: opt-in clear-protection.
    const fieldsToClearRaw = Array.isArray(raw?.fieldsToClear) ? raw.fieldsToClear : [];
    const fieldsToClear = new Set<string>(
      fieldsToClearRaw.filter((v: unknown): v is string => typeof v === 'string'),
    );

    const protectedFields: Array<{
      key: 'name' | 'address' | 'plz' | 'city' | 'phone' | 'email';
      normalizedValue: string | null;
    }> = [
      { key: 'name', normalizedValue: data.name?.trim() ? data.name : null },
      { key: 'address', normalizedValue: data.address ?? null },
      { key: 'plz', normalizedValue: data.plz ?? null },
      { key: 'city', normalizedValue: data.city ?? null },
      { key: 'phone', normalizedValue: data.phone ?? null },
      { key: 'email', normalizedValue: data.email ?? null },
    ];

    for (const { key, normalizedValue } of protectedFields) {
      const isPresent = Object.prototype.hasOwnProperty.call(raw ?? {}, key);
      if (!isPresent) continue;

      const existingValue = (existing as any)[key] as string | null | undefined;
      const existingHas = Boolean(existingValue && String(existingValue).trim());
      const willClear = !normalizedValue || !String(normalizedValue).trim();

      if (existingHas && willClear && !fieldsToClear.has(key)) {
        const su = await getSessionUser();
        logAuditAsync({
          userId: su?.id,
          userEmail: su?.email,
          userRole: su?.role,
          action: 'CUSTOMER_UPDATE_REJECTED',
          area: 'CUSTOMERS',
          targetType: 'Customer',
          targetId: params?.id,
          details: { field: key, reason: 'would_clear_existing_value' },
          request,
        });

        return NextResponse.json(
          {
            error: `Feld "${key}" würde einen bestehenden Wert löschen. Bitte explizit über fieldsToClear freigeben.`,
            field: key,
            reason: 'would_clear_existing_value',
          },
          { status: 400 },
        );
      }
    }

    // Nur tatsächlich gesendete Felder ändern.
    const updateData: any = {};

    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'name')) {
      updateData.name = data.name;
    }
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'address')) {
      updateData.address = data.address;
    }
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'plz')) {
      updateData.plz = data.plz;
    }
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'city')) {
      updateData.city = data.city;
    }
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'phone')) {
      updateData.phone = data.phone;
    }
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'email')) {
      updateData.email = data.email;
    }
    if (Object.prototype.hasOwnProperty.call(raw ?? {}, 'notes')) {
      updateData.notes = data.notes;
    }
    if (data.country !== undefined) {
      updateData.country = data.country;
    }
    if (raw?.customerNumber !== undefined) {
      updateData.customerNumber = raw.customerNumber;
    }

    // Kundenentwurf erst bei vollständigen Hauptdaten finalisieren.
    const nextName = Object.prototype.hasOwnProperty.call(updateData, 'name')
      ? updateData.name
      : existing.name;
    const nextAddress = Object.prototype.hasOwnProperty.call(updateData, 'address')
      ? updateData.address
      : existing.address;
    const nextPlz = Object.prototype.hasOwnProperty.call(updateData, 'plz')
      ? updateData.plz
      : existing.plz;
    const nextCity = Object.prototype.hasOwnProperty.call(updateData, 'city')
      ? updateData.city
      : existing.city;

    const completesDraftCustomer = Boolean(
      !existing.customerNumber &&
        !Object.prototype.hasOwnProperty.call(raw ?? {}, 'customerNumber') &&
        String(nextName || '').trim() &&
        String(nextAddress || '').trim() &&
        String(nextPlz || '').trim() &&
        String(nextCity || '').trim(),
    );

    if (completesDraftCustomer) {
      const canonicalCustomerKeyPart = (value: unknown) =>
        String(value ?? '')
          .trim()
          .replace(/\s+/g, ' ')
          .toLocaleLowerCase('de-CH');

      const nextKey = {
        name: canonicalCustomerKeyPart(nextName),
        address: canonicalCustomerKeyPart(nextAddress),
        plz: canonicalCustomerKeyPart(nextPlz),
        city: canonicalCustomerKeyPart(nextCity),
      };

      const existingRealCustomers = await prisma.customer.findMany({
        where: {
          userId,
          dataScope,
          deletedAt: null,
          id: { not: params?.id },
          customerNumber: { not: null },
        },
        select: {
          id: true,
          customerNumber: true,
          name: true,
          address: true,
          plz: true,
          city: true,
          country: true,
          phone: true,
          email: true,
          notes: true,
        },
      });

      const matchingExistingCustomer = existingRealCustomers.find(
        (candidate) =>
          canonicalCustomerKeyPart(candidate.name) === nextKey.name &&
          canonicalCustomerKeyPart(candidate.address) === nextKey.address &&
          canonicalCustomerKeyPart(candidate.plz) === nextKey.plz &&
          canonicalCustomerKeyPart(candidate.city) === nextKey.city,
      );

      if (matchingExistingCustomer) {
        const reassignedCustomer = await prisma.$transaction(async (tx) => {
          await tx.order.updateMany({
            where: {
              customerId: params?.id,
              dataScope,
              deletedAt: null,
            },
            data: { customerId: matchingExistingCustomer.id },
          });

          await tx.customer.update({
            where: { id: params?.id },
            data: { deletedAt: new Date() },
          });

          return tx.customer.findUnique({
            where: { id: matchingExistingCustomer.id },
          });
        });

        const suMerge = await getSessionUser();
        logAuditAsync({
          userId: suMerge?.id,
          userEmail: suMerge?.email,
          userRole: suMerge?.role,
          action: 'CUSTOMER_DRAFT_REASSIGN_TO_EXISTING',
          area: 'CUSTOMERS',
          targetType: 'Customer',
          targetId: matchingExistingCustomer.id,
          details: {
            draftCustomerId: params?.id,
            matchedCustomerNumber: matchingExistingCustomer.customerNumber,
          },
          request,
        });

        return NextResponse.json(
          reassignedCustomer ?? matchingExistingCustomer,
        );
      }

      updateData.customerNumber = await generateCustomerNumber(userId, dataScope);
    }

    const customer = await prisma.customer.update({
      where: { id: params?.id },
      data: updateData,
    });

    if (fieldsToClear.size > 0) {
      const su2 = await getSessionUser();
      const clearedNow: string[] = [];

      fieldsToClear.forEach((key) => {
        const oldValue = (existing as any)[key];
        if (oldValue && String(oldValue).trim()) {
          clearedNow.push(key);
        }
      });

      if (clearedNow.length > 0) {
        logAuditAsync({
          userId: su2?.id,
          userEmail: su2?.email,
          userRole: su2?.role,
          action: 'CUSTOMER_FIELDS_CLEARED',
          area: 'CUSTOMERS',
          targetType: 'Customer',
          targetId: params?.id,
          details: { fields: clearedNow },
          request,
        });
      }
    }

    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: 'CUSTOMER_UPDATE',
      area: 'CUSTOMERS',
      targetType: 'Customer',
      targetId: params?.id,
      request,
    });

    const addressChanged =
      oldCustomer &&
      (oldCustomer.name !== data.name ||
        oldCustomer.address !== data.address ||
        oldCustomer.plz !== data.plz ||
        oldCustomer.city !== data.city);

    if (addressChanged) {
      const hasName = Boolean(data.name?.trim());
      const hasAddress =
        Boolean(data.address?.trim()) ||
        (Boolean(data.plz?.trim()) && Boolean(data.city?.trim()));

      if (hasName && hasAddress) {
        await prisma.order.updateMany({
          where: {
            customerId: params?.id,
            dataScope,
            deletedAt: null,
            needsReview: true,
          },
          data: {
            needsReview: false,
            reviewReasons: [],
          },
        });
      }
    }

    return NextResponse.json(customer);
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { error: 'Fehler beim Aktualisieren' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }

  try {
    const dataScope = await getActiveDataScope(userId);
    const existing = await prisma.customer.findFirst({
      where: { id: params?.id, userId, dataScope },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    }

    const counts = await getCustomerDeleteBlockerCounts(
      prisma,
      params.id,
      userId,
      dataScope,
    );

    if (isCustomerDeleteBlocked(counts)) {
      return NextResponse.json(
        {
          error: formatCustomerDeleteBlockerMessage(counts),
          activeOrders: counts.activeOrders,
          activeOffers: counts.activeOffers,
          activeInvoices: counts.activeInvoices,
          archivedInvoices: counts.archivedInvoices,
          historicalOrders: counts.historicalOrders,
          historicalOffers: counts.historicalOffers,
          totalOrders: counts.activeOrders,
          totalOffers: counts.activeOffers,
          currentInvoices: counts.activeInvoices,
          blocked: true,
        },
        { status: 409 },
      );
    }

    await prisma.customer.update({
      where: { id: params?.id },
      data: { deletedAt: new Date() },
    });

    const su = await getSessionUser();
    logAuditAsync({
      userId: su?.id,
      userEmail: su?.email,
      userRole: su?.role,
      action: 'CUSTOMER_DELETE',
      area: 'CUSTOMERS',
      targetType: 'Customer',
      targetId: params?.id,
      request,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { error: 'Fehler beim Löschen' },
      { status: 500 },
    );
  }
}
