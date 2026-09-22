import { NextRequest } from "next/server";
import { resolveRequestActor, isActorDenied } from "@/lib/couranr/requests/actor";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { handleFeedbackRequest } from "@/lib/couranr/driver/feedbackRoutes";
import { routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";
const refused = () => routeFailure("not_found", "Feedback is unavailable for this delivery.");

async function handle(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId");
  if (!businessAccountId) return refused();
  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor) || actor.actor.kind !== "member") return refused();
  const { data: request, error } = await supabaseAdmin.from("couranr_delivery_requests")
    .select("business_account_id").eq("id", id).maybeSingle();
  if (error || request?.business_account_id !== businessAccountId) return refused();
  const delivery = await supabaseAdmin.from("couranr_deliveries")
    .select("id").eq("request_id", id).maybeSingle();
  if (delivery.error || !delivery.data?.id) return refused();
  return handleFeedbackRequest(req, String(delivery.data.id), {
    audience: "merchant", actorUserId: actor.userId,
  });
}
export const GET = handle;
export const POST = handle;
