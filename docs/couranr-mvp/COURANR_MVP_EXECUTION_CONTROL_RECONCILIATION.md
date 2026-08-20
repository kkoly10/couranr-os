# Couranr MVP — Execution Control Reconciliation

**Status:** Operational amendment to the existing autonomous completion program  
**Repository:** `kkoly10/couranr-os`  
**Existing master plan:** `docs/couranr-mvp/AUTONOMOUS_COMPLETION_EXECUTION_SPEC.md`  
**Current interruption:** PR #30 visual fidelity recovery  
**Next product batch after the visual checkpoint:** `B06 — Operations command center`

---

# 0. Purpose

Do **not** create a replacement Couranr MVP roadmap.

The repository already contains the correct end-to-end completion program:

```text
docs/couranr-mvp/AUTONOMOUS_COMPLETION_EXECUTION_SPEC.md
```

That specification already requires:

- database-through-UI implementation;
- all 42 authoritative work items reconciled against executable evidence;
- all 66 canonical screens functional, responsive, accessible and visually faithful;
- security, idempotency, audit and recovery;
- real integration verification;
- legacy cutover;
- analytics/observability;
- controlled production canary;
- owner-gated production operations.

The current problem is **execution control**, not missing scope.

The program tracked functional status rigorously but did not give visual fidelity an equally explicit per-screen status axis. As a result, screens could be functionally verified while their implementation drifted visually.

This amendment fixes that control-plane gap and then resumes the existing batch sequence.

---

# 1. Existing plan remains authoritative

Keep the current batch program:

```text
B00 Activation / truth reconciliation
B01 Platform / verification foundation
B02 Public launch surface
B03 Merchant pilot workspace
B04 Categories / presets / Smart Intake / immutable quotes
B05 Payments / ledger / refunds / Stripe closure
B06 Operations command center
B07 Driver completion / offline recovery
B08 Exceptions / returns / incidents / customer resolution
B09 Messaging reachability / notifications
B10 AI broker / Assistant / Ghost / Ask Couranr
B11 Analytics / observability / alerts
B12 Legacy cutover / recovery / release acceptance
B13 Controlled production canary / completion
```

Do not renumber these batches.

Do not replace their capability graph.

Do not create a second autonomous program.

---

# 2. What PR #30 is

PR #30 is a **cross-cutting visual-quality interruption** inside the existing completion program.

It is not:

- B06;
- a new B-series batch;
- a replacement for B02;
- a replacement for the autonomous completion specification.

Its purpose is to repair the visual acceptance mechanism before more screen-heavy batches are built.

Record it operationally as:

```text
VISUAL_FIDELITY_CHECKPOINT_PR = 30
```

The checkpoint must be closed before broad visual propagation resumes.

---

# 3. New dual-axis screen completion model

The current `SCREEN_IMPLEMENTATION_LEDGER.csv` has a functional status but no independent visual-fidelity status.

Add three columns:

```text
visual_status
visual_evidence
visual_last_verified_sha
```

Do not replace `implementation_status`.

Functional truth and visual truth are different axes.

## 3.1 Allowed visual statuses

Use only:

```text
not_started
reference_missing
drift_found
partial
visual_verified
not_applicable
```

Definitions:

### `not_started`

A canonical visual reference exists but no direct fidelity review has been completed.

### `reference_missing`

No canonical mock exists and no approved same-family derivation contract has yet been recorded.

This is not a reason to invent a design.

### `drift_found`

The screen has been compared to its canonical visual authority and materially differs.

The screen may still be functionally verified.

### `partial`

Some regions/viewports are visually reconciled but the complete required fidelity/responsive/accessibility proof is not finished.

### `visual_verified`

The screen passed:

1. canonical mock/approved derivation review;
2. required viewport review;
3. accessibility non-regression;
4. intentional-deviation reconciliation.

### `not_applicable`

Use only for entries where there is genuinely no rendered visual surface to verify.

Do not use it to avoid visual work.

---

