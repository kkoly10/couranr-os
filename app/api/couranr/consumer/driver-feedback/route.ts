import { NextRequest } from "next/server";
import { redeemGuestSessionToken, isConsumerFailure } from "@/lib/couranr/consumer/send";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { handleFeedbackRequest } from "@/lib/couranr/driver/feedbackRoutes";
import { routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";
const refused = () => routeFailure("not_found", "Feedback is unavailable for this delivery.");

async function handle(req: NextRequest) {
  const session = await redeemGuestSessionToken(req);
  if (isConsumerFailure(session) || !session.value.requestId) return refused();
  const { data, error } = await supabaseAdmin.from("couranr_deliveries")
    .select("id").eq("request_id", session.value.requestId).maybeSingle();
  if (error || !data?.id) return refused();
  return handleFeedbackRequest(req, String(data.id), {
    audience: "sender", guestSessionId: session.value.id,
  });
}
export const GET = handle;
export const POST = handle;
