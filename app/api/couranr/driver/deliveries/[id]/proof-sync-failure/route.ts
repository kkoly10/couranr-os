import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { isDriverFailure } from "@/lib/couranr/driver/commands";
import { reportProofSyncFailure } from "@/lib/couranr/driver/proof";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = new Set([
  "local_evidence_corrupt",
  "assignment_or_stage_changed",
  "server_rejected",
  "retry_limit",
]);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const actor = await resolveUserId(req);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  if (!UUID_RE.test(id)) return routeFailure("not_found", "Delivery not found.");

  let body: any;
  try { body = await req.json(); }
  catch { return routeFailure("invalid_input", "Expected a JSON body."); }

  const clientEvidenceId = String(body?.clientEvidenceId ?? "");
  const stage = String(body?.stage ?? "");
  const proofType = String(body?.proofType ?? "");
  const reason = String(body?.reason ?? "");
  const attempts = Number(body?.attempts);

  if (!UUID_RE.test(clientEvidenceId) || !["pickup","pickup_discrepancy","dropoff"].includes(stage)) {
    return routeFailure("invalid_input", "That offline proof could not be identified.");
  }
  if (!proofType || proofType.length > 200 || !REASONS.has(reason)) {
    return routeFailure("invalid_input", "That offline proof failure is not valid.");
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) {
    return routeFailure("invalid_input", "That retry count is not valid.");
  }

  const result = await reportProofSyncFailure({
    userId: actor.userId,
    deliveryId: id,
    clientEvidenceId,
    proofStage: stage,
    proofType,
    reason,
    attempts,
  });
  if (isDriverFailure(result)) return failureResponse(result);

  return NextResponse.json({ proofSyncFailure: result.value });
}