# 4. Completion semantics

A screen is **fully complete** only when:

```text
implementation_status = functional_verified
AND
visual_status = visual_verified
```

where visual verification is applicable.

Therefore:

```text
functional_verified != finished screen
visual_verified != functioning screen
```

Both are required.

The implementation ledger and screen ledger must never collapse these concepts into one field.

---

# 5. Visual evidence contract

For every `visual_verified` screen, `visual_evidence` must identify evidence sufficient to reproduce the decision.

Minimum evidence:

```text
canonical mock/source reference
desktop screenshot or target viewport evidence
mobile/tablet evidence where applicable
region-by-region fidelity review
accessibility result
intentional deviations with authority
```

For mock-backed screens, source comments such as "from the mock" are not evidence.

For derived screens, the evidence must name:

```text
derived_from_screen_id
surface_family
which system rules are inherited
which layout decisions are screen-specific
```

---

# 6. Positive-control requirement

The visual gate must be able to fail.

At least one automated or semi-automated positive control must prove each of these can turn red:

```text
unauthorized generic eyebrow reintroduced
unauthorized Card/Grid/Badge structure added to a reconciled public region
canonical visual reference missing
visual evidence missing while status says visual_verified
visual_last_verified_sha not reachable from current HEAD
```

The qualitative generic-AI-template review remains human-visible and cannot be reduced to a source grep.

---

# 7. Update the autonomous completion specification — do not rewrite it

Amend the existing `AUTONOMOUS_COMPLETION_EXECUTION_SPEC.md` in place.

## 7.1 §4.5 Status tracking

Add:

> Any screen status change that affects rendered UI must update both functional and visual status axes. `functional_verified` does not imply visual completion.

## 7.2 §5 Mandatory self-verification loop

Replace the current generic visual step with:

> For every affected canonical screen, reconcile functional behavior and visual fidelity independently. A screen cannot be promoted to final completion until both gates pass.

## 7.3 Batch exit gates

Where a batch creates or materially changes screens, the exit gate must require:

```text
functional_verified
+
visual_verified
```

for every screen necessary to that batch's exit.

Do not require unrelated screens merely because they share a component.

## 7.4 Final completion

B13 cannot complete while any applicable screen is:

```text
functional_verified + visual_status != visual_verified
```

or:

```text
visual_verified + implementation_status != functional_verified
```

---

# 8. Current PR #30 gate

Before PR #30 is considered complete:

1. `COURANR_VISUAL_FIDELITY_AMENDMENT.md` is incorporated into the branch authority;
2. PUB-001 gets the pixel-first visual drift ledger;
3. shared generic marketing eyebrow usage is removed;
4. abstract composition budgets no longer override explicit mock pixels;
5. current VIS-001 typography remains intact and browser-verified;
6. PUB-001 is reviewed at desktop and mobile;
7. PUB-001 reaches `visual_verified`;
8. the public-family visual rules learned from PUB-001 are recorded without inventing a replacement design;
9. no broad propagation occurs before owner approval.

The existing functional status of PUB-001 remains independently tracked.

---

# 9. Post-PR #30 control-plane reconciliation

After PR #30 is merged, but before B06 feature work begins, perform one control-plane commit.

That commit must update:

```text
docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv
docs/couranr-mvp/IMPLEMENTATION_STATUS.md
docs/couranr-mvp/ACTIVE_EXECUTION_SLICE.md
docs/couranr-mvp/AUTONOMOUS_RUN_STATE.json
docs/couranr-mvp/AUTONOMOUS_COMPLETION_EXECUTION_SPEC.md
```

and any validator/tests affected by the new visual status columns.

Do not rewrite historical evidence SHAs.

---

# 10. `IMPLEMENTATION_STATUS.md` changes

Add a **Visual status vocabulary** section with the values from §3.1.

Add measured summary counts:

```text
screens functional_verified
screens visual_verified
screens functional_verified but visually unresolved
screens visually verified but functionally unresolved
screens with canonical references
screens with missing visual references
```

