import { prisma } from '@/lib/prisma';
import { evaluateAccountStatus, type EffectiveAccountStatus } from '@/lib/account-status';

export interface GuardDecision {
  canAccess: boolean;
  status: EffectiveAccountStatus;
  reason?: string;
  message?: string;
}

const BLOCKED_MESSAGE = 'Account gesperrt – bitte kontaktieren';

/**
 * Enforces account access for protected API routes.
 *
 * Rules:
 * - blocked/anonymized/cancelled_expired => deny
 * - trial + trialEndDate in the past => auto-block in DB, then deny
 */
export async function enforceProtectedApiAccess(userId: string): Promise<GuardDecision> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      accountStatus: true,
      accessEndsAt: true,
      blockedAt: true,
      blockedReason: true,
      anonymizedAt: true,
      trialEndDate: true,
    },
  });

  const effective = evaluateAccountStatus(user as any);

  if (effective.status === 'trial_expired') {
    await prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: 'blocked',
        blockedAt: new Date(),
        blockedReason: 'trial_expired',
      },
    });

    return {
      canAccess: false,
      status: 'blocked',
      reason: 'trial_expired',
      message: BLOCKED_MESSAGE,
    };
  }

  if (!effective.canAccess) {
    return {
      canAccess: false,
      status: effective.status,
      reason: effective.reason,
      message: BLOCKED_MESSAGE,
    };
  }

  return {
    canAccess: true,
    status: effective.status,
  };
}

export { BLOCKED_MESSAGE };
