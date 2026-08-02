import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { generateUploadNonce } from "./codes";
import { driverFail, isDriverFailure, type DriverResult } from "./commands";
import {
  MAX_PROOF_BYTES,
  PROOF_BUCKET,
  PROOF_URL_TTL_SECONDS,
  buildProofObjectPath,
  isAllowedProofMime,
  isCanonicalProofPath,
  type ProofViewer,
} from "./proofPaths";
import type { ProofStage } from "./states";

assertServerOnly("lib/couranr/driver/proof.ts");

/**
 * Proof upload, finalization and authorized reads.
 *
 * THE BROWSER NEVER CHOOSES WHERE ITS BYTES LAND. Initiation generates the
 * proof id and a random opaque filename here, records the exact path, MIME and
 * byte count it will accept, and mints a signed upload for that path alone.
 *
 * AT FINALIZATION, STORAGE IS THE AUTHORITY. Nothing the browser says about
 * the object is believed — not its size, not its type, not that it exists.
 * The server lists the object and reads the metadata itself. That is the only
 * way the truncation case can be caught: an upload can return HTTP 200 with a
 * partial body, and a client reporting its own intended size would confirm a
 * file that is not there.
 */

const PROOF_TYPES_BY_STAGE: Record<ProofStage, readonly string[]> = {
  pickup: ["shipment_photo", "condition_photo", "securement_photo"],
  pickup_discrepancy: ["discrepancy_evidence"],
  dropoff: ["delivery_photo", "signature"],
};

export type ProofUploadTicket = {
  uploadId: string;
  /** Where to PUT the bytes. Short-lived, never persisted, never logged. */
  signedUrl: string;
  token: string;
  expectedBytes: number;
  expectedMime: string;
  expiresInSeconds: number;
};

/**
 * §4 — initiation.
 *
 * Every refusal here happens BEFORE a signed URL exists, so an invalid request
 * never gets upload capability at all.
 */
export async function createProofUpload(p: {
  userId: string;
  deliveryId: string;
  proofStage: ProofStage;
  proofType: string;
  expectedMime: string;
  expectedBytes: number;
}): Promise<DriverResult<ProofUploadTicket>> {
  const operation = "createProofUpload";

  if (!isAllowedProofMime(p.expectedMime)) {
    return driverFail({
      operation,
      code: "invalid_input",
      detail: { reason: "mime_not_allowed", mime: p.expectedMime },
      message: "That file type is not accepted.",
    });
  }
  if (!Number.isInteger(p.expectedBytes) || p.expectedBytes <= 0) {
    return driverFail({
      operation,
      code: "invalid_input",
      detail: { reason: "bytes_not_positive" },
      message: "The file is empty.",
    });
  }
  if (p.expectedBytes > MAX_PROOF_BYTES) {
    return driverFail({
      operation,
      code: "invalid_input",
      detail: { reason: "bytes_too_large", bytes: p.expectedBytes },
      message: "That image is too large.",
    });
  }
  if (!(PROOF_TYPES_BY_STAGE[p.proofStage] ?? []).includes(p.proofType)) {
    return driverFail({
      operation,
      code: "invalid_input",
      detail: { reason: "proof_type_not_valid_for_stage", stage: p.proofStage, type: p.proofType },
      message: "That proof does not belong at this step.",
    });
  }

  // Server-generated, both of them. `buildProofObjectPath` adds 32 hex
  // characters of entropy, so the path carries nothing about the shipment.
  const proofId = randomUUID();
  let objectPath: string;
  try {
    objectPath = buildProofObjectPath({
      deliveryId: p.deliveryId,
      proofId,
      mimeType: p.expectedMime,
    });
  } catch {
    return driverFail({ operation, code: "invalid_input", detail: { reason: "path_build_failed" } });
  }

  // The row is written BEFORE the signed URL is minted. If minting fails there
  // is an unused authorization, which expires harmlessly; the reverse order
  // would hand out upload capability with nothing recording what it may write.
  const { data, error } = (await supabaseAdmin.rpc("couranr_create_proof_upload", {
    p_delivery_id: p.deliveryId,
    p_actor_user_id: p.userId,
    p_proof_stage: p.proofStage,
    p_proof_type: p.proofType,
    p_storage_bucket: PROOF_BUCKET,
    p_object_path: objectPath,
    p_expected_mime: p.expectedMime,
    p_expected_bytes: p.expectedBytes,
    p_upload_nonce: generateUploadNonce(),
    p_ttl_minutes: 15,
  })) as { data: any; error: any };

  if (error) {
    const raw = typeof error?.message === "string" ? error.message : "";
    return driverFail({
      operation,
      code: raw === "not_your_delivery" ? "not_permitted" : "conflict",
      detail: { code: error?.code, message: raw },
      reason: raw || undefined,
      message:
        raw === "not_your_delivery"
          ? "That delivery is not assigned to you."
          : "That proof does not belong at this step.",
    });
  }

  const { data: signed, error: sErr } = await supabaseAdmin.storage
    .from(PROOF_BUCKET)
    .createSignedUploadUrl(objectPath);

  if (sErr || !signed) {
    return driverFail({ operation, code: "internal", detail: { reason: "signed_upload_failed" } });
  }

  return {
    ok: true,
    value: {
      uploadId: String(data.id),
      signedUrl: signed.signedUrl,
      token: signed.token,
      expectedBytes: p.expectedBytes,
      expectedMime: p.expectedMime,
      expiresInSeconds: 15 * 60,
    },
  };
}

