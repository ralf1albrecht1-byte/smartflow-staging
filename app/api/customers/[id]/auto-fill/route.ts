export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveDataScope } from "@/lib/data-scope";
import { requireUserId, unauthorizedResponse } from "@/lib/get-session";
import { logAuditAsync } from "@/lib/audit";

/**
 * V17.90L277 — harter Canonical-Lock für Kundendaten.
 *
 * Diese Route bleibt aus Kompatibilitätsgründen bestehen, ist aber absichtlich
 * read-only. Freitext aus Aufträgen kann mehrere Rollen enthalten:
 * Rechnungskunde, Ausführungsadresse, Kontaktperson, Weiterleiter oder interne
 * Hinweise. Daraus dürfen niemals automatisch Name, Rechnungsadresse, Telefon
 * oder E-Mail des zentralen Kundenstamms geschrieben werden.
 *
 * Kundendaten ändern sich ausschließlich durch eine ausdrückliche manuelle
 * Benutzeraktion oder einen separat freigegebenen kanonischen Prozess.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }

    const dataScope = await getActiveDataScope(userId);
    const customer = await prisma.customer.findFirst({
      where: {
        id: params.id,
        userId,
        dataScope,
        deletedAt: null,
      },
    });

    if (!customer) {
      return NextResponse.json(
        { error: "Kunde nicht gefunden" },
        { status: 404 },
      );
    }

    logAuditAsync({
      userId,
      action: "CUSTOMER_AUTOFILL_SKIPPED_CANONICAL_LOCK",
      area: "CUSTOMER",
      targetType: "Customer",
      targetId: customer.id,
      success: true,
      details: {
        reason: "free_text_must_not_mutate_customer_master",
      },
      request,
    });

    return NextResponse.json(customer);
  } catch (error: any) {
    console.error("[auto-fill] Fehler:", error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}
