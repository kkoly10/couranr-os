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

**Adversarial correction:** D2 must not blindly "lazy join" an Operations
participant for every admin. The current live-participant unique index
`couranr_cvp_live_user_uniq` permits only one live participant row per
`(conversation_id, user_id)`. A real Couranr user can be dual-role — for
example, an Operations admin can also be the owner of the pilot business. That
same person may need to act as **merchant on /business** and **Operations on
/operations** without those authorities bleeding into each other.

Therefore D2 must make Operations thread access **surface/context-aware**. It
must either:

1. add an Operations-specific read/send authority path that verifies
   `profiles.role='admin'` and records the real actor without requiring a
   second live participant row; or
2. deliberately change the participant uniqueness + resolver contract so two
   role-specific participant rows can coexist and every route explicitly names
   which actor context it is resolving.

Option 1 is the narrower MVP direction. A second participant row must not be
added until this dual-role ambiguity is resolved end to end.

This preserves real human audit identity without pretending "Couranr
Operations" is one shared auth user or leaking Operations-only visibility into
the merchant surface.

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
