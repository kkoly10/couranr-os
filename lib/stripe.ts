/**
 * Kept as a stable import path. The client itself now lives in
 * `lib/stripeClient.ts` and is lazily initialized.
 *
 * This module previously threw `Missing STRIPE_SECRET_KEY` at import time,
 * which broke `next build` in any environment without production secrets.
 */
export { stripe, getStripeClient, STRIPE_API_VERSION } from "@/lib/stripeClient";
