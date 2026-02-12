// lib/getUserRole.ts
"use client";

import { supabase } from "@/lib/supabaseClient";

export type UserRole = "admin" | "driver" | "customer";

export async function getUserRole(): Promise<UserRole | null> {
  const { data: sessionRes } = await supabase.auth.getSession();
  const session = sessionRes.session;
  if (!session?.user?.id) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (error || !data?.role) return null;

  return data.role as UserRole;
}