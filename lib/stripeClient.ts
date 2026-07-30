import Stripe from "stripe";
import { requireEnv } from "@/lib/env";

/**
 * Server-only Stripe client, lazily initialized.
 *
 * Mirrors `lib/supabaseAdmin.ts`: the exported value is a Proxy, so importing
 * this module has no side effects and `next build`'s page-data collection can
 * import any route that uses Stripe without STRIPE_SECRET_KEY being present.
 * The key is read on first property access.
 *
 * API VERSION
 * -----------
 * Pinned to 2024-04-10 for every call site. Eleven of twelve construction sites
 * already pinned this; `app/api/stripe/webhook/route.ts` pinned none and
 * floated with the SDK default. For the installed stripe@15.12.0 the default IS
 * 2024-04-10 (node_modules/stripe/cjs/apiVersion.js:5, consumed at
 * stripe.core.js:16 and :77), so pinning it here changes no behaviour today —
 * it removes the hazard that an SDK upgrade would silently move the webhook's
 * API version while leaving every other call site pinned.
 *
 * stripe@15.12.0 is frozen until characterization tests exist. Do not upgrade
 * it here, and do not change this version without them.
 */

export const STRIPE_API_VERSION = "2024-04-10" as const;

let cached: Stripe | null = null;

function getStripe(): Stripe {
  if (cached) return cached;
  cached = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
    apiVersion: STRIPE_API_VERSION,
  });
  return cached;
}

export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripe();
    const value = Reflect.get(client, prop);
    // Bind to the real client so methods keep their `this` when destructured.
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** Escape hatch for code that needs the concrete instance. */
export function getStripeClient(): Stripe {
  return getStripe();
}
