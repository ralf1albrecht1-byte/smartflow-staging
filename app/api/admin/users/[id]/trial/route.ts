/**
 * Phase 3 — Admin: set or clear a user's trial end date.
 *
 * PUT /api/admin/users/[id]/trial
 *   Body: { trialEndDate: string | null, trialNote?: string | null }
 *     - trialEndDate=null  → clear trial (unlimited account, default state).
 *     - trialEndDate=ISO   → set trial to the given date (UTC).
 *   Returns: { ok: true, user: { id, email, trialEndDate, trialNote } }
 *
 * SOFT-ONLY contract: setting/clearing the trial only affects the visible
 * banner. Login and usage are NEVER blocked by this field. Admins are
 * encouraged to add a short trialNote (German free-text) for context.
 *
 * Audit:
 *   - USER_TRIAL_SET when trialEndDate transitions to a non-null value
 *   - USER_TRIAL_CLEARED when trialEndDate transitions to null
 *   Both events include adminId, userEmail, previous and new values.
 */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  requireAdmin,
  getSessionUser,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/get-session';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch (e: any) {
    if (e?.message === 'UNAUTHORIZED') return unauthorizedResponse();
    if (e?.message === 'FORBIDDEN') return forbiddenResponse();
    return NextResponse.json({ error: 'Server-Fehler' }, { status: 500 });
  }

  const adminUser = await getSessionUser();
  const targetId = params?.id;
  if (!targetId) {
    return NextResponse.json({ error: 'Benutzer-ID fehlt' }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ung\u00fcltiger Request-Body' }, { status: 400 });
  }

  // Validate trialEndDate input. We accept:
  //   - null  / undefined / ''   → clear
  //   - ISO date string          → set
  let nextTrial: Date | null = null;
  if (body?.trialEndDate === null || body?.trialEndDate === undefined || body?.trialEndDate === '') {
    nextTrial = null;
  } else if (typeof body.trialEndDate === 'string') {
    const parsed = new Date(body.trialEndDate);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Ung\u00fcltiges Datum f\u00fcr trialEndDate' }, { status: 400 });
    }
    nextTrial = parsed;
  } else {
    return NextResponse.json({ error: 'trialEndDate muss ISO-String oder null sein' }, { status: 400 });
  }

  // Optional note. Empty string → cleared (null).
  let nextNote: string | null = null;
  if (typeof body?.trialNote === 'string') {
    const trimmed = body.trialNote.trim();
    nextNote = trimmed.length > 0 ? trimmed.slice(0, 500) : null;
  } else if (body?.trialNote === null) {
    nextNote = null;
  } else if (body?.trialNote === undefined) {
    // Preserve existing note if caller did not include the field.
    nextNote = undefined as any;
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      email: true,
      trialEndDate: true,
      trialNote: true,
    },
  });
  if (!target) {
    return NextResponse.json({ error: 'Benutzer nicht gefunden' }, { status: 404 });
  }

  // Build update payload — only include trialNote when explicitly provided.
  const updateData: any = { trialEndDate: nextTrial };
  if (nextNote !== (undefined as any)) updateData.trialNote = nextNote;

  const updated = await prisma.user.update({
    where: { id: targetId },
    data: updateData,
    select: { id: true, email: true, trialEndDate: true, trialNote: true },
  });

  const previousIso = target.trialEndDate ? target.trialEndDate.toISOString() : null;
  const nextIso = updated.trialEndDate ? updated.trialEndDate.toISOString() : null;
  const isClearing = nextIso === null;

  logAuditAsync({
    userId: adminId,
    userEmail: adminUser?.email || null,
    userRole: adminUser?.role || 'admin',
    action: isClearing ? EVENTS.USER_TRIAL_CLEARED : EVENTS.USER_TRIAL_SET,
    area: AREAS.ADMIN,
    targetType: 'User',
    targetId: target.id,
    success: true,
    details: {
      targetEmail: target.email,
      previousTrialEndDate: previousIso,
      newTrialEndDate: nextIso,
      previousNote: target.trialNote || null,
      newNote: updated.trialNote || null,
    },
    request,
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: updated.id,
      email: updated.email,
      trialEndDate: nextIso,
      trialNote: updated.trialNote || null,
    },
  });
}
