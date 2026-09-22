import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { classifyDatabaseError, type PublicErrorCode } from "@/lib/couranr/errors";

assertServerOnly("lib/couranr/driver/publicProfile.ts");

export const DRIVER_PORTRAIT_BUCKET = "couranr-driver-portraits";
// Below Vercel's hard 4.5 MB Function request limit, leaving multipart room.
export const MAX_DRIVER_PORTRAIT_UPLOAD_BYTES = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicDriverIdentity = { name: string; portraitUrl: string | null };

export function isWellFormedPortraitPublicId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function portraitUrl(publicId: string | null | undefined): string | null {
  return publicId && isWellFormedPortraitPublicId(publicId)
    ? `/api/couranr/driver-portrait/${publicId}`
    : null;
}

/** Uniformly redeem the opaque public reference; never exposes the object path. */
export async function redeemDriverPortrait(publicId: unknown): Promise<ArrayBuffer | null> {
  if (!isWellFormedPortraitPublicId(publicId)) return null;
  const { data: portrait, error } = await supabaseAdmin
    .from("couranr_driver_portraits").select("object_path,revoked_at")
    .eq("public_id", publicId).maybeSingle();
  if (error || !portrait || portrait.revoked_at) return null;
  const download = await supabaseAdmin.storage.from(DRIVER_PORTRAIT_BUCKET)
    .download(String(portrait.object_path));
  if (download.error || !download.data) return null;
  return download.data.arrayBuffer();
}

/** Only the assignment snapshot may decide which driver a customer sees. */
export async function identityForAssignment(assignment: {
  driver_display_name_snapshot?: string | null;
  driver_portrait_id?: string | null;
} | null, options: { stableEmailReference?: boolean } = {}): Promise<PublicDriverIdentity | null> {
  if (!assignment || !assignment.driver_display_name_snapshot?.trim()) return null;
  let publicId: string | null = null;
  if (assignment.driver_portrait_id) {
    const { data, error } = await supabaseAdmin
      .from("couranr_driver_portraits")
      .select("public_id,revoked_at")
      .eq("id", assignment.driver_portrait_id)
      .maybeSingle();
    if (error) throw error;
    if (data && (!data.revoked_at || options.stableEmailReference)) publicId = String(data.public_id);
  }
  return {
    name: assignment.driver_display_name_snapshot.trim(),
    portraitUrl: portraitUrl(publicId),
  };
}

export async function identityForDelivery(deliveryId: string, fulfillmentState: string): Promise<PublicDriverIdentity | null> {
  const assignmentState = fulfillmentState === "delivered" ? "completed" : "active";
  const { data, error } = await supabaseAdmin.from("couranr_delivery_assignments")
    .select("driver_display_name_snapshot,driver_portrait_id")
    .eq("delivery_id", deliveryId).eq("assignment_state", assignmentState)
    .order("assigned_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return identityForAssignment(data);
}

/** Decode and rewrite the actual bytes. MIME headers, EXIF and filenames are ignored. */
export async function normalizeDriverPortrait(input: Buffer): Promise<Buffer> {
  if (!input.length || input.length > MAX_DRIVER_PORTRAIT_UPLOAD_BYTES) {
    throw new Error("portrait_size_invalid");
  }
  try {
    const decoder = sharp(input, { failOn: "error", limitInputPixels: 25_000_000 });
    const metadata = await decoder.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
      throw new Error("portrait_format_invalid");
    }
    return await decoder.rotate().resize(512, 512, { fit: "cover", position: "attention" })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch (error) {
    if (error instanceof Error && error.message === "portrait_format_invalid") throw error;
    // Decoder details are neither actionable nor safe to echo to a browser.
    throw new Error("portrait_format_invalid");
  }
}

export async function publishDriverPortrait(params: {
  driverId: string;
  expectedVersion: number;
  actorUserId: string;
  consentConfirmed: boolean;
  bytes: Buffer;
}): Promise<{ publicId: string }> {
  if (!UUID.test(params.driverId) || !Number.isInteger(params.expectedVersion) || params.expectedVersion < 1) {
    throw new Error("portrait_input_invalid");
  }
  if (!params.consentConfirmed) throw new Error("portrait_consent_required");
  const normalized = await normalizeDriverPortrait(params.bytes);
  const publicId = randomUUID();
  const path = `drivers/${params.driverId}/${randomUUID()}.jpg`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(DRIVER_PORTRAIT_BUCKET)
    .upload(path, normalized, { contentType: "image/jpeg", cacheControl: "300", upsert: false });
  if (uploadError) throw uploadError;
  const { error } = await supabaseAdmin.rpc("couranr_publish_driver_portrait", {
    p_driver_id: params.driverId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actorUserId,
    p_object_path: path,
    p_public_id: publicId,
    p_consent_confirmed: true,
  });
  if (error) {
    // An unreferenced object is not historical evidence; remove it on CAS failure.
    await supabaseAdmin.storage.from(DRIVER_PORTRAIT_BUCKET).remove([path]);
    throw error;
  }
  return { publicId };
}

/** Consent withdrawal is a named Operations command. The private object and
 * assignment audit reference remain; public redemption stops immediately. */
export async function revokeDriverPortrait(params: {
  driverId: string;
  expectedVersion: number;
  actorUserId: string;
}): Promise<boolean> {
  if (!UUID.test(params.driverId) || !Number.isInteger(params.expectedVersion) || params.expectedVersion < 1) {
    throw new Error("portrait_input_invalid");
  }
  const { data, error } = await supabaseAdmin.rpc("couranr_revoke_driver_portrait", {
    p_driver_id: params.driverId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actorUserId,
  });
  if (error) throw error;
  return data === true;
}

/** Route-safe classification. Decoder and database detail stay in this
 * server-only module; callers receive only a stable code and owned copy. */
export function classifyDriverPortraitFailure(cause: unknown): {
  code: PublicErrorCode;
  message: string;
} {
  if (cause instanceof Error && cause.message.startsWith("portrait_")) {
    return { code: "invalid_input", message: "That portrait could not be accepted." };
  }
  const code = classifyDatabaseError(cause);
  if (code === "version_conflict") {
    return { code, message: "Driver profile changed. Reload and try again." };
  }
  if (code === "not_found" || code === "not_permitted" || code === "conflict") {
    return { code, message: "The portrait could not be published." };
  }
  return { code: "internal", message: "The portrait could not be published. Try again." };
}
