import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseBusinessAccountId(raw: any): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  return UUID_RE.test(v) ? v : null;
}

export async function ensureBusinessAccess(
  supabase: SupabaseClient,
  userId: string,
  businessAccountId: string
) {
  const { data, error } = await supabase
    .from("business_members")
    .select("business_account_id,status")
    .eq("business_account_id", businessAccountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!error && data && data.status === "active") {
    return { ok: true as const };
  }

  const msg = error?.message || "";
  if (/relation .*business_members.* does not exist/i.test(msg)) {
    return {
      ok: false as const,
      code: 400,
      error: "Business schema is not installed yet. Run the business migration first.",
    };
  }

  if (error) {
    return { ok: false as const, code: 500, error: error.message || "Failed business membership lookup" };
  }

  return { ok: false as const, code: 403, error: "You do not have access to this business account." };
}
