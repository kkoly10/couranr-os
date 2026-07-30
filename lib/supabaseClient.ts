// lib/supabaseClient.ts
"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

/**
 * Browser (cookie-session) Supabase client.
 *
 * Lazily initialized behind a Proxy, for the same reason as
 * `lib/supabaseAdmin.ts`. `createClientComponentClient()` throws
 *
 *     either NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY env
 *     variables or supabaseUrl and supabaseKey are required!
 *
 * when those vars are absent. This module is imported by 51 files, so
 * constructing at module scope meant every prerendered page that transitively
 * imported it failed `next build` in an environment without env vars.
 *
 * The Proxy keeps the import side-effect free; the client is built on first
 * property access, which in practice is inside a component or an event handler
 * in the browser, where NEXT_PUBLIC_* values have been inlined at build time.
 *
 * NOTE: this is the BROWSER client and carries no JWT when imported from a
 * server context — it authenticates as `anon`. Do not import it into a route
 * handler or a server component; use `lib/supabaseAdmin.ts` (service role) or a
 * request-scoped client instead.
 */

type BrowserClient = ReturnType<typeof createClientComponentClient>;

let cached: BrowserClient | null = null;

function getClient(): BrowserClient {
  if (!cached) cached = createClientComponentClient();
  return cached;
}

export const supabase: BrowserClient = new Proxy({} as BrowserClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
