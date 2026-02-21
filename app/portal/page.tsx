// app/portal/page.tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";

export const dynamic = "force-dynamic";

export default async function PortalRedirectPage() {
  const supabase = createServerComponentClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login?next=/portal");
  }

  // Fetch the user's role from the profiles table
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
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
