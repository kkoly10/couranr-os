// lib/getUserRole.ts
"use client";

import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type UserRole = "admin" | "driver" | "customer";

export async function getUserRole(): Promise<UserRole> {
  const { data: sessionRes } = await supabaseBrowser.auth.getSession();
  const session = sessionRes.session;
  if (!session?.user?.id) return "customer";

  const { data, error } = await supabaseBrowser
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  // If profile row doesn't exist yet, treat as customer
  // Supabase commonly returns PGRST116 for 0 rows with .single()
  if (error) return "customer";
  if (!data?.role) return "customer";

  return data.role as UserRole;
}