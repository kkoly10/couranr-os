import { NextRequest } from "next/server";
import { isWellFormedTrackingToken } from "@/lib/couranr/tracking/tokens";
import { redeemTrackingLink, isTrackingFailure } from "@/lib/couranr/tracking/commands";
import { handleFeedbackRequest } from "@/lib/couranr/driver/feedbackRoutes";
import { routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";
const refused = () => routeFailure("not_found", "Feedback is unavailable for this delivery.");

async function handle(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isWellFormedTrackingToken(token)) return refused();
  const link = await redeemTrackingLink({ rawToken: token });
  if (isTrackingFailure(link) || !link.value.valid || !link.value.delivery_id) return refused();
  return handleFeedbackRequest(req, link.value.delivery_id, { audience: "recipient", rawToken: token });
}
export const GET = handle;
export const POST = handle;
