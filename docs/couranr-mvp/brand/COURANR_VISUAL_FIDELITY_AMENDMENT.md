# Couranr Visual Fidelity Amendment

**Status:** Amendment to `COURANR_VISUAL_SYSTEM_V2_2.md`  
**Applies to:** PR #30 / branch `claude/couranr-visual-system-v2-2`  
**Purpose:** reconcile Visual System v2.2 with the actual canonical mocks and prevent the visual system from overruling the design it was supposed to implement.

---

# 1. Core correction

The approved Couranr mocks remain the visual authority.

Visual System v2.2 is a reusable implementation system. It is **not** permission to redesign a canonical mock so the screen fits an abstract composition budget.

Use this rule:

> **Written product authority controls behavior, copy correctness, pricing, permissions, state, safety and claims. The canonical mock controls screen-specific visual composition, geometry, hierarchy, photography, spacing, component shape and visual rhythm. Visual System v2.2 controls reusable implementation mechanics only where the mock is silent.**

Therefore:

- a v2.2 anti-template rule may detect drift;
- a v2.2 anti-template rule may guide a screen with no explicit visual reference;
- a v2.2 anti-template rule may **not** force a canonical screen to depart from an explicit mock treatment.

If a canonical mock visibly contains two adjacent card-based sections, that is not a reason to redesign one into `split-story`.

If a canonical mock visibly contains a bordered flow strip, that is not a reason to flatten it merely because "fewer containers" sounds cleaner.

If a canonical mock visibly contains one contextual pill label, that does not authorize a reusable eyebrow system across the public site.

---

# 2. What this amendment does not reopen

This amendment does **not** reopen or reverse `VIS-001`.

Keep the current owner-approved typography implementation:

- Martian Grotesk Variable — display/significant headings;
- Inter Variable — body/interface;
- Martian Mono — operational identifiers where appropriate.

Keep the deterministic self-hosted font implementation already present on the branch.

Keep the existing `--couranr-*` namespace.

Keep the canonical logo and locked Couranr colors.

Keep the existing accessibility, responsive, shell and functional work unless mock reconciliation exposes a genuine visual conflict.

The previous standalone recovery document is **not** a second authority. Its useful methods are incorporated here; its stale branch assumptions are not.

---

# 3. v2.2 rules changed by this amendment

The following v2.2 rules become **secondary heuristics**, not screen-specific authorities, whenever a canonical mock explicitly depicts the treatment.

## 3.1 Adjacent-composition prohibition

Old effect:

> two adjacent sections may not use the same composition type.

Amended rule:

> Avoid accidental repeated composition where the mock is silent. If the canonical mock explicitly repeats a composition, reproduce the mock.

A composition test must never force a different visual treatment merely to make an adjacency check pass.

## 3.2 Card-grid budgets

Old effect:

> global numeric grid/card budgets can force a redesign.

Amended rule:

> Use card/grid budgets only as drift diagnostics. The canonical mock decides whether a specific section is card/grid-based.

Do not remove mock-supported cards to satisfy a numeric budget.

Do not add cards because the budget allows them.

## 3.3 Eyebrow budget

Delete the concept of a generic "2–3 eyebrows per page" allowance.

New rule:

> **There is no shared/public marketing eyebrow pattern by default.**

A small pill/kicker/label is allowed only when:

1. the canonical mock for that screen visibly contains it; or
2. written authority explicitly requires it.

Its styling stays screen-specific unless multiple canonical mocks independently demonstrate the same pattern.

The existence of one PUB-001 label does not authorize `.cr-mkt-eyebrow` on PUB-008/009/010/011.

## 3.4 Composition vocabulary

`data-composition` remains useful for evidence and tests.

It is descriptive, not generative.

The implementation must not change a mock-supported layout merely to fit the closest v2.2 vocabulary member.

If the vocabulary cannot accurately describe the mock:

- extend the vocabulary narrowly; or
- record a screen-specific composition value.

Do not redesign the screen to fit the enum.

---

# 4. Pixel-first Gate A

Gate A is replaced by a region-by-region drift ledger.

Create:

```text
docs/couranr-mvp/ui-reference/PUB_001_VISUAL_DRIFT_LEDGER.csv
```

Required columns:

```text
region
current_source
current_rendered_treatment
canonical_mock_file
mock_treatment
classification
required_change
written_content_authority
intentional_deviation
evidence
notes
```

Allowed classifications:

```text
KEEP
REMOVE
RESTYLE
REBUILD
VERIFY
```

Required PUB-001 regions:

```text
public-header
top-notice
hero-photography
hero-small-label
hero-headline
hero-supporting-copy
hero-cta
hero-trust
pickup-problem
category-breadth
order-channels
order-flow
outcomes
workflow
payer-choice
product-proof
categories
delivery-options
pricing
service-areas
faq
closing-cta
footer
ask-couranr
```

