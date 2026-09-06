import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure } from "@/lib/couranr/driver/commands";
import { createProofUpload, prepareProofUploadV2 } from "@/lib/couranr/driver/proof";
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

  /*
   * Rolling-deploy compatibility: an old browser bundle has no evidence UUID
   * and continues down the legacy path. New bundles opt into V2 and bind the
   * immutable capture envelope before any upload URL is minted.
   */
  const clientEvidenceId =
    typeof body?.clientEvidenceId === "string" ? body.clientEvidenceId.trim() : "";
  if (!clientEvidenceId) {
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

  if (!UUID_RE.test(clientEvidenceId)) {
    return routeFailure("invalid_input", "That offline proof identity is not valid.");
  }
  const evidenceSha256 =
    typeof body?.evidenceSha256 === "string" ? body.evidenceSha256.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(evidenceSha256)) {
    return routeFailure("invalid_input", "That offline proof digest is not valid.");
  }
  const capturedAt = typeof body?.capturedAt === "string" ? body.capturedAt.trim() : "";
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    return routeFailure("invalid_input", "That proof capture time is not valid.");
  }

  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return routeFailure("invalid_input", "Couranr needs the capture location for offline proof.");
  }
  const accuracyM =
    body?.accuracyM === null || body?.accuracyM === undefined ? null : Number(body.accuracyM);
  if (accuracyM !== null && (!Number.isFinite(accuracyM) || accuracyM < 0)) {
    return routeFailure("invalid_input", "That location accuracy is not valid.");
  }
  const discrepancyId =
    body?.discrepancyId === null || body?.discrepancyId === undefined
      ? null
      : String(body.discrepancyId);
  if (discrepancyId !== null && !UUID_RE.test(discrepancyId)) {
    return routeFailure("invalid_input", "That discrepancy is not valid.");
  }

  const r = await prepareProofUploadV2({
    userId: auth.userId,
    deliveryId: params.id,
    proofStage: stage as ProofStage,
    proofType,
    expectedMime,
    expectedBytes,
    clientEvidenceId,
    evidenceSha256,
    capturedAt,
    latitude,
    longitude,
    accuracyM,
    discrepancyId,
  });
  if (isDriverFailure(r)) return failureResponse(r);

  return NextResponse.json({
    upload:
      r.value.status === "verified"
        ? { status: "verified", proof: r.value.proof }
        : { status: "upload", ...r.value.upload },
  });
}