/**
 * What storage actually holds at a path, read by the server.
 *
 * `list` with a search term is used rather than `download`, because the
 * metadata is what matters and downloading a 10 MiB image to learn its size
 * would be absurd. Returns null when the object is not there.
 */
async function readStoredObject(objectPath: string): Promise<{ size: number; mime: string } | null> {
  const slash = objectPath.lastIndexOf("/");
  const dir = objectPath.slice(0, slash);
  const name = objectPath.slice(slash + 1);

  const { data, error } = await supabaseAdmin.storage
    .from(PROOF_BUCKET)
    .list(dir, { search: name, limit: 100 });
  if (error || !data) return null;

  // Exact name, not a prefix match: `search` is a substring filter.
  const found = data.find((o: any) => o.name === name);
  if (!found) return null;

  const size = Number(found?.metadata?.size);
  const mime = String(found?.metadata?.mimetype ?? "");
  if (!Number.isFinite(size)) return null;
  return { size, mime };
}

export type FinalizedProof = {
  proofId: string;
  proofStage: string;
  proofType: string;
  finalizedAt: string;
  byteSize: number | null;
};

/**
 * §5 — finalization. Storage is read first; the SQL command re-checks every
 * one of these facts inside the transaction, so a race between the read and
 * the write cannot slip a mismatched object through.
 */
