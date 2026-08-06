import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, reportPickupDiscrepancy } from "@/lib/couranr/driver/commands";
import { DISCREPANCY_REASONS } from "@/lib/couranr/driver/states";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_NOTES = 1000;

/**
 * POST — the driver reports something wrong at pickup.
 *
 * Raising an issue is all a driver can do with it. Nothing here clears one:
 * `discrepancy_state` moves only through the Operations-gated
 * safe-to-continue command, and while an issue is open the SQL refuses to
 * complete pickup at all. That asymmetry is the point — the person under
 * time pressure at a loading dock is not the person who decides the shipment
 * is fine to carry.
 *
 * The reason is one of a closed set, checked here so an unknown value cannot
 * reach a text column and become an unqueryable category of its own.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!(DISCREPANCY_REASONS as readonly string[]).includes(reason)) {
    return routeFailure("invalid_input", "Choose what is wrong with this pickup.");
  }

  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  if (notes.length > MAX_NOTES) {
    return routeFailure("invalid_input", `Keep the notes under ${MAX_NOTES} characters.`);
  }

  const r = await reportPickupDiscrepancy({
    userId: auth.userId,
    deliveryId: params.id,
    reason,
    notes: notes.length > 0 ? notes : null,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ discrepancy: r.value });
}
