import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { getDeliveryRequest, isCommandFailure } from "@/lib/couranr/requests/commands";
import { canActOnDeliveryRequest } from "@/lib/couranr/requests/permissions";
import { isTrackingFailure, issueTrackingLink } from "@/lib/couranr/tracking/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BODY_KEYS = new Set(["businessAccountId"]);

/**
 * Mint a recipient tracking link for an ordinary merchant-owned request.
 *
 * Direct Consumer /send and Consumer-owned hosted requests already issue their
 * own one-delivery credential from their guest session. This route deliberately
 * refuses hosted requests so a merchant click can never revoke the customer\'s
 * already-issued hosted token.
 *
 * The browser chooses no request state, delivery id, audience, expiry or token.
 * The raw token is generated server-side and returned once; only its SHA-256
 * hash is stored by the tracking command.
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  if (!UUID_RE.test(id)) {
    return routeFailure("not_found", "Delivery request not found.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return routeFailure("invalid_input", "A business account is required.");
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !BODY_KEYS.has(key))) {
    return routeFailure("invalid_input", "This tracking request contains an unsupported field.");
  }

  const businessAccountId = String(record.businessAccountId ?? "");
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const actor = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  // Prove direct ownership or the hosted relationship before any credential mutation.
  // A cross-tenant request remains indistinguishable from a missing one.
  const loaded = await getDeliveryRequest({
    actor: actor.actor,
    businessAccountId,
    requestId: id,
  });
  if (isCommandFailure(loaded)) return failureResponse(loaded);

  // Tracking-link issuance is a write capability: viewer/billing may read the
  // delivery but may not mint a recipient credential.
  const permission = canActOnDeliveryRequest(actor.actor, "submit", businessAccountId);
  if (!permission.allowed) {
    return routeFailure("not_permitted", "Your role cannot create tracking links.");
  }

  const request = loaded.value.request;

  // Hosted Consumer requests own their credential through the opaque hosted
  // session. Issuing here would revoke that token and strand the customer.
  if (request.source === "hosted_request" || request.business_account_id !== businessAccountId) {
    return routeFailure(
      "conflict",
      "This customer request manages its tracking link through the original secure request."
    );
  }

  if (request.request_state !== "confirmed") {
    return routeFailure(
      "conflict",
      "Tracking becomes available after Couranr confirms the delivery."
    );
  }

  const issued = await issueTrackingLink({ requestId: id });
  if (isTrackingFailure(issued)) return failureResponse(issued);

  return NextResponse.json({
    token: issued.value.token,
    expiresAt: issued.value.expiresAt,
  });
}
