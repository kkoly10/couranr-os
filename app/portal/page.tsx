// app/portal/page.tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";

const ADMIN_PATH = "/admin"; // change to "/admin/courier" if that's your real admin landing
const CUSTOMER_PATH = "/dashboard";

export const dynamic = "force-dynamic";

export default async function PortalRedirectPage() {
  const supabase = createServerComponentClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login?next=/portal");
  }

  // Try to read role from profiles
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  const role = profile?.role;

  if (role === "admin") {
    redirect(ADMIN_PATH);
  }

  redirect(CUSTOMER_PATH);
}