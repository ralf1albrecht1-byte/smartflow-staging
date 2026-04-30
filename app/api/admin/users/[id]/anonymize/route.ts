/**
 * Block U — Admin-Endpoint: Konto anonymisieren.
 *
 * Body: { confirm: 'ANONYMISIEREN', requestId?: string }
 *
 * KEIN Hard-Delete. Wir behalten Rechnungen/Angebote/Aufträge/AuditLog/
 * ConsentRecords aus Aufbewahrungs- und Beweispflichten. Wir entfernen
 * personenbezogene Daten:
 *   User:      email → anon-{cuid}@anonymized.local, name=null, image=null,
 *              password=null, accountStatus='anonymized', anonymizedAt=now,
 *              anonymizedBy=adminId, deletionCompletedAt=now, blockedAt=now
 *   Customer:  Name auf 'Anonymisiert', email/phone/notes/address/plz/city=null
 *              (NUR Customer dieses Users)
 *   Sessions:  alle löschen
 *   Account:   OAuth-Verknüpfungen löschen
 *
 * Behalten wir bewusst:
 *   - Order, Invoice, Offer (legal retention)
 *   - AuditLog (Beweispflichten)
 *   - ConsentRecord (Compliance)
 *   - CompanySettings (mit verlinktem userId; bleibt für Buchhaltungsprüfung)
 */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, getSessionUser, unauthorizedResponse, forbiddenResponse, accountInactiveResponse } from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';
import { hasOtherActiveAdmin } from '@/lib/account-status';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let adminId: string;
  try { adminId = await requireAdmin(); } catch (e: any) {
    if (e?.code === 'ACCOUNT_INACTIVE') return accountInactiveResponse();
    if (e.message === 'FORBIDDEN') return forbiddenResponse();
    return unauthorizedResponse();
  }
  const admin = await getSessionUser();
  const targetId = params.id;

  if (adminId === targetId) {
    return NextResponse.json({ error: 'Sie können Ihr eigenes Konto nicht anonymisieren.' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (body?.confirm !== 'ANONYMISIEREN') {
      return NextResponse.json({ error: 'Bestätigung fehlt. Bitte tippen Sie „ANONYMISIEREN“ zur Bestätigung ein.' }, { status: 400 });
    }
    const requestId: string | undefined = typeof body?.requestId === 'string' ? body.requestId : undefined;

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, name: true, role: true, accountStatus: true, anonymizedAt: true },
    });
    if (!target) return NextResponse.json({ error: 'Benutzer nicht gefunden.' }, { status: 404 });
    if (target.anonymizedAt) {
      return NextResponse.json({ error: 'Konto ist bereits anonymisiert.' }, { status: 400 });
    }

    if ((target.role || '').toLowerCase() === 'admin') {
      const otherAdmins = await hasOtherActiveAdmin(targetId);
      if (!otherAdmins) {
        return NextResponse.json({ error: 'Der letzte aktive Admin kann nicht anonymisiert werden.' }, { status: 400 });
      }
    }

    // STARTED-Audit BEVOR wir Daten anfassen — damit auch im Fehlerfall
    // nachvollziehbar ist, was begonnen wurde.
    logAuditAsync({
      userId: adminId,
      userEmail: admin?.email || null,
      userRole: admin?.role || 'admin',
      action: EVENTS.ACCOUNT_ANONYMIZATION_STARTED,
      area: AREAS.ACCOUNT,
      targetType: 'User',
      targetId,
      success: true,
      details: { targetEmail: target.email, requestId: requestId || null },
      request,
    });

    const now = new Date();
    const anonEmail = `anon-${target.id}@anonymized.local`;

    let customersUpdated = 0;
    let sessionsDeleted = 0;
    let accountsDeleted = 0;

    try {
      await prisma.$transaction(async (tx: any) => {
        // 1) Customer-PII redigieren — NUR Customer dieses Users.
        const cu = await tx.customer.updateMany({
          where: { userId: targetId },
          data: {
            name: 'Anonymisiert',
            email: null,
            phone: null,
            notes: null,
            address: null,
            plz: null,
            city: null,
          },
        });
        customersUpdated = cu.count;

        // 2) DB-Sessions löschen.
        const sd = await tx.session.deleteMany({ where: { userId: targetId } });
        sessionsDeleted = sd.count;

        // 3) OAuth-Accounts löschen.
        const ad = await tx.account.deleteMany({ where: { userId: targetId } });
        accountsDeleted = ad.count;

        // 4) User-PII redigieren + Status setzen.
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
            blockedReason: 'Anonymisiert auf Wunsch des Nutzers',
            // accessEndsAt bewusst NICHT überschreiben — nur informativ.
          },
        });

        // 5) Falls eine ComplianceRequest mitgegeben wurde: completedAt + status.
        if (requestId) {
          await tx.complianceRequest.updateMany({
            where: { id: requestId, userId: targetId },
            data: { status: 'completed', completedAt: now },
          });
        }
      });
    } catch (txErr: any) {
      console.error('[admin/users/anonymize] transaction failed:', txErr);
      logAuditAsync({
        userId: adminId,
        userEmail: admin?.email || null,
        userRole: admin?.role || 'admin',
        action: EVENTS.ACCOUNT_ANONYMIZATION_FAILED,
        area: AREAS.ACCOUNT,
        targetType: 'User',
        targetId,
        success: false,
        errorMessage: txErr?.message || 'transaction_failed',
        details: { requestId: requestId || null },
        request,
      });
      return NextResponse.json({ error: 'Anonymisierung fehlgeschlagen. Bitte versuchen Sie es erneut.' }, { status: 500 });
    }

    logAuditAsync({
      userId: adminId,
      userEmail: admin?.email || null,
      userRole: admin?.role || 'admin',
      action: EVENTS.ACCOUNT_ANONYMIZATION_COMPLETED,
      area: AREAS.ACCOUNT,
      targetType: 'User',
      targetId,
      success: true,
      details: {
        previousEmail: target.email,
        anonymizedEmail: anonEmail,
        customersUpdated,
        sessionsDeleted,
        accountsDeleted,
        requestId: requestId || null,
      },
      request,
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: targetId,
        accountStatus: 'anonymized',
        anonymizedAt: now.toISOString(),
      },
      stats: { customersUpdated, sessionsDeleted, accountsDeleted },
    });
  } catch (error: any) {
    console.error('[admin/users/anonymize] error:', error);
    return NextResponse.json({ error: 'Fehler bei der Anonymisierung.' }, { status: 500 });
  }
}