The first two numbers must not be presented as interchangeable.

Add a short execution note:

> PR #30 was a cross-cutting visual-fidelity correction. It did not replace the autonomous MVP program. Following that checkpoint, product execution resumes at B06 while recorded B05 residuals remain launch blockers where applicable.

---

# 11. `AUTONOMOUS_RUN_STATE.json` changes

After PR #30 is merged, update:

```json
{
  "active_batch": "B06",
  "active_capability": "<first authority-derived B06 capability after recon>",
  "open_pr": null
}
```

Do not fabricate the first B06 capability before re-reading the capability graph and current ledgers.

Add a new object:

```json
"visual_acceptance": {
  "schema_version": "1.0",
  "checkpoint_pr": 30,
  "screen_status_axis_enabled": true,
  "public_golden_screen": "PUB-001",
  "owner_visual_approval_required_before_family_propagation": true
}
```

Also preserve the existing owner decision queue and all unresolved external gates.

---

# 12. `ACTIVE_EXECUTION_SLICE.md` changes

After PR #30 merge, replace stale Phase-8/B01-era language with an operational pointer to B06.

It should state:

```text
Active batch: B06 — Operations command center
Authority: AUTONOMOUS_COMPLETION_EXECUTION_SPEC.md §8 and applicable ACP rows
Visual acceptance: functional and visual status are independent; both required for final screen completion
```

Then list only the currently selected B06 slice.

Do not duplicate the entire B06 spec into this file.

---

# 13. B05 residual reconciliation

B05 is merged, but "merged" is not the same as "all exit criteria satisfied."

Before B06 starts, re-measure B05 residuals from current HEAD and classify each as:

```text
CLOSED
CARRY_FORWARD_EXTERNAL
CARRY_FORWARD_DECISION
CARRY_FORWARD_PRODUCT
```

Known areas that require fresh verification include, at minimum:

```text
real Stripe test-mode verification
remaining payment/refund surfaces
idempotency wiring where still intentionally deferred
owner decisions affecting money behavior
external integration gates
```

Do not guess that these are still open because an old PR said so.

Read current code/ledgers and re-measure them.

## 13.1 Rule for starting B06 with B05 residuals

B06 may proceed on independent capabilities when a B05 residual is explicitly classified and does not violate a declared dependency.

However:

- no dependent payment/refund B06 path may be marked complete while its B05 prerequisite is open;
- B12 release acceptance and B13 canary remain blocked until all launch-critical B05 residuals close.

This prevents an external Stripe credential gate from freezing unrelated Operations work without pretending the payment program is finished.

---

# 14. B06 activation recon

Do not start writing B06 code immediately after PR #30.

First perform a B06 recon against the merged tree:

1. read every B06 ACP row from the master completion spec;
2. read every Operations screen row in `SCREEN_IMPLEMENTATION_LEDGER.csv`;
3. inspect actual routes/components/APIs/SQL;
4. identify what is already functional;
5. identify placeholders and dead-end routes;
6. identify B05/B07/B08/B09 dependencies;
7. inspect all current Operations mocks;
8. check whether any B06 screen lacks a visual reference;
9. recheck security/grant boundaries relevant to Operations;
10. create one coherent first B06 slice.

Do not assume B06 is entirely unbuilt.

---

# 15. B06 quality gate

For every Operations screen touched by B06:

## Functional gate

Require real-data execution of the applicable flow:

```text
browser
→ real Next route/server command
→ real disposable PostgREST/database
→ row/state/audit evidence
```

Where an external provider is required, use the exact external gate specified by authority.

No stubbed happy path may promote `functional_verified`.

## Visual gate

Require:

```text
canonical Operations mock or approved derivation
desktop/tablet viewport review
density/hierarchy fidelity
no implementation-invented visual grammar
accessibility
visual evidence at final SHA
```

Do not make Operations look like the marketing site.

Operations is a command center, not an editorial surface.

---

