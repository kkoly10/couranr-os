import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Session refresh — the ONE thing this proxy does.
 *
 * Next 16 renamed middleware.ts to proxy.ts (Node runtime only, which this
 * always was in spirit — nothing here needs edge).
 *
 * Net-new with the @supabase/ssr migration (ACP-004): the app previously had
 * no middleware and therefore NO session-refresh path anywhere — an expired
 * access token stayed expired until a full page reload rebuilt it in the
 * browser. This follows the official pattern: build a request-scoped client,
 * call `auth.getUser()` (which refreshes an expired session and re-sets the
 * cookies on both the request and the response), and pass the response
 * through. (https://supabase.com/docs/guides/auth/server-side/nextjs)
 *
 * THIS IS NOT AUTHORIZATION. Every API route verifies its own caller and the
 * canonical tables grant `authenticated` nothing; a request that skips this
 * file entirely reaches the exact same gates. That is why the env guard below
 * may fail OPEN: with no configured Supabase there is no session to refresh,
 * and refusing all traffic would turn a config gap into an outage.
 *
 * `getUser()` rather than `getClaims()`, deliberately: this project signs
 * HS256 JWTs (legacy secret), which `getClaims()` cannot verify locally — it
 * degrades to the same network revalidation `getUser()` performs, and
 * `getUser()` is also what the disposable harness's /auth/v1 serves. Same
 * security property, one fewer moving part.
 *
 * The matcher EXCLUDES /api on purpose, deviating from the docs' default:
 * canonical API calls are same-origin fetches that carry the session cookies
 * automatically, so including them would add a network revalidation round
 * trip to every one of the 131 API routes — whose authorization is Bearer
 * tokens or their own cookie validation, not this refresh. Page navigations
 * keep the session fresh; the three legacy cookie-auth routes validate their
 * own cookies exactly as they did when no middleware existed.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refreshes an expired session as a side effect. The result is unused on
  // purpose — deciding anything from it here would make this authorization,
  // which it must not be.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except: API routes (Bearer/self-validated — see above),
     * Next internals and static assets, and common static files.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|txt|xml|json)$).*)",
  ],
};
