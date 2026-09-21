import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { isDriverFailure, listProofMetadata } from "@/lib/couranr/driver/proof";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Operations proof metadata is delivery-scoped, never merchant-tenancy scoped. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  if (actor.actor.kind !== "operations") return routeFailure("not_permitted", "Operations access required.");

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return routeFailure("not_found", "Delivery not found.");
  const { data, error } = await supabaseAdmin
    .from("couranr_deliveries")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) return routeFailure("internal", "Delivery could not be loaded.");
  if (!data) return routeFailure("not_found", "Delivery not found.");

  const proof = await listProofMetadata(id);
  if (isDriverFailure(proof)) return failureResponse(proof);
  return NextResponse.json({ proof: proof.value });
}
