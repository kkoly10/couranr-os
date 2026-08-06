import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.generated";

/**
 * Request-scoped Supabase client for SERVER contexts that authenticate with
 * the session COOKIE — server components, route handlers, server actions.
 *
 * This is the @supabase/ssr replacement for auth-helpers'
 * `createServerComponentClient` / `createRouteHandlerClient` (ACP-004).
 *
 * WRITTEN ASYNC ON PURPOSE. Next 14's `cookies()` is synchronous; awaiting a
 * non-promise is a no-op, and Next 15 makes `cookies()` a Promise — so this
 * factory is already in the 15+ shape and the framework migration does not
 * touch it. (https://supabase.com/docs/guides/auth/server-side/nextjs)
 *
 * The cookie adapter uses the `getAll`/`setAll` shape ONLY. The older
 * `{get,set,remove}` shape still type-checks through a deprecated overload and
 * misbehaves with chunked cookies — never introduce it.
 *
 * AUTHORIZATION NOTE, unchanged from the auth-helpers era: this client
 * authenticates as the COOKIE'S user. Gate with `auth.getUser()` — never
 * `getSession()`, which decodes without revalidating. Most canonical routes
 * do not use this at all; they take Bearer tokens through
 * `lib/couranr/requests/actor.ts`.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, where the cookie store is
            // read-only. Safe to ignore: middleware.ts refreshes sessions.
          }
        },
      },
    }
  );
}
