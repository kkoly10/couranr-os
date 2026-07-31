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

/**
 * Point the SDK at a local Stripe double.
 *
 * Set `STRIPE_API_BASE` (e.g. `http://127.0.0.1:12111`) and the real SDK
 * builds and sends its real HTTP request — same path, same form encoding, same
 * `Idempotency-Key` header — to a recorder instead of api.stripe.com. That is
 * what makes the payment flows drivable in a container with no Stripe
 * credentials: it proves the request WE build is correct, and it proves
 * nothing about whether Stripe would accept it. Both facts are reported.
 *
 * IGNORED IN PRODUCTION. A misconfigured env var must never be able to
 * redirect live payment traffic, so the override is refused outright when
 * NODE_ENV is production — it is a test seam, not a feature flag.
 */
function apiBaseOverride(): { host: string; port: number; protocol: "http" | "https" } | null {
  const raw = process.env.STRIPE_API_BASE;
  if (!raw) return null;
  if (process.env.NODE_ENV === "production") return null;
  try {
    const u = new URL(raw);
    return {
      host: u.hostname,
      port: Number(u.port || (u.protocol === "https:" ? 443 : 80)),
      protocol: u.protocol === "https:" ? "https" : "http",
    };
  } catch {
    return null;
  }
}

function getStripe(): Stripe {
  if (cached) return cached;
  const override = apiBaseOverride();
  cached = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
    apiVersion: STRIPE_API_VERSION,
    ...(override ?? {}),
  });
  return cached;
}

/** True when this process is talking to a double rather than to Stripe. */
export function isStripeDoubled(): boolean {
  return apiBaseOverride() !== null;
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