The executor must open the actual approved mock pixels for every row.

Do not use source comments, commit messages, old prose summaries, or current JSX structure as proof of what the mock depicts.

No `VERIFY` row may remain when PUB-001 is promoted to visual completion.

---

# 5. Known reconciliation points on the current branch

These are **recon targets**, not automatic delete instructions.

## 5.1 PUB-001 contextual pill / small label

The canonical mock contains a contextual pill treatment in the hero.

That means the presence of a pill there is not itself an implementation defect.

However:

- it must remain PUB-001-specific;
- it must not create a shared `.cr-mkt-eyebrow` system;
- its exact text must follow written content authority.

There is currently a content-authority question between the mock's visual/tagline treatment and the current MKT-002 hero descriptor. Do not resolve that copy conflict by agent preference. Preserve the written-authority copy unless the owner/decision registry changes it, while reproducing the mock's visual geometry.

## 5.2 Channel tiles

The mock visibly contains bordered channel tiles.

Do not flatten them merely because v2.2 prefers fewer card-like structures.

Reconcile exact count, shape, border weight, spacing, icon treatment, alignment, and relationship to the flow strip against the pixels.

If the current branch uses a single flat `channelstrip` where the mock shows discrete tiles, the current branch is the drift.

## 5.3 Flow strip

The mock visibly contains a bordered/tinted flow strip with arrows.

Keep it if current pixel recon confirms the branch matches its geometry.

Do not classify "bordered strip" as bad merely because it is a container.

## 5.4 Payer cards

The mock contains two tinted payer cards with circular icon treatments.

Those are mock-supported objects.

The recovery target is fidelity of tint, border, radius, icon geometry, spacing, and title/body hierarchy — not automatic card removal.

## 5.5 Hero trust icons

The canonical hero uses outlined circular trust icons.

Those circles are mock-supported.

Do not remove them under a blanket "no icon bubbles" rule.

## 5.6 Top notice

The canonical design contains a full-width notice treatment.

Do not remove it simply because it is a bordered/containerized element.

Verify the current notice against the mock's exact height, background, border, typography and placement.

## 5.7 Sections changed to satisfy v2.2 composition budgets

Any branch change whose stated reason is to avoid an adjacent duplicate, meet a card-grid cap, increase image-led count, or satisfy a composition enum must be rechecked against canonical pixels.

If the mock explicitly supports the original composition, revert the budget-driven reinterpretation.

This specifically includes the branch decision to change an artboard card-row section to `split-story` only to avoid adjacent duplicate compositions.

---

# 6. Generic eyebrow removal

Adopt this immediately across the public family:

> **No shared marketing eyebrow class/component.**

Required action:

- retire `.cr-mkt-eyebrow` as a general public primitive;
- remove its use from PUB-008/009/010/011 unless a screen-specific canonical reference explicitly supports that treatment;
- keep any mock-supported PUB-001 hero label as a PUB-001-specific style, not a global marketing primitive.

Do not replace removed eyebrows with pills, chips, tiny uppercase labels, badge components, or decorative rules.

Hierarchy must come from the actual screen design.

---

# 7. Primitive-use rule

`Card`, `Grid`, `Badge`, `Stack`, `Heading`, `Text`, and other product primitives remain valid components.

Their existence does not authorize their use as marketing composition.

For PUB-001, every use of `Card`, `Grid`, or `Badge` must have one of these ledger justifications:

```text
MOCK_SUPPORTED
FUNCTIONALLY_REQUIRED
```

Anything else fails the visual gate.

A mock-supported container is good.

An implementation-invented container is drift.

---

# 8. Generic-AI-template hard stop

Keep this heuristic:

> **If the Couranr logo and brand colors were removed, could the page plausibly be an off-the-shelf AI-generated SaaS template?**

If yes, the implementation fails visual review.

Important limitation:

This test may expose generic implementation drift.

It may **not** be used as authority to redesign a treatment that the canonical mock explicitly contains.

The mock still wins.

---

# 9. Composition tests must describe the mock

Update composition-contract tests so they validate the reconciled screen rather than forcing the screen to satisfy abstract budgets.

For PUB-001 tests should assert:

- approved section order/content regions;
- each region's ledger-approved composition/treatment;
- required mock-supported objects are present;
- unsupported implementation-invented objects are absent;
- no shared marketing eyebrow primitive is used;
- public `Card`/`Grid`/`Badge` use matches the explicit allowlist produced by the drift ledger.

Remove or demote tests that fail solely because:

- two adjacent mock-supported sections share a composition;
- the mock contains more card-based sections than a global budget;
- the mock contains a contextual small label.

A test must never make the implementation less faithful to the canonical design.

---

# 10. Evidence

Before any further public visual propagation, produce:

```text
docs/couranr-mvp/ui-reference/evidence/PUB-001/
```

with:

