# 00 — Stripe inventory

12 files import the `stripe` SDK. `@stripe/stripe-js` and `@stripe/react-stripe-js` are declared but have **zero imports**.

## SDK initialisation — inconsistent

| File:line | API version |
|---|---|
| `lib/stripe.ts:7-9` | `2024-04-10` |
| `lib/delivery/authorizeDeliveryPayment.ts:4-6` | `2024-04-10` (duplicate instance) |
| `app/api/delivery/start-checkout/route.ts:17-19` | `2024-04-10` |
| `app/api/orders/by-session/route.ts:7-9` | `2024-04-10` |
| `app/api/create-checkout-session/route.ts:4-6` | `2024-04-10` |
| `app/api/auto/*`, `app/api/docs/*` | `2024-04-10` |
| **`app/api/stripe/webhook/route.ts:15`** | **none — floats with the SDK default** |

## Entry points

| Function | File:line | Auth |
|---|---|---|
| Checkout create (delivery) | `app/api/delivery/start-checkout/route.ts:250` | Bearer; recomputes price server-side at `:180-186`, validates miles at `:169` |
| Checkout create (legacy) | `app/api/create-checkout-session/route.ts:19` | **none — amount from request body** |
| Checkout create (auto/docs) | 3 routes | Bearer |
| Checkout retrieve | 3 routes | one has **none** (`orders/by-session`) |
| PaymentIntent create, `capture_method: manual` | `lib/delivery/authorizeDeliveryPayment.ts:24` | **zero callers — dead code** |
| Capture | `lib/stripe/capturePayment.ts:21` | via `/api/delivery/complete` |
| Refund | `app/api/admin/auto/refund-deposit/route.ts:147` | `requireAdmin` — **auto only** |
| Webhook | `app/api/stripe/webhook/route.ts:355` | signature verified `:363-367` |
| Authorization release / cancel | — | **does not exist** |
| Reconciliation / ledger | — | **does not exist** |

## Webhook
Single multi-product endpoint handling `checkout.session.completed` and `checkout.session.async_payment_succeeded` only. Replay guards are per-table JSON `.contains()` reads with **no unique constraint and no idempotency key**. `resilientUpdateById` (`:39-70`) parses "column does not exist" errors and **retries up to 20 times, dropping the offending field each pass** — applied to `orders` (`:240`) and `deliveries` (`:248`). Any thrown error returns HTTP 400, which tells Stripe to retry permanent failures.

## Metadata
Producer writes `serviceType`, `orderId`, `deliveryId`, `orderNumber`, `customerId`, `businessAccountId` (`start-checkout:266-273`). **None** of the six required Couranr keys (`Master Package:832`) is present.

## Defects
1. `lib/delivery/authorizeDeliveryPayment.ts:2`, `lib/stripe/capturePayment.ts:2` and `lib/delivery/completeDelivery.ts:1` import the **`"use client"` browser Supabase client** into server-only money code — effectively `anon`.
2. `authorizeDeliveryPayment` sets `payment_status: "authorized"` at PaymentIntent **creation** (`:39-41`), before payer confirmation.
3. `completeDelivery.ts:26` calls `capturePayment(order.payment_intent_id)` — a bare string — where the signature requires `{ orderId }`. Masked by `strict: false`.
4. `capturePayment` never checks its `orders` update error (`:26-31`); a failed write is silently discarded **after** the Stripe capture has already happened.
