// app/portal/page.tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PortalRedirectPage() {
  const supabase = await createSupabaseServerClient();

  // getUser(), not getSession(): this page GATES access, and getSession()
  // decodes the cookie without revalidating the JWT. Upgraded during the
  // @supabase/ssr migration rather than ported as-was.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/portal");
  }

  // Fetch the user's role from the profiles table
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role;

  // The Smart Routing Logic
  if (role === "admin") {
    redirect("/admin");
  } else if (role === "driver") {
    redirect("/driver");
  } else {
    // Default fallback for standard customers or missing roles
    redirect("/dashboard");
  }
}
