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

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due']);

function mapSubscriptionPlanToUiPlan(subscriptionPlan: string | null | undefined): Omit<Plan, 'isFallback'> | null {
  if (!subscriptionPlan) return null;

  const normalized = subscriptionPlan.trim().toLowerCase();

  if (normalized === 'pro') {
    return PLAN_PRO;
  }

  if (normalized === 'basic' || normalized === 'standard' || normalized === 'free') {
    return PLAN_STANDARD;
  }

  return null;
}

export async function getCurrentPlan(userId: string | null | undefined): Promise<Plan> {
  if (!userId) {
    return { ...PLAN_STANDARD, isFallback: true };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionPlan: true,
      subscriptionStatus: true,
      accountStatus: true,
    },
  });

  if (!user) {
    return { ...PLAN_STANDARD, isFallback: true };
  }

  const mappedPlan = mapSubscriptionPlanToUiPlan(user.subscriptionPlan);
  const isStripeSubscriptionActive = ACTIVE_SUBSCRIPTION_STATUSES.has((user.subscriptionStatus || '').toLowerCase());
  const isAccountActive = (user.accountStatus || '').toLowerCase() === 'active';

  if (mappedPlan && isStripeSubscriptionActive && isAccountActive) {
    return { ...mappedPlan, isFallback: false };
  }

  return { ...PLAN_STANDARD, isFallback: true };
}
