import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
