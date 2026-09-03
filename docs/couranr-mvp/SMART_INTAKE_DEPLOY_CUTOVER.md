# Smart Intake / weight-band batch — zero-downtime production cutover runbook

**Status: NOT EXECUTED.** None of the three migrations below is applied to the
production project (`zrdxlrlqxdslqpnoqmus`); `list_migrations` last shows
`20260902161642`. This runbook is the authority for HOW to apply them when the
owner decides to. Executable proof of every claim here:
`npm run test:deploy-cutover` (PostgREST resolution, both sides of the gap)
and `npm run test:weight-timing` (SQL layer, fence guard, rollbacks).

## Why a cutover is needed at all

The strict routed create/estimate commands enforce rules the currently
deployed application does not know how to satisfy — a shipment-safety
declaration (`p_restricted_class`), a weight statement, and two-sided
requested-timing validation. If the strict arity simply replaced the old one,
the deployed application's estimated quotes would be refused with
`safety_declaration_required` from the moment the migration applied until the
new build finished deploying. That window is real downtime, and "apply and
deploy in the same release window" is not an acceptable answer.

## The architecture

| | old arity (create 31 / estimate 33 args) | strict arity (37 / 39 args, **no defaults**) |
|---|---|---|
| exists | today in production; RETAINED by `20260902200000` | created by `20260902200000` |
| behavior | exactly today's production behavior | declaration + weight + timing rules |
| callers | the currently deployed application | the reviewed application SHA; the Smart Intake wrappers call ONLY this arity |
| retired by | `20260902220000_couranr_legacy_arity_fence.sql` (POSTDEPLOY) | — |

Resolution is provably unambiguous in both notations because the strict arity
has **no defaults**: the old application's 31/33-key call cannot supply
`p_restricted_class` and resolves only to the old arity; the new
application's 37/39-key call names parameters the old arity does not declare
and resolves only to the strict one. No `PGRST203`, no `42725` — asserted by
`test:deploy-cutover` CUT-03/08/10/13.

## The order

### PREDEPLOY — apply, production keeps working

1. Apply `20260902200000_couranr_weight_band_and_requested_timing.sql`.
2. Apply `20260902210000_couranr_smart_intake_v0.sql`.
3. Verify: the deployed application still creates and estimates deliveries
   normally (its quotes carry no declaration — that is today's behavior,
   proven by CUT-08/09/12). Both arities exist (CUT-07).

### DEPLOY — the reviewed application SHA

4. Deploy the reviewed SHA. Its calls carry all 37/39 keys and resolve only
   to the strict arity (CUT-10/11). Smart Intake becomes available.

### POSTDEPLOY — smoke, then close the window

5. Run the critical smoke against production: create a delivery request,
   calculate an estimate (expect the declaration to be required), drive one
   Smart Intake describe→confirm→estimate loop with the fake provider seam
   OFF (production build), confirm quotes mint with `restricted_class='none'`.
6. Apply `20260902220000_couranr_legacy_arity_fence.sql`.
7. Verify: the old parameter shape can no longer mint any commercial quote —
   `PGRST202`, not a policy refusal, not `PGRST203` (CUT-13); the new shape
   stays green (CUT-14). From this point every minted quote passed the
   safety-declaration, weight-honesty and timing guards.

The fence refuses to run if the strict arity is absent, so it can never leave
the database with no routed commands (WBT-03b).

## Rollback order — APPLICATION FIRST where it matters

- **Before the fence is applied** (steps 1–5): redeploy the previous
  application SHA at any time; the old arity is still live and serves it.
  To also roll back the database: application rollback FIRST, then
  `20260902210000` rollback, then `20260902200000` rollback (which
  hard-refuses once band/timing/declaration evidence exists — forward repair
  only from that point).
- **After the fence** (step 6+): to roll the application back, apply
  `supabase/rollbacks/20260902220000_couranr_legacy_arity_fence.rollback.sql`
  FIRST — it restores the old arities verbatim (bodies from
  `20260902042602`) and is safe while the new application is serving
  (CUT-07..12 are executed against exactly this state) — THEN redeploy the
  old SHA. Never redeploy the old SHA against a fenced database: its every
  create/estimate would be `PGRST202`.
- The `20260902200000` rollback drops the strict arity and restores the old
  commands itself, so it is safe in either order relative to the fence
  rollback — but run it only after the application no longer sends the
  37/39-key shape.

## Known gap-window facts (documented, accepted)

- Quotes minted by the old application during the PREDEPLOY→POSTDEPLOY window
  carry no safety declaration (`restricted_class` null) — identical to every
  quote production has ever minted. The fence bounds the window.
- The old estimate arity re-prices only rows the old application created;
  Vercel switches SHAs atomically, so the two generations do not interleave
  on one row in practice. If a strict-created DRAFT were ever re-estimated
  through the old arity during the window, its update statement leaves the
  `weight_band` / `restricted_class` / timing columns untouched (they are not
  in its column list), but the re-quote itself runs without the strict
  guards — one more reason the fence follows the deploy promptly.
