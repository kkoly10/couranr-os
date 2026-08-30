/**
 * The ONE place that decides whether Same Day runs on fixtures.
 *
 * `/send` is a complete frontend with no backend behind it: no address search,
 * no availability check, no Smart Intake, no quote, no Stripe, no persistence.
 * Every one of those is a typed adapter, and every adapter asks THIS module
 * whether it is allowed to answer. No page and no component decides for itself,
 * because a scattered `if (fixture)` is how a fixture reaches production one
 * branch at a time.
 *
 * PRODUCTION IS ALWAYS DISABLED, and the resolution order makes that
 * unconditional rather than a default someone can override. A visitor cannot
 * turn fixtures on: not with a query parameter, a hash, localStorage,
 * sessionStorage, a cookie or a public URL flag. Nothing here reads any of
 * them — the inputs are server/build-time environment values only, which is
 * what makes the guarantee structural rather than a promise.
 *
 * FAIL CLOSED. A production build that ASKS for fixtures gets `disabled` and a
 * recorded misconfiguration, never fixtures. The safe direction is refusing to
 * pretend.
 */

export type AdapterMode = "fixture" | "disabled";

export type AdapterModeResolution = {
  mode: AdapterMode;
  /** Why, in one word, for tests and for an operator reading a log. */
  reason:
    | "production"
    | "production_override_refused"
    | "development"
    | "test"
    | "preview_enabled"
    | "preview_not_enabled"
    | "unknown_environment";
  /** True when configuration asked for something this environment refuses. */
  misconfigured: boolean;
};

/** Only these inputs. Every one is server- or build-side. */
export type AdapterEnv = {
  /** `process.env.NODE_ENV`. */
  nodeEnv?: string;
  /** Vercel's environment: "production" | "preview" | "development". */
  vercelEnv?: string;
  /** The explicit opt-in. Honoured on preview ONLY. */
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
 * Production is checked FIRST and returns before any opt-in is consulted, so
 * there is no ordering in which a flag reaches a production decision.
 */
export function resolveAdapterMode(env: AdapterEnv = readAdapterEnv()): AdapterModeResolution {
  const node = String(env.nodeEnv ?? "").toLowerCase();
  const vercel = String(env.vercelEnv ?? "").toLowerCase();

  const isProduction = node === "production" || vercel === "production";
  if (isProduction) {
    /* Asking for fixtures in production is a CONFIGURATION ERROR, surfaced as
       one. It still resolves disabled — the refusal is the behaviour, the flag
       is the report. */
    return truthy(env.fixtureFlag)
      ? { mode: "disabled", reason: "production_override_refused", misconfigured: true }
      : { mode: "disabled", reason: "production", misconfigured: false };
  }

  if (node === "test") return { mode: "fixture", reason: "test", misconfigured: false };

  if (vercel === "preview") {
    return truthy(env.fixtureFlag)
      ? { mode: "fixture", reason: "preview_enabled", misconfigured: false }
      : { mode: "disabled", reason: "preview_not_enabled", misconfigured: false };
  }

  if (node === "development") return { mode: "fixture", reason: "development", misconfigured: false };

  /* An environment this module does not recognise gets the safe answer. */
  return { mode: "disabled", reason: "unknown_environment", misconfigured: false };
}

export function adapterMode(env?: AdapterEnv): AdapterMode {
  return resolveAdapterMode(env).mode;
}

export function fixturesEnabled(env?: AdapterEnv): boolean {
  return adapterMode(env) === "fixture";
}
