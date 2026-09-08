# Couranr Pickup Handoff V2 — implementation plan

Status: implementation in progress  
Owner decision: 2026-09-05  
Base: `ea8bd06483229f16a2c6df9a30b41b7872324090`

## Problem

The current driver pickup flow asks the assigned driver to re-enter or re-confirm facts Couranr already owns: package count, staff first name, assigned vehicle, a second condition photo, and several large-load free-text fields. That creates avoidable pickup dwell time and makes the browser restate canonical order facts.

The current pickup code is also merchant-centric: a business or Operations user explicitly issues a six-digit code, the raw code is shown once, and the driver types it. Consumer Same Day has no equivalent sender-side issuance surface.

## External pattern check

DoorDash Drive exposes pickup instructions, pickup reference tags, item details, and pickup verification metadata so the courier can identify the order rather than recreate it. Uber Direct similarly carries order-item name/quantity and optional dimensions/weight/handling. Couranr should follow the same separation of responsibility while preserving its own custody/security rules.

## V2 authority model

### Sender / request authority
The sender provides the expected pickup facts before dispatch:
- short item description
- package count when known
- order/reference number when useful
- pickup instructions (existing address instructions remain canonical)
- handling note when useful
- weight / weight band and safety declaration remain governed by existing shipment policy

### Couranr authority
Couranr freezes those facts into a request pickup-manifest and copies that manifest into the immutable delivery shipment snapshot. The browser never chooses mileage, price, vehicle, lifecycle state, or proof rules.

### Driver authority
The driver contributes only new physical-world evidence:
- arrival/location
- pickup credential presented by the sender
- one pickup photo showing what was actually collected
- explicit happy-path confirmation that the physical pickup matches Couranr's expected pickup
- discrepancy evidence only when something differs

The driver does not re-enter expected package count, merchant staff identity, or assigned vehicle on the happy path.

## Happy-path pickup

1. Driver arrives; Couranr records location/time.
2. Driver sees the expected pickup summary and pickup instructions.
3. Sender opens the pickup credential surface and presents QR + six-digit fallback.
4. Driver scans/enters the credential.
5. Driver takes one pickup photo.
6. Driver taps **Confirm pickup & start delivery**.
7. Server verifies:
   - active assigned driver
   - state is `at_pickup`
   - usable location
   - pickup credential was consumed
   - pickup shipment photo is finalized for the active assignment
   - no open pickup discrepancy
   - securement photo exists only when server-derived large/unusual rules require it
8. Server records the custody handoff and advances `at_pickup -> picked_up`.

## Exception path

**Something is different** opens DRV-004. The driver records the discrepancy; Operations decides whether the delivery may continue, requires requote/re-dispatch, or is cancelled. A mismatch never silently overwrites the sender's expected facts.

## Credential model

Existing merchant/Operations pickup-code issuance remains compatible. V2 changes presentation to a pickup credential card with QR plus six-digit fallback.

Consumer Same Day gets a guest-scoped pickup credential endpoint. To preserve auditability, `couranr_handoff_codes` records either an authenticated issuer or a guest-session issuer, never neither and never both. The plaintext code remains ephemeral and is returned only in the issuance response.

The raw pickup credential is never sent to the driver in advance. The sender presents it at handoff.

## Data model

Add `couranr_delivery_requests.pickup_manifest jsonb` with a constrained object shape managed only by server commands. It remains nullable for historical requests.

A delivery-insert trigger merges the request manifest into `couranr_deliveries.shipment.pickupManifest`, so every assignment reads the frozen delivery snapshot rather than mutable request UI state.

## Submission surfaces

### Business
Collect:
- item description — required
- package count — optional but encouraged
- order/reference — optional
- handling note — optional
- existing pickup-address access notes remain separate

Save the manifest after request creation and before submission/review can advance.

### Consumer Same Day
Use the existing item description plus a lightweight package-count field. Save the manifest against the guest-owned request after the first estimate creates it and before submission can advance.

### Merchant-hosted request
Customer submits description, package count if known, and order reference. During merchant validation the merchant confirms/edits description and package count before the hosted request can advance.

## Large / unusual loads

Keep objective evidence; remove routine free-text burden. V2 requires a securement photo when the server-derived large/unusual rule applies. Loading participants/equipment/damage prose and a generic acknowledgement are no longer happy-path blockers. Damage or mismatch belongs in the discrepancy flow.

## Non-goals

- No pricing changes.
- No route/provider changes.
- No Google, Mapbox, Stripe, Anthropic, SMS, or other metered call for implementation/testing.
- No production Same Day canary.
- No automatic SMS/email delivery of pickup PINs.
- No weakening of assignment scoping or handoff attempt limits.

## Adversarial checklist before merge

- A stranger cannot issue, view, verify, or burn another delivery's pickup credential.
- Guest issuance is scoped to exactly the guest session's own request/delivery.
- QR contains only the same six-digit credential the manual fallback uses; no bearer tracking token or PII.
- A consumed credential cannot be reused for another delivery/generation.
- Driver cannot complete pickup without a finalized pickup photo or usable location.
- Driver cannot bypass an open discrepancy.
- Large/unusual securement remains server-derived and cannot be disabled by the browser.
- No driver-supplied package count can overwrite expected package count.
- Historical deliveries with no pickup manifest remain readable and completable.
- Delivery shipment snapshot is frozen from the request before assignment.
- Existing merchant/Operations code issuance remains valid.
- Consumer production remains fail-closed behind existing feature flags.
- No paid provider call is needed to verify any of this.
