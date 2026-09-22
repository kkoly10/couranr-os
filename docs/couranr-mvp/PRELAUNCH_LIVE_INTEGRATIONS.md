# Integrations that still need a live smoke test

> **Current correction, 2026-09-22.** A direct Consumer Same Day production
> canary has a real-card payment recorded as captured for $10.75. The owner
> supplied the card; Couranr did not run a second charge for this review. This
> verifies one live consumer payment path, not both payer paths, failure and
> refund recovery, or physical delivery. The subsequent driver run was
> simulated in browser contexts. The older test counts and pre-canary claims
> below must not be used as current launch evidence. The implementation ledger
> remains the status authority.

This register distinguishes the one observed live consumer capture from
remaining provider and physical checks. A passing double is evidence about
Couranr's code, not proof of every third-party or real-world outcome.

## PAYMENT_REAL_STRIPE_VERIFICATION = PARTIAL

**Status: one live consumer capture observed; full payment lifecycle not
production-certified.** The captured amount in the canonical production record
is $10.75. Business-payer authorization/capture, failed capture, reauthorization,
release and refunds still require separately named live evidence.

What IS proven, and how:

| Claim | Proven by |
|---|---|
| the obligation amount is the stored quote, never the browser's | 19 SQL probes on the production schema |
| only a verified `requires_capture` intent authorizes | SQL probes + 43 unit tests |
| webhook signature verification accepts exactly Stripe's signatures | offline contract tests using the real Stripe SDK's own signer |
| replay, wrong amount, wrong currency, wrong metadata all fail closed | SQL probes + offline contract tests |
| the Payment Element mounts, confirms once, and reconciles once | 13 DOM tests against the real Elements provider |
| both payer paths work in a browser | 16 Playwright assertions, groups M1–M15 |
| the offline contract tests make no live capture or refund call | the Stripe double records every path it is sent |
| a verified `requires_payment_method` or `canceled` settles a stuck capture, and every other status writes nothing | 24 Playwright assertions, group O1–O24 |
| a `failed` obligation re-authorizes on the SAME intent; a `cancelled` one mints a new obligation and a new intent | O10, O11, O17, O18 |
| a signed webhook cannot release a capture the provider is still running | O23 |
| grants, constraint shapes and every refusal in the terminal command | `supabase/verification/terminal_capture_resolution.sql`, re-runnable and read-only |

What remains NOT proven by the single live consumer canary:

- the full Business-payer authorization and capture path in production
- signed-webhook replay, out-of-order delivery and recovery under live provider failures
- a real failed-capture/re-authorize/release/refund sequence
- that a real capture failure reports `requires_payment_method` rather than
  some status this build maps to `wait`. The failed-capture status is the one
  thing Stripe's PaymentIntent documentation does not state, so the closed
  mapping's `fail` branch is reasoned from the lifecycle, not from a documented
  guarantee. Everything unmapped waits and writes nothing, so an unexpected
  status strands rather than settles — the safe direction, but it needs one
  live observation to close.

### The gate

Retain the observed consumer capture as one piece of evidence. Separately run
the Business payer path and provider-failure/recovery paths with explicit
test-mode or approved live-money controls. Confirm the real Element, exact quote
amount/currency, signed webhook, authorization/capture ordering, idempotency,
duplicate events and expected release/refund outcomes. Never infer those from
the $10.75 success alone.

Add one terminal-resolution pass: cancel the PaymentIntent in the Stripe
dashboard while the obligation is `capture_pending`, then run Operations'
"Check with the payment provider" and confirm the obligation settles
`cancelled`, the service plan cancels, every live payment link is revoked, and
re-authorizing mints a NEW obligation on a NEW intent. Confirm the same for a
failed authorization: it settles `failed`, and the merchant re-authorizes on
the SAME intent.

Note that a webhook arriving for a `capture_pending` obligation now costs one
extra `paymentIntents.retrieve`. That is deliberate — Stripe does not guarantee
event ordering, so the payload cannot be the evidence about a capture that may
still be running — but it is worth seeing in the live rate-limit numbers.

**Remove `STRIPE_API_BASE` from every deployed environment before launch.** It
is refused when `NODE_ENV === "production"`, so it cannot redirect live
traffic, but it has no business being set there.

## Others

- **Routing providers** — canonical Business routes use server-side Google
  route evidence; Same Day uses server-resolved Places and Mapbox routing.
  Provider quotas, failures and fallback review behavior still need continued
  live monitoring.
- **Email** — sender and recipient in-transit and delivered notifications were
  observed as sent during the production simulation. Delivery, bounce, retry
  and other lifecycle branches remain separate acceptance checks.

## Synthetic residue to clear before launch

Browser verification can write synthetic rows that `service_role` cannot delete —
there is deliberately no DELETE grant on the canonical tables, and requests pin
their business account through `ON DELETE RESTRICT`. Marked with `couranr-e2e`
emails and `[E2E]` account names. Removing them needs a reviewed privileged
cleanup; `supabase/migrations/PROPOSED_couranr_e2e_cleanup.sql.review` is NOT
applied. The $10.75 canary's canonical payment, credential, proof and delivery
history is durable audit evidence, not disposable test data.
