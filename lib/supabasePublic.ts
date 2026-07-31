import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Anon-key Supabase client for SERVER-side reads of deliberately public data.
 *
 * Lazily initialized for the same reason as `lib/supabaseAdmin.ts`: constructing
 * it at module scope makes `next build`'s page-data collection fail whenever
 * env vars are absent.
 *
 * This carries the anon key and therefore no elevated privilege — every read is
 * still subject to RLS. Use it only where anonymous access is intended (the
 * public vehicle listing). For anything user-scoped, resolve the caller and use
 * a request-scoped client; for privileged server work use `supabaseAdmin`.
 */

let cached: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")),
    { auth: { persistSession: false } }
  );
  return cached;
}

export const supabasePublic: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
