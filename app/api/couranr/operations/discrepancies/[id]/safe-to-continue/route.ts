import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure, resolveSafePickupDiscrepancy } from "@/lib/couranr/driver/commands";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_NOTE = 1000;

/**
 * POST — Couranr Operations clears a pickup issue as safe to continue.
 *
 * The only way an open discrepancy ever closes, and the only reason it is
 * Operations-gated twice — once by the actor resolution here and once inside
 * the command. The driver who raised the issue is standing at a loading dock
 * under time pressure; deciding that a damaged or mismatched shipment is fine
 * to carry is not a decision to hand to the person waiting on it.
 *
 * There is no "target state" in this body. The route names ONE outcome, so the
 * only thing a caller chooses is whether to invoke it.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "That issue could not be found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A current issue version is required.");
  }

  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > MAX_NOTE) {
    return routeFailure("invalid_input", `Keep the note under ${MAX_NOTE} characters.`);
  }

  const r = await resolveSafePickupDiscrepancy({
    actor: actor.actor,
    discrepancyId: params.id,
    expectedVersion,
    note: note.length > 0 ? note : null,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ discrepancy: r.value });
}
