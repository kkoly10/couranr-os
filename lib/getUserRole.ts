import { supabase } from "@/lib/supabaseClient";

export async function getUserRole() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;

  const role = user.user_metadata?.role;
  if (role === "admin" || role === "driver" || role === "customer") return role;

  // Default safe fallback
  return "customer";
}