import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  calculateDeliveryRequestEstimate,
  isCommandFailure,
} from "@/lib/couranr/requests/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery request not found.");

  const resolved = await resolveRequestActor(req, null);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const businessAccountId = String(body?.businessAccountId ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "Choose an active business.");
  }
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A request version is required.");
  }

  const raw =
    body?.request && typeof body.request === "object" && !Array.isArray(body.request)
      ? { ...body.request, source: "operations" }
      : body?.request;

  const result = await calculateDeliveryRequestEstimate({
    actor: resolved.actor,
    businessAccountId,
    requestId: params.id,
    expectedVersion,
    rawInput: raw,
    intakeSessionId: null,
    writeAuthority: "operations",
  });
  if (isCommandFailure(result)) return failureResponse(result);
  return NextResponse.json({ request: toDeliveryRequestView(result.value.request) });
}
