# Review-outcome state transitions — derived design

Registry record: **REV-001**.

## Why this document exists

No delivered package defines what a review outcome does to `request_state`. I
checked all three sources that could have:

| Source | Gives | Does not give |
|---|---|---|
| `Couranr_Claude_Code_Master_Package.md` §8 | the `request` and `review` vocabularies, actor authority | any transition |
| `couranr_claude_code_package/02_DECISION_REGISTRY.json` (v1.0) | the same vocabularies under `states` | any transition |
| root `02_DECISION_REGISTRY.json` → `TRN-001` | "no arbitrary target status; every transition is a named server command" | any transition |

All three answer *who* may act and *what the state names are*. None answers
*which `request_state` an accept, requote or decline moves to*. This design is
therefore **derived, not delivered**, and is marked as such in the registry
(`derived_not_delivered: true`) so no future reader mistakes it for something
that shipped in a package.

## The question

`STA-001` says request, payment, readiness and review are **independent state
groups, not one mixed status column**. Read at its narrowest that could mean a
review outcome touches only `review_state`. But leaving a declined request
sitting in `request_state = pending_couranr_review` forever is obviously wrong —
the Operations queue would never drain.

So: do independent state groups coordinate, and if so, how?

## What the sources say

**Orthogonal regions are independent, but coordination between them is a
first-class, documented pattern — not a violation of independence.**

- "A composite state can contain two or more orthogonal regions (orthogonal
  means independent in this context)… transitions in one region do not affect
  the other."
  ([UML state machine, Wikipedia](https://en.wikipedia.org/wiki/UML_state_machine))
- "In most real-life situations, orthogonal regions are only approximately
  orthogonal (i.e., they are not independent). Orthogonal regions can coordinate
  their behaviors by sending event instances to each other."
  ([Wikipedia](https://en.wikipedia.org/wiki/UML_state_machine);
  [Orthogonal Component pattern, state-machine.com](https://www.state-machine.com/doc/Pattern_Orthogonal.pdf))
- A parent state changes through "explicit transitions that originate from the
  parent state with appropriate guards", not implicitly from a sub-state
  outcome. ([A Crash Course in UML State Machines](https://www.state-machine.com/doc/AN_Crash_Course_in_UML_State_Machines.pdf))

That resolves it. `STA-001` forbids collapsing the groups into one column. It
does not forbid one **explicit, named, guarded** transition per command.

**Naming and change discipline:**

- "Identify the states as nouns (Draft, Review, Published) and the events as
  verbs (submit, approve, publish)." Our states are nouns; our commands are
  verbs. ([commercetools, state machine best practices](https://docs.commercetools.com/learning-model-your-business-structure/state-machines/states-and-best-practices))
- "Consider creating new States instead of directly modifying existing ones."
  This design adds **no** new state value — every target already exists in the
  `STA-001` vocabulary. ([commercetools](https://docs.commercetools.com/learning-model-your-business-structure/state-machines/states-and-best-practices))

**Domain convention — approval sits between confirmation and release:**

- In freight agreement workflows the lifecycle goes to **"Awaiting Approval"** on
  submission and only to "Released" once an approver confirms.
  ([SAP TM freight agreement approval workflow](https://community.sap.com/t5/supply-chain-management-blog-posts-by-members/sap-tm-freight-agreement-approval-workflow-process-and-set-up/ba-p/14137256))
- A re-quote does not bypass that: significant rate changes **require client
  approval** before the shipment proceeds.
  ([FreightAmigo, freight quote validity and re-quoting](https://www.freightamigo.com/en/blog/logistics/understanding-freight-quote-validity-and-re-quoting-ensuring-accurate-pricing-for-your-shipments/);
  [Freightos SOP](https://www.freightos.com/standard-operating-procedure/))
- Order quote approval workflows model exactly "Pending Approval → Approved /
  Rejected" with the approve and reject actions on the pending state.
  ([Oracle NetSuite, order quote approval workflow](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_163878389082.html))

## The design

Each outcome sets `review_state` **and** fires one explicit guarded transition
on `request_state`, in a single transaction with an event row.

| Command | UI label (OPS-002) | `review_state` | `request_state` |
|---|---|---|---|
| `couranr_accept_delivery_request_as_quoted` | Confirm as quoted | `accepted_as_quoted` | `awaiting_quote_acceptance` |
| `couranr_requote_delivery_request` | Send revised quote | `requoted` | `quote_revision_required` |
| `couranr_decline_delivery_request` | Could not confirm service | `declined` | `declined` |

Preconditions for all three: `request_state = pending_couranr_review`,
`review_state = pending`, and a matching `version` (compare-and-set).

### Why each target

**Accept → `awaiting_quote_acceptance`.** Couranr confirming the price does not
end the request, because the payer has not agreed yet. Two repo sources say the
payer step exists: the registry's `payers.capture_timing` is
`after_couranr_confirmation`, and Master Package §8 gives the merchant "approve
merchant-paid quotes" and the customer "approve customer-paid quote". This is
the SAP TM "Awaiting Approval" position exactly.

**Requote → `quote_revision_required`.** A revised quote is issued and the payer
must approve it; `CUS-005 Revised Quote Approval` is that screen, and
`OPS-004 Requote & Promotional Credit` is the operator side. Both a first
acceptance and a revision end in payer approval, which is why the vocabulary
carries two distinct states — one per track — rather than one shared waiting
state.

**Decline → `declined`.** The only unambiguous mapping. Both vocabularies carry
`declined`, and Master Package §9 names the action "could not confirm service".

### Onward, and explicitly not in this slice

`awaiting_quote_acceptance` and `quote_revision_required` both advance to
`confirmed` when the payer approves, or to `cancelled` if the payer declines or
the quote expires. Those transitions belong to the payment slice. **No review
command authorizes or captures payment, and none creates an order or a
delivery.**

## Invariants

- No target state is ever read off the request — the command name selects it.
- Accept uses the **current server-computed** quote; no caller supplies an amount.
- Requote recomputes through the canonical pricing engine and its line items
  must sum to the subtotal.
- Decline requires a structured reason; an internal note is optional.
- Operations/admin only. Merchants read the outcome on MER-007, never write one.
- Compare-and-set on `version` turns a stale write into a conflict, not a
  silent overwrite.

## What would change this

If the owner decides the payer step does not exist for merchant-paid deliveries
— that Couranr confirming a merchant-paid quote goes straight to `confirmed` —
then accept would target `confirmed` when `payer_type = 'merchant'`. That is a
product decision, not a modelling one, and it is the single most likely
amendment to this record.
