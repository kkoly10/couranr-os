# Driver Pilot Readiness — D0 Authority Contract

Status: **implemented authority substrate; UI/reachability follows in D1–D3**

This document narrows the Driver Pilot Readiness work after the adversarial pass.
It does not reopen Pricing V2, Mapbox routing, payer authority, Automatic
Fulfillment, or the canonical delivery lifecycle.

## 1. Human message addressing

Conversation-kind visibility and actor addressing are separate authorities.

Allowed HUMAN addressing matrix:

| Actor | participants | driver_and_couranr | merchant_and_couranr | couranr_internal |
|---|---:|---:|---:|---:|
| Driver | yes | yes | no | no |
| Merchant | yes | no | yes | no |
| Operations | yes | yes | yes | yes |
| Customer | yes | no | no | no |

The named server command must enforce this matrix before any insert. The
database repeats it as defence in depth. Hiding an audience control in React is
never authorization.

## 2. Delivery-chat issuance boundary

A `delivery_chat` is issued only **after the canonical `couranr_deliveries`
row exists**.

Reason: the conversation schema requires `delivery_id` for `delivery_chat`.
Request confirmation alone is not a sufficient boundary because the canonical
delivery may not exist until the commercial path creates it.

The future issuance command must therefore be idempotent by
`(delivery_id, kind='delivery_chat')` and callable from/reconciled across every
canonical delivery-creation path, including Stripe/capture and Couranr
promotional credit.

Messaging failure must never roll back creation of a valid delivery.

## 3. Operations participation

Do not hardcode a founder/operator user into every thread.

The Operations Inbox remains a role-authorized cross-business projection.
When a specific authenticated Operations user needs to open or send in a
thread, D2 will idempotently establish that user's `operations` participant
row after verifying `profiles.role='admin'`.

That gives every human message a real author and audit identity without
pretending "Couranr Operations" is one shared auth user.

## 4. Driver tenure

The assigned driver joins the delivery chat at assignment time.

Replacement, pre-pickup unassignment, cancellation/terminal completion, and
other assignment-ending paths must close that driver's participant tenure by
writing `left_at`. A replacement driver gets a new participant row and does
not inherit driver-only history from before `joined_at`.

This remains D2 implementation work; D0 only fixes the addressing authority
before any production delivery chat becomes reachable.

## 5. Availability authority

`availability_state` remains operational truth:

- `available`
- `unavailable`
- `on_delivery`

`on_delivery` remains system-owned.

D0 adds `availability_preference` as the driver's next-idle intent:

- `available`
- `unavailable`

An assigned driver can later choose "Go offline after this delivery" by changing
preference only. Their operational state remains `on_delivery`.

Every release path is protected by a database guard: if the stored preference
is `unavailable`, a release that tries to write `available` is rewritten to
`unavailable`. This deliberately covers old replacement/unassignment code as
well as the canonical completion helper.

## 6. Explicitly not added in D0

- no weekly shift planner;
- no gig marketplace;
- no multi-vehicle preference model;
- no new paid API;
- no in-app Mapbox navigation SDK;
- no PWA/service-worker dependency;
- no new delivery for Pilot #1.

D1 will build the real self-scoped Availability/Vehicle/Home surfaces on top of
this authority substrate. D2 will make messaging reachable. D3 will close
offline proof and driving-mode reliability.
