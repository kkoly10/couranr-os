import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  createDeliveryRequestDraft,
  isCommandFailure,
} from "@/lib/couranr/requests/commands";
import {
  failureResponse,
  routeFailure,
  routeInternalFailure,
} from "@/lib/couranr/requests/respond";
import { toDeliveryRequestView } from "@/lib/couranr/requests/view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readIdempotencyKey(req: NextRequest, body: any): string | null {
  const raw = req.headers.get("idempotency-key") || body?.idempotencyKey;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (key.length < 8 || key.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(key) ? key : null;
}

export async function POST(req: NextRequest) {
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

  const { data: business, error: businessError } = await supabaseAdmin
    .from("business_accounts")
    .select("id,status")
    .eq("id", businessAccountId)
    .maybeSingle();

  if (businessError) {
    return routeInternalFailure({
      operation: "operationsAssistedCreate:business",
      detail: businessError,
    });
  }
  if (!business || business.status !== "active") {
    return routeFailure("not_found", "That business is not available for delivery entry.");
  }

  const idempotencyKey = readIdempotencyKey(req, body);
  if (!idempotencyKey) {
    return routeFailure("invalid_input", "An Idempotency-Key header is required.");
  }

  const raw =
    body?.request && typeof body.request === "object" && !Array.isArray(body.request)
      ? { ...body.request, source: "operations" }
      : body?.request;

  const result = await createDeliveryRequestDraft({
    actor: resolved.actor,
    businessAccountId,
    rawInput: raw,
    idempotencyKey,
    intakeSessionId: null,
    writeAuthority: "operations",
  });
  if (isCommandFailure(result)) return failureResponse(result);

  return NextResponse.json(
    { request: toDeliveryRequestView(result.value.request) },
    { status: 201 }
  );
}
