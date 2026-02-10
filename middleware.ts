import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const pathname = req.nextUrl.pathname;

  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/driver");

  if (!isProtected) return res;

  // Not logged in → send to login
  if (!session?.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // ---------------------------
  // ROLE GATING (profiles.role)
  // ---------------------------
  // If profiles table doesn't exist yet or role missing, default to "customer".
  let role: "admin" | "driver" | "customer" = "customer";

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (!error && data?.role) {
      role = data.role as any;
    } else {
      // fallback: allow admin by env email even if profiles isn't ready
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail && session.user.email === adminEmail) role = "admin";
    }
  } catch {
    // fallback: allow admin by env email even if query fails
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail && session.user.email === adminEmail) role = "admin";
  }

  // Admin area: admin only
  if (pathname.startsWith("/admin") && role !== "admin") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Driver area: driver OR admin
  if (pathname.startsWith("/driver") && role !== "driver" && role !== "admin") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/driver/:path*"],
};