# 16. Security and production rule remains unchanged

This amendment does not loosen production safety.

The executor may prepare:

```text
migrations
rollback files
production runbooks
read-only catalog verification
draft PRs
```

but may not autonomously:

```text
apply production migration
repair production ledger
charge/refund real money
rotate secrets
delete/rewrite production data
change bucket publicity
merge production-behavior PR
run production canary
```

without explicit owner approval for that exact operation.

---

# 17. Completion dashboard the repo should be able to answer

After this reconciliation, one command/report should be able to answer:

```text
How many of 42 work items are complete_verified?
How many of 66 screens are functional_verified?
How many of 66 screens are visual_verified?
Which screens are functional but visually unresolved?
Which screens are visually reconciled but not functionally verified?
Which launch-critical capabilities are blocked externally?
Which are blocked by an owner decision?
What is the active batch and capability?
What prevents B13 canary today?
```

If the repository cannot answer those questions from ledgers/state, the execution-control layer is incomplete.

---

# 18. Recommended execution order from here

```text
1. Finish PR #30 fidelity reconciliation.
2. Owner reviews PUB-001 desktop/mobile.
3. Merge PR #30 only when its gates pass.
4. Run post-PR30 control-plane reconciliation.
5. Add the independent visual-status axis to the screen ledger.
6. Re-measure B05 residuals.
7. Rewrite ACTIVE_EXECUTION_SLICE.md to B06.
8. Update AUTONOMOUS_RUN_STATE.json to B06.
9. Recon B06 against the actual merged tree.
10. Start the first coherent B06 Operations slice.
11. Continue B07 → B13 from the existing master plan.
```

---

# 19. Claude / Fable execution directive

> Do not create a new Couranr MVP roadmap. The existing `AUTONOMOUS_COMPLETION_EXECUTION_SPEC.md` remains the master execution program.
>
> Treat PR #30 as a cross-cutting visual-fidelity checkpoint. Finish its PUB-001 fidelity work first.
>
> Then perform one execution-control reconciliation commit before B06:
>
> - amend the master spec so functional and visual screen verification are explicit independent gates;
> - add `visual_status`, `visual_evidence`, and `visual_last_verified_sha` to `SCREEN_IMPLEMENTATION_LEDGER.csv`;
> - update its validator with allowed values and reachable-SHA requirements;
> - update `IMPLEMENTATION_STATUS.md` with separate functional/visual counts;
> - update `AUTONOMOUS_RUN_STATE.json` and `ACTIVE_EXECUTION_SLICE.md` to the real current state;
> - re-measure B05 residual work from the merged tree rather than copying old PR prose;
> - classify each B05 residual as CLOSED / CARRY_FORWARD_EXTERNAL / CARRY_FORWARD_DECISION / CARRY_FORWARD_PRODUCT;
> - start B06 only after reading the actual B06 capability graph, Operations screen ledger, current code, mocks and dependencies.
>
> A screen is finally complete only when it is both `functional_verified` and `visual_verified`.
>
> Do not promote a screen from a screenshot alone. Do not promote a screen from functional E2E alone. Both gates are required.
>
> Preserve all current owner-gated production restrictions.
>
> Do not start B10/B11 as an escape from unfinished Operations, Driver, payment, proof, exception or communication dependencies.
>
> Continue the existing sequence through B13 rather than inventing a new one.

---

# 20. Result

After this amendment the repository has one coherent completion system:

```text
AUTONOMOUS_COMPLETION_EXECUTION_SPEC
    ↓
AUTONOMOUS_RUN_STATE
    ↓
ACTIVE_EXECUTION_SLICE
    ↓
IMPLEMENTATION_LEDGER
    +
SCREEN_IMPLEMENTATION_LEDGER
      ├── functional status
      └── visual status
    ↓
executable evidence
    ↓
B13 controlled canary
```

The goal is not to make the roadmap larger.

The goal is to make it impossible for Couranr to be called "complete" while either its logic or its visual implementation is still unfinished.
