import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase admin client (bypasses RLS).
 * Lazily initialized so builds do not fail during module import
 * in environments where runtime env vars are not injected at build time.
 */

let cachedClient: SupabaseClient | null = null;

/**
 * Every request this client makes opts OUT of Next's Data Cache.
 *
 * Next patches global `fetch` in the App Router. With the default
 * `fetchCache: 'auto'` and `revalidate: false`, a GET discovered before a
 * dynamic function is cached INDEFINITELY — and `dynamic = 'force-dynamic'`
 * does not change that: it forces dynamic *rendering*, and the Next 14.2 docs
 * describe no effect on the Data Cache (unlike `dynamic = 'error'`, which
 * spells its fetch equivalences out).
 *
 * Every PostgREST read is a GET with its filters in the query string, so the
 * URL is stable per query and the cache key is stable with it. That is exactly
 * what happened: `/api/couranr/driver/assignment` kept answering
 * `assigned: null` from a response cached before the assignment existed, while
 * the identical query from plain Node returned the row. 121 entries had
 * accumulated in `.next/cache/fetch-cache`; deleting them fixed it. A payment
 * state or a delivery assignment served from an indefinite cache is a
 * correctness bug, not a performance tuning question.
 *
 * Fixed here rather than per route: this is the one place every service-role
 * read passes through, so a new route cannot forget it. Freshness for reads
 * that genuinely can be cached belongs at the call site, deliberately.
 */
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  cachedClient = createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false },
      global: { fetch: noStoreFetch },
    }
  );

  return cachedClient;
}

export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    return Reflect.get(client, prop, receiver);
  },
});