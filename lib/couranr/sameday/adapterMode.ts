/**
 * The ONE place that decides whether Same Day runs on the real consumer
 * backend (`live`) or on deterministic in-memory fixtures (`fixture`).
 *
 * LIVE IS THE DEFAULT for every real environment. The consumer stack exists —
 * guest sessions, the `/api/couranr/consumer/*` routes, canonical Google
 * address resolution, Mapbox routing, shared Pricing V2, shipment policy,
 * request persistence, the Stripe payment obligation flow, tracking and pickup
 * credentials — so `/send` is a normal product capability, not an env-flag
 * preview. Production does NOT depend on any `COURANR_CONSUMER_SEND*` switch.
 *
 * `fixture` is TEST-ONLY plus an explicit local/preview opt-in. Automated
 * tests always get fixtures (deterministic, no provider spend); outside
 * production a developer can opt in with `COURANR_SAMEDAY_FIXTURES`. Asking for
 * fixtures in production is a configuration error, surfaced as one — it still
 * resolves `live` (the real product), never a fake-data screen.
 *
 * The guarantee is STRUCTURAL: the inputs are server/build-time environment
 * values only. A visitor cannot force fixtures — not with a query parameter, a
 * hash, storage, a cookie or a public URL flag; nothing here reads any of them.
 */

export type AdapterMode = "fixture" | "live";

export type AdapterModeResolution = {
  mode: AdapterMode;
  /** Why, in one word, for tests and for an operator reading a log. */
  reason:
    | "production"
    | "preview"
    | "development"
    | "test"
    | "fixtures_opt_in"
    | "production_fixtures_refused"
    | "default";
  /** True when configuration asked for something this environment refuses. */
  misconfigured: boolean;
};

/** Only these inputs. Every one is server- or build-side. */
export type AdapterEnv = {
  /** `process.env.NODE_ENV`. */
  nodeEnv?: string;
  /** Vercel's environment: "production" | "preview" | "development". */
  vercelEnv?: string;
  /**
   * The explicit fixture opt-in, `COURANR_SAMEDAY_FIXTURES`. Honoured OUTSIDE
   * production only; in production it is a recorded misconfiguration that still
   * resolves `live`.
   */
  fixtureFlag?: string;
};

export function readAdapterEnv(): AdapterEnv {
  return {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    fixtureFlag: process.env.COURANR_SAMEDAY_FIXTURES,
  };
}

const truthy = (v?: string) => ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase());

/**
 * Resolves the mode from environment alone.
 *
 * `VERCEL_ENV` WINS WHEN PRESENT. Next sets `NODE_ENV=production` for every
 * production build, previews included, so a preview deployment is
 * `NODE_ENV=production, VERCEL_ENV=preview`; trusting NODE_ENV alone would
 * misclassify every preview as production. A real Vercel production deployment
 * sets `VERCEL_ENV=production`; a non-Vercel build has none and falls back to
 * NODE_ENV.
 */
export function resolveAdapterMode(env: AdapterEnv = readAdapterEnv()): AdapterModeResolution {
  const node = String(env.nodeEnv ?? "").toLowerCase();
  const vercel = String(env.vercelEnv ?? "").toLowerCase();
  const isProduction = vercel ? vercel === "production" : node === "production";

  // Automated tests always run deterministic fixtures — no provider spend, no
  // clock, no network.
  if (node === "test") return { mode: "fixture", reason: "test", misconfigured: false };

  // Explicit fixture opt-in, honoured OUTSIDE production only. Asking for
  // fixtures in production is a configuration error surfaced as one; it still
  // resolves `live` (the real product), never a fabricated preview.
  if (truthy(env.fixtureFlag)) {
    return isProduction
      ? { mode: "live", reason: "production_fixtures_refused", misconfigured: true }
      : { mode: "fixture", reason: "fixtures_opt_in", misconfigured: false };
  }

  // LIVE IS THE DEFAULT for every real environment — production, preview,
  // development, and anything unrecognised. The consumer backend exists and is
  // guarded server-side (guest tokens, paid-provider budgets, canonical
  // pricing/routing/state authority); the funnel is a normal capability.
  const reason: AdapterModeResolution["reason"] = isProduction
    ? "production"
    : vercel === "preview"
      ? "preview"
      : node === "development"
        ? "development"
        : "default";
  return { mode: "live", reason, misconfigured: false };
}

export function adapterMode(env?: AdapterEnv): AdapterMode {
  return resolveAdapterMode(env).mode;
}

export function fixturesEnabled(env?: AdapterEnv): boolean {
  return adapterMode(env) === "fixture";
}
