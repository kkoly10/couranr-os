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

export type AdapterMode = "fixture" | "disabled" | "live";

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
    | "unknown_environment"
    | "live_enabled"
    | "production_live_enabled"
    | "production_live_refused";
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
  /**
   * TWO-KEY LIVE ARMING (batch 3 §D). Key one: `COURANR_CONSUMER_SEND` must be
   * EXACTLY the string "live" — not "1", not "true"; a switch this consequential
   * is armed by naming the thing, never by truthiness.
   */
  consumerSendFlag?: string;
  /**
   * Key two: `COURANR_CONSUMER_SEND_PRODUCTION`, also exactly "live". Required
   * IN ADDITION to key one before a production environment resolves `live`.
   * MKT-005's production stop stays the default: one key in production is a
   * recorded misconfiguration that still resolves `disabled`.
   */
  consumerSendProductionFlag?: string;
};

export function readAdapterEnv(): AdapterEnv {
  return {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    fixtureFlag: process.env.COURANR_SAMEDAY_FIXTURES,
    consumerSendFlag: process.env.COURANR_CONSUMER_SEND,
    consumerSendProductionFlag: process.env.COURANR_CONSUMER_SEND_PRODUCTION,
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

  /* `VERCEL_ENV` WINS WHEN PRESENT, and getting this backwards made the preview
     branch below unreachable.
     Vercel's docs describe VERCEL_ENV as "the environment the app is running
     on, such as production, preview, or development" — and Next sets
     NODE_ENV=production for EVERY production build, previews included. So a
     preview deployment is `NODE_ENV=production, VERCEL_ENV=preview`. Treating
     NODE_ENV alone as authoritative classified every preview as production:
     fixtures could never be enabled there, and a correctly configured preview
     was reported as `production_override_refused` — a real misconfiguration
     warning for a configuration that was right.
     Found by trying to drive the fixture flow in a browser. The unit test
     missed it because it asserted the no-flag preview case, where `disabled`
     is correct either way.
     Safety is unchanged in both directions: a real Vercel production
     deployment sets VERCEL_ENV=production, and a non-Vercel production build
     has no VERCEL_ENV and falls back to NODE_ENV. */
  const isProduction = vercel ? vercel === "production" : node === "production";

  /* TWO-KEY LIVE ARMING, checked before every other branch so that a
     deliberately armed environment cannot be re-classified as fixtures.
     `live` wires `/send` to the real consumer API — a real request, a real
     price, a real payment — so it is the one mode that must NEVER be an
     accident:
       - key one alone arms every NON-production environment;
       - production requires BOTH keys, and one key there is a recorded
         misconfiguration that still resolves `disabled` (MKT-005's stop is
         the behaviour, the flag is the report — same shape as the fixture
         refusal below);
       - both values must be exactly "live". Truthiness does not arm. */
  if (env.consumerSendFlag === "live") {
    if (!isProduction) {
      return { mode: "live", reason: "live_enabled", misconfigured: false };
    }
    return env.consumerSendProductionFlag === "live"
      ? { mode: "live", reason: "production_live_enabled", misconfigured: false }
      : { mode: "disabled", reason: "production_live_refused", misconfigured: true };
  }

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
