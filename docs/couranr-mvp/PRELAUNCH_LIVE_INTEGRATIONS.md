# Integrations that still need a live smoke test

Everything below is **implemented and verified against a double or a
deterministic test**. What is missing in each case is confirmation from the
real third party. This list exists so that gap is tracked in one place instead
of being rediscovered at launch.

## PAYMENT_REAL_STRIPE_VERIFICATION = PENDING_PRELAUNCH

**Status: not production-certified.** No real Stripe API call has ever been
made by this codebase.

What IS proven, and how:

| Claim | Proven by |
|---|---|
| the obligation amount is the stored quote, never the browser's | 19 SQL probes on the production schema |
| only a verified `requires_capture` intent authorizes | SQL probes + 43 unit tests |
| webhook signature verification accepts exactly Stripe's signatures | offline contract tests using the real Stripe SDK's own signer |
| replay, wrong amount, wrong currency, wrong metadata all fail closed | SQL probes + offline contract tests |
| the Payment Element mounts, confirms once, and reconciles once | 13 DOM tests against the real Elements provider |
| both payer paths work in a browser | 16 Playwright assertions, groups M1–M15 |
| no capture or refund call is ever made | the Stripe double records every path it is sent |
| a verified `requires_payment_method` or `canceled` settles a stuck capture, and every other status writes nothing | 24 Playwright assertions, group O1–O24 |
| a `failed` obligation re-authorizes on the SAME intent; a `cancelled` one mints a new obligation and a new intent | O10, O11, O17, O18 |
| a signed webhook cannot release a capture the provider is still running | O23 |
| grants, constraint shapes and every refusal in the terminal command | `supabase/verification/terminal_capture_resolution.sql`, re-runnable and read-only |

What is NOT proven:

- that Stripe **accepts** the PaymentIntent request Couranr builds
- that a real card reaches `requires_capture`
- that a real signed webhook arrives and verifies end to end
- that the real Payment Element renders and takes a test card
- that a real capture failure reports `requires_payment_method` rather than
  some status this build maps to `wait`. The failed-capture status is the one
  thing Stripe's PaymentIntent documentation does not state, so the closed
  mapping's `fail` branch is reasoned from the lifecycle, not from a documented
  guarantee. Everything unmapped waits and writes nothing, so an unexpected
  status strands rather than settles — the safe direction, but it needs one
  live observation to close.

### The gate

Configure `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and
`STRIPE_COURANR_WEBHOOK_SECRET`, then run one complete test-mode flow for each
payer path and confirm: real Element renders; Stripe accepts the test card;
manual authorization reaches `requires_capture`; the signed webhook arrives;
the obligation authorizes exactly once; capture happens only at the approved
lifecycle point, for the correct amount and currency; duplicate events are
harmless; and no test-mode or placeholder configuration remains.

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

- **Google Maps distance validation** — `getDrivingMiles` is used by the legacy
  delivery checkout. The canonical request flow does not call it yet; when it
  does, the key and quota need a live check.
- **Email** — no canonical Couranr email is sent yet. `/api/test-email` is a
  legacy route that sends live mail to a hardcoded fallback address and is a
  quarantine target.

## Synthetic residue to clear before launch

Browser verification writes synthetic rows that `service_role` cannot delete —
there is deliberately no DELETE grant on the canonical tables, and requests pin
their business account through `ON DELETE RESTRICT`. Marked with `couranr-e2e`
emails and `[E2E]` account names. Removing them needs a reviewed privileged
cleanup; `supabase/migrations/PROPOSED_couranr_e2e_cleanup.sql.review` is NOT
applied.
