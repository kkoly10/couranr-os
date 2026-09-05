import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getHostedMerchantContext, isHostedFailure } from "@/lib/couranr/hosted/commands";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GET — MER-007 delivery detail. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) {
    return routeFailure("not_found", "Delivery request not found.");
  }

  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId");
  if (businessAccountId !== null && !UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId,
    requestId: params.id,
  });
  if (isCommandFailure(result)) return failureResponse(result);

  /* P5-001 evidence for whoever may already see this request (the actor
     check above is the authority; the session is keyed to the request the
     actor was just allowed to read). Ops uses it to see what Couranr
     understood, what was confirmed, and what the model merely worried about
     — as the different things they are. */
  let intake: Record<string, unknown> | null = null;
  const { data: session } = await supabaseAdmin
    .from("couranr_intake_sessions")
    .select(
      "id, current_revision, interpretation_status, current_clarification, policy_disposition, policy_reasons, policy_risk_signals, policy_unresolved, policy_version, operational_capability, fact_schema_version"
    )
    .eq("request_id", params.id)
    .maybeSingle();
  if (session) {
    const [{ data: facts }, { data: revisions }] = await Promise.all([
      supabaseAdmin
        .from("couranr_intake_facts")
        .select("fact_key, value, confidence, source, source_evidence, authority, revision, updated_at")
        .eq("session_id", session.id)
        .order("fact_key"),
      supabaseAdmin
        .from("couranr_intake_description_revisions")
        .select("revision, raw_description, source, created_at")
        .eq("session_id", session.id)
        .order("revision"),
    ]);
    intake = { session, facts: facts ?? [], revisions: revisions ?? [] };
  }

  let hostedContext: Record<string, unknown> | null = null;
  if (
    result.value.request.source === "hosted_request" &&
    businessAccountId !== null
  ) {
    const hosted = await getHostedMerchantContext({
      requestId: params.id,
      hostBusinessAccountId: businessAccountId,
    });
    if (isHostedFailure(hosted)) return failureResponse(hosted);
    hostedContext = hosted.value as Record<string, unknown> | null;
  }

  return NextResponse.json({
    request: toDeliveryRequestView(result.value.request),
    events: result.value.events,
    intake,
    hostedContext,
  });
}