```text
native-mock-reference(s)
current-branch-before-1440.png
reconciled-after-1440.png
current-branch-before-390.png
reconciled-after-390.png
PUB_001_VISUAL_DRIFT_LEDGER.csv
region-review.md
typography-proof.json
responsive-proof.json
accessibility-proof.json
intentional-deviations.md
```

Each intentional deviation must name the written authority that requires it.

"v2.2 prefers another composition" is not a valid deviation justification when the mock explicitly depicts the treatment.

---

# 11. Current PR sequencing

Do **not** create a second V0–V6 visual program.

Continue PR #30, but insert this fidelity checkpoint before further visual propagation.

Required order:

1. add this amendment to the branch;
2. amend v2.2 to reference it;
3. update affected visual-system tests so mock fidelity cannot be overruled by abstract budgets;
4. retire the shared public eyebrow primitive;
5. complete the PUB-001 drift ledger from actual mock pixels;
6. correct PUB-001 against the ledger;
7. run native-mock, responsive and accessibility review;
8. show the owner PUB-001 before/after;
9. only after owner visual approval, continue PUB-008/009/010/011 and product-family propagation.

Do not restart typography.

Do not restart the token system.

Do not rewrite Merchant/Driver/Operations while PUB-001 is unresolved.

---

# 12. PUB-008/009/010/011 rule

These pages have no independent canonical mock and derive from the public visual family.

They must not inherit the current generic eyebrow/card grammar.

After PUB-001 is approved:

- inherit its typography discipline;
- inherit its container restraint;
- inherit its nav/footer/control geometry;
- inherit its spacing/material language;

but compose each supporting page according to its content.

Do not mechanically clone PUB-001 sections.

Do not add a generic hero eyebrow merely to make the page feel consistent.

---

# 13. Visual completion standard

PUB-001 may be marked visually complete only when all are true:

- region drift ledger has no unresolved `VERIFY`;
- mock-supported pills/cards/tiles/strips/circles are reproduced faithfully;
- implementation-invented containers are removed;
- shared public eyebrow system is gone;
- typography remains the current VIS-001 implementation and is verified in browser;
- visual-system tests describe rather than override the mock;
- responsive implementation is intentional at desktop/mobile widths;
- accessibility does not regress;
- governed copy/behavior remains correct;
- generic-AI-template hard stop passes;
- owner has reviewed the before/after.

---

# 14. Amendment precedence

This amendment modifies `COURANR_VISUAL_SYSTEM_V2_2.md` only in this domain:

> **screen-specific fidelity where v2.2's abstract composition/anti-template rules conflict with an explicit canonical visual reference.**

It does not supersede:

- VIS-001 typography;
- brand colors;
- accessibility;
- responsive requirements;
- token namespace;
- product-family distinctions;
- written product/marketing authority;
- security/business logic.

Where there is no canonical mock, v2.2 remains the primary reusable visual-system authority.

Where there is a canonical mock, this amendment ensures v2.2 serves the mock instead of redesigning it.

---

# 15. Claude / Tala execution instruction

> Continue PR #30. Do not start a new visual-system branch and do not restart VIS-001.
>
> Add `COURANR_VISUAL_FIDELITY_AMENDMENT.md` beside v2.2 and amend the v2.2 revision log to record that canonical mock fidelity now overrides abstract anti-template/composition budgets whenever the mock explicitly depicts the treatment.
>
> Stop public visual propagation until PUB-001 is reconciled.
>
> Open the actual approved PUB-001 mock files and complete `PUB_001_VISUAL_DRIFT_LEDGER.csv` region by region. Do not treat source comments, old commit messages, or v2.2 prose as pixel evidence.
>
> Preserve mock-supported containers. The issue is not "containers are bad"; the issue is implementation-invented containers. The mock's hero pill, channel tiles, flow strip, payer cards, trust icon circles, top notice, and any other visible treatment must be judged from the pixels rather than from anti-template ideology.
>
> Retire the shared `.cr-mkt-eyebrow` public pattern. A mock-supported PUB-001 contextual label may remain as PUB-001-specific styling. Do not propagate it to pages without a canonical reference.
>
> Revisit any current-branch composition that was changed only to satisfy adjacency, grid-count, image-count or enum rules. If those rules caused drift away from the mock, restore the mock-supported composition and update the tests instead of redesigning the mock.
>
> Keep the existing VIS-001 Martian/Inter/Martian Mono implementation, `--couranr-*` tokens, accessibility work, responsive work, shell fixes, governed copy and product behavior.
>
> Update tests so they enforce the reconciled mock-derived ledger. A test is defective if passing it requires the UI to be less faithful to the canonical mock.
>
> Run the generic-AI-template test as a hard human-visible stop, but never use that heuristic to override a treatment explicitly present in the mock.
>
> Show the owner PUB-001 before/after at desktop and mobile before continuing visual work on PUB-008/009/010/011 or product families.
