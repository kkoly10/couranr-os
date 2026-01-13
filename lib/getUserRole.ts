import { supabase } from "@/lib/supabaseClient";

export async function getUserRole() {
  const { data: sessionRes } = await supabase.auth.getSession();
  const session = sessionRes.session;

  if (!session) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (error || !data) return null;

  return data.role as "admin" | "driver" | "customer";
}