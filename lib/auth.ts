import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Extracts and validates the user session from Authorization header.
 */
export async function requireUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new Error("Missing Authorization header");
  }

  const token = auth.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("Invalid or expired token");
  }

  return data.user;
}

/**
 * Ensures the authenticated user is an admin.
 */
export async function requireAdmin(req: NextRequest) {
  const user = await requireUser(req);

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