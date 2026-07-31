# Couranr Repository Cutover Matrix

## Preservation checkpoint

Before code removal or database mutation:

| Item | Required action |
|---|---|
| Repository tag | Create and push `legacy-multiservice-2026-07-27` |
| Archive branch | Create and push `archive/auto-docs-multiservice` |
| Implementation branch | Create `feature/merchant-delivery-mvp` |
| Database | Produce verified backup and restore instructions |
| Stripe | Inventory webhooks, products, prices, and live/test objects |
| Storage | Inventory buckets and public/private status |
| Environment | Inventory variables without printing values |
| Routes | Generate complete route manifest |
| Database | Generate schema/table/function/trigger/RLS manifest |

No destructive action before preservation is verified.

## Retain and adapt

| Current area | Target |
|---|---|
| Next.js 14, React, TypeScript | Continue current stack |
| Supabase Auth | Unified identity |
| `business_accounts` | Merchant tenant root |
| `business_members` | Role-aware merchant membership |
| Business access helper | Server authorization plus RLS |
| Address concepts | Structured, validated, snapshotted |
| Driver UI concepts | Assignment-scoped projection |
| Stripe SDK | Payment obligations and attempts |
| Webhook signature verification | Delivery-specific webhook |
| Resend | Receipts and nonurgent email |
| Maps | Server-validated route/address |
| Vitest and `npm run check` | Expanded security/payment/lifecycle suite |

## Replace

| Legacy area | Replacement |
|---|---|
| `/courier/quote` | `/estimate` and Smart Intake |
| `/courier/checkout` | Request/quote/payment-token flows |
| `/api/delivery/quote` | Server loads validated request snapshot |
| Old policy/pricing modules | Versioned policy registry |
| `authorizeDeliveryPayment` | Payment obligation/attempt and Stripe reconciliation |
| `capturePayment` | Confirmation saga and ledger |
| `/api/stripe/webhook` | `/api/webhooks/stripe/delivery` |
| `/api/delivery/assign-driver` | Authenticated Operations assignment command |
| `/api/delivery/mark-in-transit` | Authenticated assigned-driver state command |
| Generic courier admin | Couranr Operations |
| Overloaded delivery status | Separate request/payment/readiness/review/fulfillment states |
| `orders` as canonical record | `delivery_requests` |
| Public proof | Private buckets and signed URLs |
| Browser message inserts | Server message command |
| Arbitrary discounts | Promotional credit and adjustments |

## Archive from active runtime

Auto rental:
- `/auto/*`
- `/dashboard/auto/*`
- `/admin/auto/*`
- `/api/auto/*`
- `/api/admin/auto/*`
- Auto payment and webhook logic

Document services:
- `/docs/*`
- `/dashboard/docs/*`
- `/dashboard/business/docs/*`
- `/api/docs/*`
- `/api/business/docs-requests/*`
- Document checkout, pricing, usage, and webhook logic

Subscription/mixed model:
- `business_packages`
- `business_account_packages`
- Delivery/document allowances
- Overage billing
- `business_jobs`
- `business_usage_events`
- Combined delivery/docs job types

Archive means preserved in Git and backup but absent from navigation and mutation paths.

## Disable and redirect

Return `410 Gone`, `404`, or explicit disabled API response for:

- `/api/delivery/assign-driver`
- `/api/delivery/mark-in-transit`
- `/api/auto/*`
- `/api/admin/auto/*`
- `/api/docs/*`
- `/api/business/docs-requests/*`

Redirect:

- `/courier/quote` → `/estimate`
- `/courier/checkout` → `/business/deliveries/new`
- `/dashboard/business/deliveries` → `/business/deliveries`

API routes must not redirect to HTML.

## Target module boundaries

```text
src/
  app/
  modules/
    auth/
    merchants/
    customers/
    locations/
    presets/
    intake/
    delivery-requests/
    pricing/
    payments/
    dispatch/
    drivers/
    vehicles/
    tracking/
    proof/
    conversations/
    support/
    ghost/
    incidents/
    returns/
    notifications/
    analytics/
    policies/
  infrastructure/
    supabase/
    stripe/
    maps/
    email/
    ai/
    storage/
    jobs/
  shared/
    validation/
    authorization/
    idempotency/
    audit/
    errors/
    time/
```

Physical migration to `src/` is optional early. Domain separation is mandatory.

## Legacy import firewall

Add `check:legacy-imports`. Active new code must not import auto, docs, mixed-business pricing, old delivery pricing/policy, or shared webhook compatibility helpers.

## Data disposition

Retain/migrate:
- Auth users
- Useful profiles
- Business accounts/members
- Useful addresses
- Couranr test merchant
- Driver identity
- Current vehicles or clean replacements

Read-only archive:
- Auto rental/customer/payment data
- Document requests/payments
- Legacy subscriptions
- Mixed jobs/usage
- Old quotes and unclear deliveries

Do not migrate invalid test PaymentIntents, unrelated customers, or records without deterministic mapping.

No dual write: new requests never write old `orders`.

## Stripe and storage

- Keep financial history.
- Archive legacy Products/Prices.
- Create delivery-specific webhook.
- Use unambiguous metadata: `couranr_entity`, `delivery_request_id`, `quote_id`, `payment_obligation_id`, `payer_type`, `environment`.
- New private buckets: `pickup-proof`, `delivery-proof`, `incident-evidence`, `message-attachments`, `intake-uploads`, `merchant-branding`.
- Only explicitly approved branding assets may be public.

## Completion evidence

Claude must provide:
- Remote tag/branch references
- Route manifest before/after
- Import manifest before/after
- Table/RLS manifest
- Stripe webhook manifest
- Storage manifest
- Environment manifest without values
- Disabled-route tests
- No-dual-write tests
- Build/test output
