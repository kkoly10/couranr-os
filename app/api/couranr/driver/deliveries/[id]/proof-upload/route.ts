import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure } from "@/lib/couranr/driver/commands";
import { createProofUpload } from "@/lib/couranr/driver/proof";
import { PROOF_STAGES, type ProofStage } from "@/lib/couranr/driver/states";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_TOKEN = 200;

/**
 * POST — authorize one proof image and mint a signed upload for it.
 *
 * THE BROWSER NEVER CHOOSES WHERE ITS BYTES LAND. It names a stage and a type;
 * the server generates the proof id, the opaque filename and the object path,
 * records exactly what it will accept, and only then signs an upload for that
 * one path. Nothing in this body is a location.
 *
 * `expectedBytes` and `expectedMime` are a DECLARATION, not evidence. They
 * bound the authorization up front; at finalization the server reads the stored
 * object itself and compares, which is the only way a truncated upload — HTTP
 * 200 with a partial body — is ever caught.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const stage = typeof body?.stage === "string" ? body.stage.trim() : "";
  if (!(PROOF_STAGES as readonly string[]).includes(stage)) {
    return routeFailure("invalid_input", "That proof does not belong at this step.");
  }

  // Bounded here; which types are legal for this stage is the command's
  // allow-list, so there is one place that decides it.
  const proofType = typeof body?.proofType === "string" ? body.proofType.trim() : "";
  if (proofType.length === 0 || proofType.length > MAX_TOKEN) {
    return routeFailure("invalid_input", "That proof does not belong at this step.");
  }

  const expectedMime = typeof body?.expectedMime === "string" ? body.expectedMime.trim() : "";
  if (expectedMime.length === 0 || expectedMime.length > MAX_TOKEN) {
    return routeFailure("invalid_input", "That file type is not accepted.");
  }

  const expectedBytes = Number(body?.expectedBytes);
  if (!Number.isInteger(expectedBytes) || expectedBytes <= 0) {
    return routeFailure("invalid_input", "The file is empty.");
  }

  const r = await createProofUpload({
    userId: auth.userId,
    deliveryId: params.id,
    proofStage: stage as ProofStage,
    proofType,
    expectedMime,
    expectedBytes,
  });
  if (isDriverFailure(r)) return failureResponse(r);
  return NextResponse.json({ upload: r.value });
}
