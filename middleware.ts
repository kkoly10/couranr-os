import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

function redirectToDashboard(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/dashboard";
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const { data: sessionRes } = await supabase.auth.getSession();
  const session = sessionRes.session;

  const pathname = req.nextUrl.pathname;

  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/driver");

  if (!isProtected) return res;

  // Must be logged in
  if (!session?.user) return redirectToLogin(req);

  // Role from user_metadata (set during signUp)
  // NOTE: existing users might not have this; you can handle fallback later.
  const role =
    (session.user.user_metadata?.role as "admin" | "driver" | "customer" | undefined) ??
    "customer";

  // ADMIN AREA
  if (pathname.startsWith("/admin")) {
    if (role !== "admin") return redirectToDashboard(req);
    return res;
  }

  // DRIVER AREA
  if (pathname.startsWith("/driver")) {
    // Option A: only drivers
    if (role !== "driver" && role !== "admin") return redirectToDashboard(req);
    return res;
  }

  // DASHBOARD AREA: any logged-in user allowed
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/driver/:path*"],
};