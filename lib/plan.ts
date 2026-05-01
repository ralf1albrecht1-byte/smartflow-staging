import { prisma } from '@/lib/prisma';

export type PlanName = 'Standard' | 'Pro';

export interface Plan {
  name: PlanName;
  includedMinutes: number;
  monthlyPriceChf: number;
  extraMinutePriceChf: number;
  isFallback: boolean;
}

export const PLAN_STANDARD: Omit<Plan, 'isFallback'> = {
  name: 'Standard',
  includedMinutes: 20,
  monthlyPriceChf: 39,
  extraMinutePriceChf: 0.6,
};

export const PLAN_PRO: Omit<Plan, 'isFallback'> = {
  name: 'Pro',
  includedMinutes: 60,
  monthlyPriceChf: 79,
  extraMinutePriceChf: 0.6,
};

/**
 * Returns active plan + user-specific extra minutes.
 *
 * Mapping for now:
 * - subscriptionStatus in {active, trialing} => Pro
 * - otherwise => Standard fallback
 *
 * Additional audio minutes are always added on top of the base plan.
 */
export async function getCurrentPlan(userId: string | null | undefined): Promise<Plan> {
  if (!userId) {
    return { ...PLAN_STANDARD, isFallback: true };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionStatus: true,
      audioExtraMinutes: true,
    },
  });

  if (!user) {
    return { ...PLAN_STANDARD, isFallback: true };
  }

  const hasPaidPlan = user.subscriptionStatus === 'active' || user.subscriptionStatus === 'trialing';
  const basePlan = hasPaidPlan ? PLAN_PRO : PLAN_STANDARD;
  const extraMinutes = Math.max(0, user.audioExtraMinutes || 0);

  return {
    ...basePlan,
    includedMinutes: basePlan.includedMinutes + extraMinutes,
    isFallback: !hasPaidPlan,
  };
}
