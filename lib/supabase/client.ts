"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.generated";

/**
 * THE browser Supabase client — @supabase/ssr's `createBrowserClient`, which
 * stores the session in COOKIES so the server half of the app can see it.
 *
 * This replaced `@supabase/auth-helpers-nextjs`'s
 * `createClientComponentClient` on 2026-08-06 (ACP-004). Two consequences,
 * both deliberate and stated:
 *
 *  1. SESSIONS DO NOT CARRY OVER. auth-helpers 0.10 wrote a compressed-array
 *     cookie format; @supabase/ssr 0.12 writes `base64-` + base64url(JSON) and
 *     has no parser for the old shape — source-verified, since no primary doc
 *     states it either way. Every signed-in user is signed out at the deploy
 *     that ships this and must sign in again. The stale chunks ARE cleaned up
 *     by ssr's removal path.
 *  2. Session refresh now happens in `middleware.ts`, which did not exist
 *     before. The middleware is NOT authorization — every route still verifies
 *     its own caller — it only keeps the cookie fresh.
 *
 * Lazily initialized behind a Proxy for the same reason as
 * `lib/supabaseAdmin.ts`: this module is imported by ~50 files, and a
 * module-scope constructor that throws without env vars used to fail
 * `next build` during page-data collection.
 *
 * Typed with the GENERATED Database. Legacy importers receive it widened back
 * to an untyped client through `lib/supabaseClient.ts`, because several legacy
 * queries name tables the live database does not have (`business_pricing_profiles`)
 * and typing them would fail the build before B12 quarantines them. Canonical
 * code should import from HERE and get the typed client.
 */

export type TypedSupabaseClient = SupabaseClient<Database>;

let cached: TypedSupabaseClient | null = null;

function getClient(): TypedSupabaseClient {
  if (!cached) {
    cached = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return cached;
}

export const supabase: TypedSupabaseClient = new Proxy({} as TypedSupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
