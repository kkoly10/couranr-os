# Hosted scheduled timing — zero-downtime production cutover runbook

**Status: both PREDEPLOY migrations applied to production; POSTDEPLOY fence
NOT applied.** `20260908220000_couranr_hosted_scheduled_timing.sql` and its
companion `20260908220500_couranr_hosted_legacy_validate_guard.sql` are safe
to hold in production indefinitely: the deployed application keeps calling
the retained 13/26-argument hosted commands and behaves exactly as before.
The fence `20260908230000_couranr_hosted_legacy_arity_fence.sql` must be
applied **only after** the application SHA carrying this branch is serving.

Executable proof of every claim here:

- `npm run test:hosted-deploy-cutover` — PostgREST resolution, both sides of
  the gap (17 checks).
- `npm run test:hosted-scheduled-timing` — the SQL layer: both strict arities
  CALLED with scheduled timing, the fence predeploy/postdeploy states, the
  deploy-gap guard, the rollback guard and the full rollback round trip.

## Why a cutover is needed

The strict hosted arities take four timing parameters with **no defaults**.
If they simply replaced the old ones, the deployed application's hosted submit
and merchant validation would answer `PGRST202` from the moment the migration
applied until the new build finished deploying. That window is real downtime.
Same reasoning, same shape as `SMART_INTAKE_DEPLOY_CUTOVER.md`.

## The architecture

| | old arity (create 13 / validate 26 args) | strict arity (17 / 29 args, **no defaults**) |
|---|---|---|
| exists | today in production; RETAINED UNCHANGED by `20260908220000` | created by `20260908220000` |
| behavior | exactly today's production behavior: hosted requests are ASAP. One addition from `20260908220500`: the legacy validate REFUSES a scheduled row (`CR409 hosted_scheduled_timing_requires_current_application`) instead of rewriting it to asap — it never fires on the old application's own (asap) rows | customer states `asap` or `scheduled` + Eastern local words; two-sided TMZ-001 assertion; customer words frozen on the intake; merchant confirms or adjusts |
| callers | the currently deployed application | the application SHA on `feat/hosted-scheduled-timing` |
| retired by | `20260908230000_couranr_hosted_legacy_arity_fence.sql` (POSTDEPLOY) | — |

Resolution is provably unambiguous in both notations because the strict arity
has no defaults: the old application's 13/26-key call cannot supply
`p_timing_intent` and resolves only to the old arity; the new application's
17/29-key call names parameters the old arity does not declare and resolves
only to the strict one. No `PGRST203`, no `42725`.

## The order

### PREDEPLOY — apply, production keeps working

1. Apply `20260908220000_couranr_hosted_scheduled_timing.sql`, then
   `20260908220500_couranr_hosted_legacy_validate_guard.sql`.
2. Verify with a catalog query: `couranr_create_hosted_delivery_request` has
   arities `13,17`, `couranr_validate_hosted_delivery_request` has `26,29`,
   `couranr_hosted_request_intakes` has `customer_timing_intent` and
   `customer_requested_pickup_local`.
3. Nothing changes for the deployed application.

### DEPLOY

4. Deploy the application SHA. From now on every hosted submit states a timing
   intent and every merchant validation confirms one.

### POSTDEPLOY — close the window

5. Apply `20260908230000_couranr_hosted_legacy_arity_fence.sql`. Its guard
   refuses unless both strict arities exist.
6. Verify arities are `17` and `29` only.

## Rolling back

- **Application rollback after the fence:** apply
  `supabase/rollbacks/20260908230000_couranr_hosted_legacy_arity_fence.rollback.sql`
  first (restores the old create verbatim and the old validate WITH the
  deploy-gap guard), then redeploy the old SHA.
- **Full rollback:** roll the application back first, then apply
  `supabase/rollbacks/20260908220000_couranr_hosted_scheduled_timing.rollback.sql`.
  It HARD-REFUSES while any hosted intake carries a customer timing statement
  or any hosted request is scheduled; repair forward instead. On a database
  where the feature was never used it rolls back completely, and it restores
  the old arities itself, so it is safe whether or not the fence ran.
