"use client";

import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type UserRole = "admin" | "driver" | "customer";

export async function getUserRole(): Promise<UserRole | null> {
  const { data: sessionRes } = await supabaseBrowser.auth.getSession();
  const session = sessionRes.session;
  if (!session?.user?.id) return null;

  const { data, error } = await supabaseBrowser
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (error || !data?.role) return null;

  return data.role as UserRole;
}