export async function finalizeProofUpload(p: {
  userId: string;
  uploadId: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  discrepancyId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<DriverResult<FinalizedProof>> {
  const operation = "finalizeProofUpload";

  const { data: auth, error: aErr } = (await supabaseAdmin
    .from("couranr_proof_uploads")
    .select("id,delivery_id,storage_bucket,object_path,expected_mime,expected_bytes,upload_state,expires_at")
    .eq("id", p.uploadId)
    .maybeSingle()) as { data: any; error: any };

  if (aErr) return driverFail({ operation, code: "internal", detail: { reason: "auth_read_failed" } });
  if (!auth) {
    return driverFail({
      operation,
      code: "not_found",
      detail: { reason: "upload_not_found" },
      message: "That upload is no longer valid.",
    });
  }

  // Belt and braces on the bucket: the row records it, and only the canonical
  // one is ever accepted.
  if (auth.storage_bucket !== PROOF_BUCKET || !isCanonicalProofPath(auth.object_path)) {
    return driverFail({ operation, code: "internal", detail: { reason: "non_canonical_target" } });
  }

  const stored = await readStoredObject(auth.object_path);
  if (!stored) {
    return driverFail({
      operation,
      code: "conflict",
      detail: { reason: "object_missing" },
      reason: "object_empty",
      message: "The upload did not arrive. Try again.",
    });
  }

  // The SQL command is the authority and re-checks all of this; these early
  // returns exist so the common failures get precise copy instead of a
  // generic conflict.
  if (stored.size <= 0) {
    return driverFail({
      operation, code: "conflict", detail: { reason: "object_empty" },
      reason: "object_empty", message: "The upload did not arrive. Try again.",
    });
  }
  if (stored.size !== Number(auth.expected_bytes)) {
    // The truncation case. A partial upload is non-empty and storage still
    // answered 200; only the exact-size comparison catches it.
    return driverFail({
      operation, code: "conflict",
      detail: { reason: "object_size_mismatch", expected: auth.expected_bytes, actual: stored.size },
      reason: "object_size_mismatch", message: "The upload arrived incomplete. Try again.",
    });
  }

  const { data, error } = (await supabaseAdmin.rpc("couranr_finalize_proof_upload", {
    p_upload_id: p.uploadId,
    p_actor_user_id: p.userId,
    // Facts the SERVER read, never anything the browser sent.
    p_actual_path: auth.object_path,
    p_actual_bytes: stored.size,
    p_actual_mime: stored.mime,
    p_latitude: p.latitude ?? null,
    p_longitude: p.longitude ?? null,
    p_accuracy_m: p.accuracyM ?? null,
    p_discrepancy_id: p.discrepancyId ?? null,
    p_metadata: p.metadata ?? null,
  })) as { data: any; error: any };

  if (error) {
    const raw = typeof error?.message === "string" ? error.message : "";
    return driverFail({
      operation,
      code: raw === "not_your_delivery" ? "not_permitted" : "conflict",
      detail: { code: error?.code, message: raw },
      reason: raw || undefined,
    });
  }

  return {
    ok: true,
    value: {
      proofId: String(data.id),
      proofStage: String(data.proof_stage),
      proofType: String(data.proof_type),
      finalizedAt: String(data.finalized_at),
      byteSize: data.byte_size == null ? null : Number(data.byte_size),
    },
  };
}

/* ================================================== §6 authorized reads == */

export type ProofMetadata = {
  proofId: string;
  proofStage: string;
  proofType: string;
  finalizedAt: string;
  hasMedia: boolean;
};

/**
 * Metadata only — what the MERCHANT may see. No object path, no bucket, no
 * signed URL, no coordinates, no driver id. PHO-001's authorized viewers are
 * Operations, the assigned driver and the owning customer; the merchant is
 * deliberately not among them, so this is the widest shape they ever receive.
 */
export async function listProofMetadata(deliveryId: string): Promise<ProofMetadata[]> {
  const { data } = (await supabaseAdmin
    .from("couranr_delivery_proofs")
    .select("id,proof_stage,proof_type,finalized_at,storage_object_path")
    .eq("delivery_id", deliveryId)
    .order("finalized_at", { ascending: true })) as { data: any };

  return (data ?? []).map((r: any) => ({
    proofId: String(r.id),
    proofStage: String(r.proof_stage),
    proofType: String(r.proof_type),
    finalizedAt: String(r.finalized_at),
    // Whether media EXISTS is metadata; where it lives is not.
    hasMedia: Boolean(r.storage_object_path),
  }));
}

/**
 * A short-lived signed URL for one proof object.
 *
 * The TTL comes from the centralized policy and is chosen by the VIEWER role,
 * never by the caller — 900 for Operations, 600 for the assigned driver and
 * for the customer. Nothing here persists the URL, and no caller may log it.
 */
export async function signedProofUrl(p: {
  proofId: string;
  viewer: ProofViewer;
}): Promise<DriverResult<{ url: string; expiresInSeconds: number }>> {
  const operation = "signedProofUrl";

  const { data: proof } = (await supabaseAdmin
    .from("couranr_delivery_proofs")
    .select("id,storage_bucket,storage_object_path")
    .eq("id", p.proofId)
    .maybeSingle()) as { data: any };

  if (!proof || !proof.storage_object_path) {
    return driverFail({
      operation,
      code: "not_found",
      detail: { reason: "no_media" },
      message: "There is no image for that proof.",
    });
  }

  const ttl = PROOF_URL_TTL_SECONDS[p.viewer];
  const { data, error } = await supabaseAdmin.storage
    .from(String(proof.storage_bucket ?? PROOF_BUCKET))
    .createSignedUrl(String(proof.storage_object_path), ttl);

  if (error || !data?.signedUrl) {
    return driverFail({ operation, code: "internal", detail: { reason: "sign_failed" } });
  }
  return { ok: true, value: { url: data.signedUrl, expiresInSeconds: ttl } };
}

export { isDriverFailure };
