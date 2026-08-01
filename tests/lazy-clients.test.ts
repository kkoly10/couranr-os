import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the clean-environment build failure.
 *
 * `next build` collects page data by importing every route module. Any client
 * constructed at module scope reads its secret during that import, so a clean
 * clone could not build:
 *
 *     Error: Missing STRIPE_SECRET_KEY
 *     > Build error occurred
 *     Error: Failed to collect page data for /api/delivery/complete
 *
 * These tests assert the two halves of the fix:
 *   1. importing a client module with NO env set must not throw
 *   2. actually USING it without config must throw a clear, named error
 *
 * Green tests are not sufficient on their own here — `npm run build` in an
 * environment with no secrets is the real check — but this fails fast if
 * someone reintroduces a module-scope construction in these files.
 */

const SECRET_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of SECRET_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of SECRET_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("lazy client modules import cleanly without env vars", () => {
  it("lib/env exposes requireEnv that only throws when called", async () => {
    const { requireEnv, hasEnv, optionalEnv } = await import("@/lib/env");
    expect(hasEnv("STRIPE_SECRET_KEY")).toBe(false);
    expect(optionalEnv("STRIPE_SECRET_KEY")).toBeUndefined();
    expect(() => requireEnv("STRIPE_SECRET_KEY")).toThrow(
      "STRIPE_SECRET_KEY is required."
    );
  });

  it("never puts the value of a secret into the error message", () => {
    // The error names the variable, so a leaked message cannot disclose a key.
    process.env.STRIPE_SECRET_KEY = "sk_test_SHOULD_NEVER_APPEAR";
    return import("@/lib/env").then(({ requireEnv }) => {
      delete process.env.STRIPE_SECRET_KEY;
      try {
        requireEnv("STRIPE_SECRET_KEY");
        throw new Error("expected requireEnv to throw");
      } catch (e: any) {
        expect(e.message).not.toContain("SHOULD_NEVER_APPEAR");
        expect(e.message).toContain("STRIPE_SECRET_KEY");
      }
    });
  });

  it("importing lib/stripeClient does not throw", async () => {
    await expect(import("@/lib/stripeClient")).resolves.toBeDefined();
  });

  it("importing lib/stripe (compat path) does not throw", async () => {
    await expect(import("@/lib/stripe")).resolves.toBeDefined();
  });

  it("importing lib/supabaseAdmin does not throw", async () => {
    await expect(import("@/lib/supabaseAdmin")).resolves.toBeDefined();
  });

  it("importing lib/supabasePublic does not throw", async () => {
    await expect(import("@/lib/supabasePublic")).resolves.toBeDefined();
  });

  it("importing lib/auth does not throw", async () => {
    await expect(import("@/lib/auth")).resolves.toBeDefined();
  });

  it("pins the Stripe API version rather than floating with the SDK default", async () => {
    const { STRIPE_API_VERSION } = await import("@/lib/stripeClient");
    expect(STRIPE_API_VERSION).toBe("2024-04-10");
  });
});

describe("lazy clients fail clearly when actually used without config", () => {
  it("touching the Stripe proxy without STRIPE_SECRET_KEY throws a named error", async () => {
    const { stripe } = await import("@/lib/stripeClient");
    expect(() => (stripe as any).checkout).toThrow("STRIPE_SECRET_KEY is required.");
  });

  it("touching supabaseAdmin without a service-role key throws a named error", async () => {
    const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
    expect(() => (supabaseAdmin as any).from).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL is required."
    );
  });

  it("touching supabasePublic without an anon key throws a named error", async () => {
    const { supabasePublic } = await import("@/lib/supabasePublic");
    expect(() => (supabasePublic as any).from).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL is required."
    );
  });
});

/**
 * Next patches global `fetch` in the App Router. With the default
 * `fetchCache: 'auto'` and `revalidate: false` a GET can be cached
 * indefinitely, and `dynamic = 'force-dynamic'` does not change that — the
 * Next 14.2 docs describe it as forcing dynamic RENDERING and say nothing
 * about the Data Cache, unlike `dynamic = 'error'` which spells its fetch
 * equivalences out.
 *
 * `/api/couranr/driver/assignment` was observed answering `assigned: null`
 * from a response cached before the assignment existed: a dev-server restart
 * did not clear it and deleting `.next/cache/fetch-cache` (121 entries) did.
 * Every PostgREST read is a GET whose filters live in the query string, so the
 * cache key is stable per query — a delivery assignment or a payment state
 * served from an indefinite cache is a correctness bug.
 *
 * Asserted on the fetch CALL, not by grepping the source, so a refactor that
 * drops the option fails here rather than in production.
 */
describe("service-role traffic never enters Next's Data Cache", () => {
  async function captureCalls(use: (client: any) => Promise<unknown>) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-not-a-real-secret";

    const calls: Array<{ url: string; init: any }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any) => {
      calls.push({ url: String(input?.url ?? input), init });
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as any;

    try {
      vi.resetModules();
      const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
      // The stub response is deliberately not a valid payload for every API;
      // what is under test is the request that went out, not the parse.
      try {
        await use(supabaseAdmin);
      } catch {
        /* ignored on purpose — see above */
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    return calls;
  }

  it("sends cache: 'no-store' on a PostgREST read", async () => {
    const calls = await captureCalls((c) => c.from("couranr_drivers").select("id"));
    expect(calls.length, "no request was made — the assertion would be vacuous").toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.init?.cache, `${c.url} was not sent with cache: no-store`).toBe("no-store");
    }
  });

  /**
   * The token check matters most. `resolveRequestActor` and `resolveUserId`
   * both verify the caller's JWT with `auth.getUser(token)`; a cached response
   * there would keep authenticating a token after it was revoked.
   */
  it("sends cache: 'no-store' on the auth token check too", async () => {
    const calls = await captureCalls((c) => c.auth.getUser("a.fake.jwt"));
    expect(calls.length, "no request was made — the assertion would be vacuous").toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.init?.cache, `${c.url} was not sent with cache: no-store`).toBe("no-store");
    }
  });
});
