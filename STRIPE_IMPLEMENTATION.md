# Stripe Subscription Implementation (test-stripe)

## What was changed

- Added Stripe SDK dependency.
- Extended Prisma `User` model with Stripe subscription fields.
- Added `StripeWebhookEvent` model for webhook idempotency and error tracking.
- Added Stripe singleton client + helper utilities.
- Implemented checkout session API route.
- Implemented Stripe webhook API route with signature validation, transactional idempotency, and event processing.
- Updated plan resolution to use DB-backed subscription state.
- Updated audio usage card to call checkout API instead of showing "coming soon".
- Added `.env.example` with required Stripe variables.

## Files created/modified

### Created
- `lib/stripe.ts`
- `lib/stripe-helpers.ts`
- `app/api/stripe/create-checkout-session/route.ts`
- `app/api/stripe/webhook/route.ts`
- `prisma/migrations/migration_lock.toml`
- `prisma/migrations/20260502093000_add_stripe_subscription/migration.sql`
- `.env.example`
- `STRIPE_IMPLEMENTATION.md`

### Modified
- `package.json`
- `package-lock.json`
- `prisma/schema.prisma`
- `lib/plan.ts`
- `lib/account-status.ts`
- `components/audio-usage-card.tsx`

## Required environment variables

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_BASIC`
- `STRIPE_PRICE_ID_PRO`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## Stripe webhook URL

- Test Railway service webhook endpoint:
  - `https://smartflow-test-production.up.railway.app/api/stripe/webhook`

## Testing instructions

1. Ensure all Stripe env vars are set in the test environment.
2. Start app locally and trigger checkout from dashboard usage card.
3. Complete checkout in Stripe hosted page.
4. Trigger webhook events via Stripe CLI (or dashboard test events) and verify:
   - `User` Stripe fields update correctly
   - `accountStatus` transitions correctly (`active`/`inactive`)
   - duplicate events are skipped through `StripeWebhookEvent`
5. Validate plan resolution on dashboard after webhook updates.

## Migration commands (do not run yet)

**Deployment strategy note:**
- **TEST** uses `prisma db push` for rapid iteration in this branch/environment.
- **STAGING/LIVE** should use `prisma migrate deploy` (not changed here).

```bash
# Generate migration locally (already prepared manually in this branch)
# npx prisma migrate dev --name add_stripe_subscription

# Apply in deployment pipeline when approved
# npx prisma migrate deploy
```
