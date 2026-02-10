import { supabase } from "@/lib/supabaseClient";

export async function getUserRole(): Promise<"admin" | "driver" | "customer" | null> {
  const { data: sessionRes } = await supabase.auth.getSession();
  const session = sessionRes.session;
  if (!session) return null;

  // If this user matches ADMIN_EMAIL, treat as admin even if profiles isn't ready
  // (NOTE: client-side env needs NEXT_PUBLIC_ prefix to be readable.
  // So we do NOT rely on it here. Middleware handles the real gate.)
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (error || !data?.role) return "customer";
  return data.role as "admin" | "driver" | "customer";
}