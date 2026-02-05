import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Extract authenticated user from a NextRequest
 * Throws if missing / invalid
 */
export async function getUserFromRequest(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new Error("Missing authorization token");
  }

  const token = auth.replace("Bearer ", "");

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error("Invalid or expired token");
  }

  return data.user;
}

/**
 * Require admin role
 * Returns user if admin, otherwise throws
 */
export async function requireAdmin(req: NextRequest) {
  const user = await getUserFromRequest(req);

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || data?.role !== "admin") {
    throw new Error("Admin access required");
  }

  return user;
}