# Review-outcome state transitions

**Owner-approved 2026-07-31.** Drafted from the sources below, then decided by the
owner, who made confirm-as-quoted payer-dependent. The UML and freight material
is **supporting rationale, not authority** — the owner decision is the authority.

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
*which `request_state` an accept, requote or decline moves to*. The transition graph was therefore drafted rather than inherited, and then
**decided by the owner on 2026-07-31**. `REV-001` carries `owner_approved: true`.
No future reader should treat the reasoning below as the authority; it is why the
options looked the way they did, not why one was chosen.

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

## The design (owner-approved)

Each outcome sets `review_state` **and** fires one explicit guarded transition on
`request_state`, in a single transaction with an event row.

| Command | UI label | `payer_type` | `review_state` | `request_state` |
|---|---|---|---|---|
| `couranr_accept_delivery_request_as_quoted` | Confirm as quoted | **merchant** | `accepted_as_quoted` | **`confirmed`** |
| | | **customer** | `accepted_as_quoted` | `awaiting_quote_acceptance` |
| `couranr_requote_delivery_request` | Send revised quote | either | `requoted` | `quote_revision_required` |
| `couranr_decline_delivery_request` | Could not confirm service | either | `declined` | `declined` |

Preconditions for all: `request_state = pending_couranr_review`,
`review_state = pending`, matching `version`.

### Why confirm-as-quoted is payer-dependent

**Merchant-paid → `confirmed`.** The merchant approved the exact displayed quote
when they submitted. Operations confirmed it *without changing the price*, so a
second merchant approval would ask the same party to approve the same number
twice. This is the owner's decision and it overrides the draft, which had both
payer types waiting.

**Customer-paid → `awaiting_quote_acceptance`.** The merchant cannot approve a
customer-paid quote on the customer's behalf. The customer must still see and
approve the price. `CUS-005 Revised Quote Approval` and the hosted payment page
are that path.

### The acknowledgment that makes the merchant shortcut safe

Skipping an approval step is only sound if the approval genuinely happened
earlier. So the merchant-paid direct transition to `confirmed` is gated on proof:

- `MER-006` submission copy states plainly:
  *"I approve this delivery estimate if Couranr confirms it without changes."*
- The acknowledgment is recorded in the **immutable submission event metadata**
  with `payer_type`, `pricing_policy_version`, `delivery_subtotal_cents`,
  `quote_status` and `acknowledgment = true`.
- Only the **server-stored** quote is recorded. A browser-supplied subtotal is
  never trusted and never written.

`couranr_accept_delivery_request_as_quoted` verifies, for a merchant-paid
request: the acknowledgment exists, the current quote **is** the submitted quote,
the quote was not revised, the expected version matches, and both states are at
their preconditions. **If the acknowledgment is absent it does not silently
confirm** — it returns a stable conflict requiring payer approval.

That conflict has its **own SQLSTATE, `CR412`**, separate from the `CR409` a
stale `version` raises. Both are "conflicts", but they need opposite advice: a
concurrency race is fixed by reloading, and a missing acknowledgment never is.
While both shared CR409 the operator was told "reload and try again" for a
condition reloading cannot change — a loop with no exit. Browser assertion
`L11` covers it. `CR412` classifies to the public code `conflict`;
`CR409` classifies to `version_conflict`.

### What `confirmed` means, and does not

`request_state = confirmed` means Couranr confirmed the request and the unchanged
quote. It does **not** mean payment authorized, payment captured, merchant ready,
scheduled, assigned or dispatched. Payment, readiness and fulfillment remain
separate state groups and continue to gate delivery creation — which is exactly
the independence `STA-001` is protecting.

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
- A refused confirm writes **nothing** — no state change, no version bump, no
  event. Asserted on rows, not on copy (`L9`, `L10`, `L12`).

## Resolved

The draft flagged one likely amendment: whether merchant-paid deliveries have a
payer approval step. The owner decided on 2026-07-31 that they do not, and that
the submission acknowledgment is what makes skipping it safe. That is now the
design above rather than an open question.
