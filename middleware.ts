import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/admin", "/dashboard", "/driver"];

/**
 * Tries to detect "logged in" using common auth cookies:
 * - NextAuth: next-auth.session-token / __Secure-next-auth.session-token
 * - Supabase: sb-access-token / sb-refresh-token / supabase-auth-token (varies by setup)
 * - Custom fallback: couranr_session / couranr_admin
 *
 * If your auth uses a different cookie name, add it here.
 */
function isAuthed(req: NextRequest) {
  const c = req.cookies;

  return Boolean(
    c.get("next-auth.session-token")?.value ||
      c.get("__Secure-next-auth.session-token")?.value ||
      c.get("sb-access-token")?.value ||
      c.get("sb-refresh-token")?.value ||
      c.get("supabase-auth-token")?.value ||
      c.get("couranr_session")?.value ||
      c.get("couranr_admin")?.value
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Ignore Next internals & static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots") ||
    pathname.startsWith("/sitemap") ||
    pathname.match(/\.(.*)$/)
  ) {
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // Allow auth pages
  if (pathname.startsWith("/login") || pathname.startsWith("/signup")) {
    return NextResponse.next();
  }

  if (!isAuthed(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*", "/driver/:path*"],
};
