/**
 * Stage I — Plan resolution helper.
 *
 * Returns the current subscription plan for a user. Today (pre-Stripe) every
 * user is on the implicit Standard plan. The shape of the returned object is
 * intentionally future-proof so the Stripe integration only has to swap the
 * implementation, not the call sites.
 *
 * IMPORTANT — Stripe integration TODO:
 *   When Stripe billing goes live, replace the body of `getCurrentPlan` with a
 *   read against the user's Stripe subscription / `CompanySettings.plan` field
 *   (whichever is added at that time). Do NOT change the return shape, do NOT
 *   change the included-minutes / pricing constants without also updating the
 *   AudioUsageCard copy and the public marketing page.
 */

export type PlanName = 'Standard' | 'Pro';

export interface Plan {
  /** Human-readable plan label shown in the UI. */
  name: PlanName;
  /** Audio minutes included per calendar month. */
  includedMinutes: number;
  /** Monthly subscription price in CHF. */
  monthlyPriceChf: number;
  /** Per-extra-minute price in CHF (overage / pay-as-you-go). */
  extraMinutePriceChf: number;
  /**
   * `true` if the plan was *explicitly* known for this user; `false` if we
   * fell back to the safe Standard default (e.g. user has no plan attached
   * yet and Stripe is not wired up). The UI shows the same numbers either way,
   * but can use this flag to render a small "Plan unbekannt — Standard
   * angenommen" hint if desired.
   */
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
 * Resolves the active plan for the given user.
 *
 * Today: always Standard, marked as fallback (since no plan field exists yet).
 * Tomorrow (Stripe): look up the user's subscription and return the matching
 * plan with `isFallback: false`. If no subscription is found, fall back to
 * Standard with `isFallback: true` — same as today.
 *
 * @param userId Owner of the company. Currently unused; reserved for the
 *               Stripe-backed implementation.
 */
export async function getCurrentPlan(userId: string | null | undefined): Promise<Plan> {
  // TODO[Stripe]: replace this with a real subscription lookup.
  // For now, every user is on the implicit Standard plan. We mark it as a
  // fallback so the UI / API can show a small hint if it wants to.
  void userId;
  return { ...PLAN_STANDARD, isFallback: true };
}
