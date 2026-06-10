export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireUserId,
  unauthorizedResponse,
  getSessionUser,
} from "@/lib/get-session";
import { logAuditAsync } from "@/lib/audit";

const DEFAULT_PAYMENT_DAYS = 14;
const MIN_PAYMENT_DAYS = 1;
const MAX_PAYMENT_DAYS = 365;

const counterName = (userId: string) => `invoice-payment-days:${userId}`;

function normalizePaymentDays(value: unknown): number | null {
  const days = Number(value);
  if (!Number.isInteger(days)) return null;
  if (days < MIN_PAYMENT_DAYS || days > MAX_PAYMENT_DAYS) return null;
  return days;
}

export async function GET() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }

  try {
    const name = counterName(userId);
    const stored = await prisma.counter.findUnique({ where: { name } });
    const paymentDays = normalizePaymentDays(stored?.value) ?? DEFAULT_PAYMENT_DAYS;

    if (!stored || stored.value !== paymentDays) {
      await prisma.counter.upsert({
        where: { name },
        update: { value: paymentDays },
        create: { name, value: paymentDays },
      });
    }

    return NextResponse.json({ paymentDays });
  } catch (error) {
    console.error("GET /api/settings/invoice-payment-terms error:", error);
    return NextResponse.json(
      { error: "Zahlungsfrist konnte nicht geladen werden." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json().catch(() => null);
    const paymentDays = normalizePaymentDays(body?.paymentDays);

    if (paymentDays === null) {
      return NextResponse.json(
        { error: "Die Zahlungsfrist muss zwischen 1 und 365 Tagen liegen." },
        { status: 400 },
      );
    }

    await prisma.counter.upsert({
      where: { name: counterName(userId) },
      update: { value: paymentDays },
      create: { name: counterName(userId), value: paymentDays },
    });

    const sessionUser = await getSessionUser();
    logAuditAsync({
      userId: sessionUser?.id,
      userEmail: sessionUser?.email,
      userRole: sessionUser?.role,
      action: "INVOICE_PAYMENT_TERMS_UPDATE",
      area: "SETTINGS",
      details: { paymentDays },
      request,
    });

    return NextResponse.json({ paymentDays });
  } catch (error) {
    console.error("PUT /api/settings/invoice-payment-terms error:", error);
    return NextResponse.json(
      { error: "Zahlungsfrist konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
