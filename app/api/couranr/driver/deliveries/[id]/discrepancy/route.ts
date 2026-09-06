import { NextRequest, NextResponse } from "next/server";
import {
  isDriverFailure,
  reportDropoffException,
  reportPickupDiscrepancy,
} from "@/lib/couranr/driver/commands";
import { DISCREPANCY_REASONS, DROPOFF_EXCEPTION_EXTRA_REASONS } from "@/lib/couranr/driver/states";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_NOTES = 1000;

/**
 * POST — the driver reports something wrong with the shipment.
 *
 * Two explicit stages, chosen by the body's `stage` field (default 'pickup'):
 *
 *   'pickup'  → couranr_report_pickup_discrepancy. SQL-gated to at_pickup;
 *               blocks complete_pickup while open.
 *   'dropoff' → couranr_report_dropoff_exception (§31). SQL-gated to
 *               picked_up / in_transit / at_dropoff; evidence only — it gates
 *               nothing for the driver, but it is one of the two halves
 *               Operations needs before a custody delivery can be closed
 *               undeliverable (review item 4).
 *
 * Raising an issue is all a driver can do with it. Nothing here clears one:
 * `discrepancy_state` moves only through the Operations-gated
 * safe-to-continue command. That asymmetry is the point — the person under
 * time pressure at a door is not the person who decides the shipment is fine.
 *
 * The reason is one of a closed set, checked here so an unknown value cannot
 * reach a text column and become an unqueryable category of its own; the
 * drop-off stage additionally accepts the two drop-off realities the pickup
 * vocabulary has no word for.
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

  const stage = body?.stage === "dropoff" ? "dropoff" : "pickup";

  const allowedReasons: readonly string[] =
    stage === "dropoff"
      ? [...DISCREPANCY_REASONS, ...DROPOFF_EXCEPTION_EXTRA_REASONS]
      : DISCREPANCY_REASONS;

  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!allowedReasons.includes(reason)) {
    return routeFailure(
      "invalid_input",
      stage === "dropoff"
        ? "Choose what is wrong with this delivery."
        : "Choose what is wrong with this pickup."
    );
  }

  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  if (notes.length > MAX_NOTES) {
    return routeFailure("invalid_input", `Keep the notes under ${MAX_NOTES} characters.`);
  }

  const latitude = typeof body?.latitude === "number" ? body.latitude : Number.NaN;
  const longitude = typeof body?.longitude === "number" ? body.longitude : Number.NaN;
  const accuracyM =
    body?.accuracyM === null || body?.accuracyM === undefined
      ? null
      : typeof body.accuracyM === "number"
        ? body.accuracyM
        : Number.NaN;
  if (
    stage === "dropoff" &&
    (!Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      (accuracyM !== null && (!Number.isFinite(accuracyM) || accuracyM < 0)))
  ) {
    return routeFailure(
      "invalid_input",
      "Couranr needs the location where you stopped to report this delivery issue."
    );
  }

  const r =
    stage === "dropoff"
      ? await reportDropoffException({
          userId: auth.userId,
          deliveryId: params.id,
          reason,
          notes: notes.length > 0 ? notes : null,
          latitude,
          longitude,
          accuracyM,
        })
      : await reportPickupDiscrepancy({
          userId: auth.userId,
          deliveryId: params.id,
          reason,
          notes: notes.length > 0 ? notes : null,
        });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ discrepancy: r.value });
}
