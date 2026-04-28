/**
 * Block U — Admin-Endpoint: Konto anonymisieren.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireAdmin,
  getSessionUser,
  unauthorizedResponse,
  forbiddenResponse,
  accountInactiveResponse
} from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';
import { hasOtherActiveAdmin } from '@/lib/account-status';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  let adminId: string;

  try {
    adminId = await requireAdmin();
  } catch (e: any) {
    if (e?.code === 'ACCOUNT_INACTIVE') return accountInactiveResponse();
    if (e.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }

  const admin = await getSessionUser();
  const targetId = params.id;

  if (adminId === targetId) {
    return NextResponse.json(
      { error: 'Sie können Ihr eigenes Konto nicht anonymisieren.' },
      { status: 400 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));

    if (body?.confirm !== 'ANONYMISIEREN') {
      return NextResponse.json(
        { error: 'Bestätigung fehlt. Bitte „ANONYMISIEREN“ eingeben.' },
        { status: 400 }
      );
    }

    const requestId =
      typeof body?.requestId === 'string' ? body.requestId : undefined;

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        accountStatus: true,
        anonymizedAt: true
      }
    });

    if (!target) {
      return NextResponse.json(
        { error: 'Benutzer nicht gefunden.' },
        { status: 404 }
      );
    }

    if (target.anonymizedAt) {
      return NextResponse.json(
        { error: 'Bereits anonymisiert.' },
        { status: 400 }
      );
    }

    if ((target.role || '').toLowerCase() === 'admin') {
      const otherAdmins = await hasOtherActiveAdmin(targetId);
      if (!otherAdmins) {
        return NextResponse.json(
          { error: 'Letzter Admin kann nicht anonymisiert werden.' },
          { status: 400 }
        );
      }
    }

    const now = new Date();
    const anonEmail = `anon-${target.id}@anonymized.local`;

    let customersUpdated = 0;
    let sessionsDeleted = 0;
    let accountsDeleted = 0;

    await prisma.$transaction(async (tx: any) => {
      // Kunden anonymisieren
      const cu = await tx.customer.updateMany({
        where: { userId: targetId },
        data: {
          name: 'Anonymisiert',
          email: null,
          phone: null,
          notes: null,
          address: null,
          plz: null,
          city: null
        }
      });
      customersUpdated = cu.count;

      // Sessions löschen
      const sd = await tx.session.deleteMany({
        where: { userId: targetId }
      });
      sessionsDeleted = sd.count;

      // OAuth löschen
      const ad = await tx.account.deleteMany({
        where: { userId: targetId }
      });
      accountsDeleted = ad.count;

      // User anonymisieren
      await tx.user.update({
        where: { id: targetId },
        data: {
          email: anonEmail,
          name: null,
          image: null,
          password: null,
          emailVerified: null,
          accountStatus: 'anonymized',
          anonymizedAt: now,
          anonymizedBy: adminId,
          deletionCompletedAt: now,
          blockedAt: now,
          blockedReason: 'Anonymisiert'
        }
      });

      // Compliance
      if (requestId) {
        await tx.complianceRequest.updateMany({
          where: { id: requestId, userId: targetId },
          data: { status: 'completed', completedAt: now }
        });
      }
    });

    return NextResponse.json({
      ok: true,
      stats: {
        customersUpdated,
        sessionsDeleted,
        accountsDeleted
      }
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Fehler bei Anonymisierung' },
      { status: 500 }
    );
  }
}