# Couranr Release Acceptance Matrix

## Severity

- **P0:** Security, money, custody, proof, safety, or unrecoverable data failure. Zero open.
- **P1:** Core merchant/customer/driver/Operations failure. Zero core open.
- **P2:** Safely deferrable only with workaround, owner, and date.
- **P3:** Cosmetic/enhancement.

## Evidence

Every P0/P1 test records test ID, commit SHA, environment, identity, preconditions, steps, expected/actual, pass/fail, UI evidence, logs, database rows, Stripe IDs, ledger ID, proof object, defect, and retest.

## Automated gate

```text
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run check:routes
npm run check:legacy-imports
npm run check:rls
npm run check:migrations
npm run check:policy-registry
npm run test:security
npm run test:payments
npm run test:delivery-lifecycle
npm run test:ghost-isolation
```

## Required test groups

### Legacy
- Preservation exists.
- Auto/docs cannot mutate.
- Old quote/checkout cannot price/pay.
- Webhook isolated.
- New request creates no legacy order.

### Database/security
- Clean and upgrade migrations.
- RLS every exposed table.
- Merchant A/B isolation through UI/API/realtime/UUID guessing.
- Role boundaries.
- Driver assignment scope.
- Guest-token purpose/expiry/revocation.
- Internal-note privacy.
- No client secrets.

### Onboarding/presets
- Test versus live activation.
- One primary + three secondary categories.
- General business.
- Payer default ask each time.
- Card not required to finish.
- Versioned presets.
- No silent exact facts.

### Smart Intake
- Plain language and pasted order.
- Confidence bands.
- One clarification.
- No invented critical fields.
- Heavy/long retained for review.
- Restricted signals.
- Prompt injection blocked.
- AI outage fallback.
- Correction audit.

### Pricing
- $22.99 first three miles.
- All distance/weight/service tiers.
- Nonstacking rush/overnight.
- Stops, signature, waiting, return, cancellation, attempt.
- Route Saver.
- Promotional credit.
- Quote immutability.
- Cent reconciliation.

### Payments/ledger
- Merchant-paid.
- Customer-paid.
- Hosted request.
- Authorization/capture failures.
- Duplicate click/event/refund.
- Quote expiration.
- Payer change.
- Out-of-order webhook.
- Interrupted capture.
- Balanced ledger and Stripe reconciliation.
- Test/live isolation.

### Operations/driver/proof
- Complete Queue.
- Confirm/requote/information/decline.
- Vehicle recommendation/selection.
- Operations-only assignment.
- Driver sanitized data.
- Valid/invalid state transitions.
- Pickup and delivery proof.
- Leave-at-door controls.
- Mismatch.
- Offline proof.
- Driving Mode.

### Exceptions
- Wait clock.
- Merchant not ready.
- Recipient unavailable.
- Address change.
- Cancellation stages.
- Return.
- No free redelivery.
- Damage/unsafe lift/prohibited item.
- Weather.

### Messaging
- Merchant support.
- 15-minute and after-hours timers.
- Merchant–driver.
- Operations visibility.
- Chat cannot mutate.
- Attachments.
- Realtime privacy.
- Idempotent send.
- Delivery Help.
- No direct customer-driver flood.

### AI
- Scoped context.
- No SQL.
- Tenant isolation.
- Verified answers.
- No false action claim.
- 95% plus deterministic gates and verifier.
- Restricted escalations.
- Redaction.
- Driving Mode.
- Kill switch.
- Audit.
- Provider failure leaves manual operations.
- Public/private boundary.
- Deterministic estimate and lead consent.

### Analytics/observability
- Market and source attribution.
- Paid/repeat demand.
- Category and economics.
- Unmet demand.
- Support and AI metrics.
- No PII.
- Alerts for payments, webhook, ledger, proof, support, security, stuck states.

### Recovery
- Backup verified.
- Restore rehearsal.
- Storage reconciliation.
- Stripe replay.
- Pause new requests.
- Pause AI.

## Required end-to-end scenarios

1. Merchant-paid Stafford delivery
2. Customer-paid DC delivery
3. Customer-hosted request
4. Revised quote/larger vehicle
5. Merchant not ready/waiting
6. Recipient unavailable/return
7. Address change after pickup
8. More than 100 lb reviewed safely
9. Overnight delivery
10. Couranr cannot confirm/release authorization
11. Ghost safe reply while driving
12. Ghost escalation
13. Marketing lead to paid delivery attribution
14. Offline proof recovery
15. Capture interruption/webhook reconciliation

## Production canary

One controlled real production delivery must cover merchant workspace, request, accepted quote, low-value payment, review, vehicle, assignment, chat, pickup proof, tracking, delivery proof, receipt, support, Ghost, Stripe, ledger, and analytics.

## Go/no-go

Go: zero P0, zero core P1, all required areas pass, canary and backup pass, Stripe/ledger reconcile, Operations can pause requests and AI.

Conditional go: only an optional disabled feature remains; no security, money, safety, custody, or data risk. Ghost auto-replies may remain disabled.

No-go:
- Cross-tenant leak
- Incorrect charge/refund
- Missing proof
- Unauthorized mutation
- Unbalanced ledger
- Failed payer flow
- Return charge error
- Driver access failure
- Unsafe acceptance
- Unrecoverable webhook
- Missing backup
- Failed canary
