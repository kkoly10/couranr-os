import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/** Operations-only business selector for assisted delivery entry. */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const { data, error } = await supabaseAdmin
    .from("business_accounts")
    .select("id,name,slug,status")
    .eq("status", "active")
    .order("name", { ascending: true });

  if (error) {
    return routeInternalFailure({
      operation: "operationsBusinesses:list",
      detail: error,
      message: "Could not load active businesses.",
    });
  }

  return NextResponse.json({
    businessAccounts: (data ?? []).map((row: any) => ({
      businessAccountId: String(row.id),
      name: String(row.name ?? "Business"),
      slug: typeof row.slug === "string" ? row.slug : null,
      role: "operations",
    })),
  });
}
