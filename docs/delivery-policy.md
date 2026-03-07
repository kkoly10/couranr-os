# Delivery policy semantics

This document explains how courier distance thresholds are intended to work across product and operations.

## Threshold definitions

- **Service area radius**
  - The outer boundary where courier service is offered.
  - Source: `lib/serviceArea.ts` (`COURIER_SERVICE_RADIUS_MILES`).

- **Instant quote max miles**
  - The maximum distance accepted in the self-serve quote UI.
  - Source: `lib/delivery/policy.ts` (`DELIVERY_INSTANT_QUOTE_MAX_MILES`).

- **Long-distance flag miles**
  - Internal analytics/ops flag threshold, not an automatic rejection rule.
  - Source: `lib/delivery/policy.ts` (`DELIVERY_LONG_DISTANCE_FLAG_MILES`).

## Expected behavior

1. If request miles exceed **service area** → request is out-of-area.
2. If request miles are within service area but exceed **instant quote max** (if configured lower) → route to manual/custom quoting flow.
3. If request miles exceed **long-distance flag** → allow quote flow, but mark as long-distance for operations reporting/monitoring.

## Operational note

Any change to a distance threshold should be updated in both:
- policy constants (`lib/delivery/policy.ts` / `lib/serviceArea.ts`), and
- customer-facing copy that references those thresholds.
