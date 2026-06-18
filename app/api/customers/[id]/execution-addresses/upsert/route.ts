export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveDataScope } from "@/lib/data-scope";
import { requireUserId, unauthorizedResponse } from "@/lib/get-session";

const compact = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeKeyPart = (value: unknown) =>
  compact(value)
    .toLocaleLowerCase("de-CH")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "");

const addressKey = (value: any) =>
  [value?.siteAddress, value?.sitePlz, value?.siteCity]
    .map(normalizeKeyPart)
    .join("|");

const fullIdentityKey = (value: any) =>
  [
    value?.siteName,
    value?.siteAddress,
    value?.sitePlz,
    value?.siteCity,
    value?.siteNote,
  ]
    .map(normalizeKeyPart)
    .join("|");

export async function POST(
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
    const customerId = compact(params?.id);
    const dataScope = await getActiveDataScope(userId);
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        userId,
        dataScope,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!customer) {
      return NextResponse.json({ error: "Kunde nicht gefunden." }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const addressId = compact(body?.addressId);
    const saveMode = body?.saveMode === "update" ? "update" : "create";
    const siteName = compact(body?.siteName) || null;
    const siteAddress = compact(body?.siteAddress);
    const sitePlz = compact(body?.sitePlz);
    const siteCity = compact(body?.siteCity);
    const siteNote = compact(body?.siteNote) || null;

    if (!siteAddress || !sitePlz || !siteCity) {
      return NextResponse.json(
        { error: "Strasse, PLZ und Ort sind erforderlich." },
        { status: 400 },
      );
    }

    const table = (prisma as any).customerExecutionAddress;
    if (!table) {
      return NextResponse.json(
        { error: "Ausführungsorte sind nicht verfügbar." },
        { status: 500 },
      );
    }

    const payload = {
      siteName,
      siteAddress,
      sitePlz,
      siteCity,
      siteNote,
      country: "CH",
      userId,
      deletedAt: null,
      lastUsedAt: new Date(),
    };

    let existing: any = null;

    if (saveMode === "update") {
      if (!addressId) {
        return NextResponse.json(
          { error: "Der bestehende Ausführungsort konnte nicht eindeutig zugeordnet werden." },
          { status: 400 },
        );
      }
      existing = await table.findFirst({
        where: { id: addressId, customerId, deletedAt: null },
      });
      if (!existing) {
        return NextResponse.json(
          { error: "Der bestehende Ausführungsort wurde nicht gefunden." },
          { status: 404 },
        );
      }
    } else {
      const rows = await table.findMany({
        where: { customerId, deletedAt: null },
        orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }],
      });
      const incoming = { siteName, siteAddress, sitePlz, siteCity };

      // Sicherer Standard: Nur ein vollständig identischer Ort wird wiederverwendet.
      // Gleiche Adresse mit anderer Bezeichnung wird als neuer Ausführungsort angelegt.
      existing = rows.find(
        (row: any) => fullIdentityKey(row) === fullIdentityKey(incoming),
      );
    }

    const saved = existing
      ? await table.update({
          where: { id: existing.id },
          data: payload,
        })
      : await table.create({
          data: {
            customerId,
            ...payload,
            usageCount: 1,
          },
        });

    return NextResponse.json(saved);
  } catch (error) {
    console.error("[execution-address-upsert] failed", error);
    return NextResponse.json(
      { error: "Ausführungsort konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
