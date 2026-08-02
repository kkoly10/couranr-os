import { randomBytes } from "node:crypto";
import { assertServerOnly } from "@/lib/couranr/serverOnly";

assertServerOnly("lib/couranr/driver/proofPaths.ts");

/**
 * Canonical object paths for delivery proof.
 *
 * The bucket is the existing PRIVATE `delivery-photos` — PHO-001 names it as
 * the proof bucket, so this slice reuses it rather than minting a second one
 * that would need its own policies, its own TTL decisions and its own audit.
 *
 * A path is the one part of a private object that leaks in three directions at
 * once: it appears in a signed URL, in a server log line, and in any bucket
 * listing an operator opens. So it carries NO identifying content — no
 * merchant or recipient name, no phone number, no address, no PIN, no token,
 * no email, and no meaningful original filename. The only free segment is 32
 * hex characters of server-generated entropy.
 *
 * The browser never chooses a path. It receives a signed URL for one the
 * server already committed to in an upload-authorization row, and
 * finalization refuses if the stored object is anywhere else.
 *
 * The `v1` segment is deliberate. When the layout has to change, objects
 * written under v1 stay addressable without a rename — and an append-only
 * evidence store cannot rename anything.
 */

export const PROOF_BUCKET = "delivery-photos";
export const PROOF_PREFIX = "canonical-proof/v1";

/**
 * Extensions, keyed by the MIME types the bucket itself allows. Kept in step
 * with `couranr_pu_mime_chk` and with the live bucket's `allowed_mime_types`;
 * a type accepted here but rejected by storage would fail at upload time with
 * a far less useful error.
 */
export const PROOF_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export const ALLOWED_PROOF_MIME = Object.keys(PROOF_MIME_EXTENSIONS);

/** Matched to the live bucket's `file_size_limit`, so the two cannot disagree. */
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

export function isAllowedProofMime(v: unknown): v is string {
  return typeof v === "string" && ALLOWED_PROOF_MIME.includes(v);
}

/**
 * The shape the database also enforces
 * (`couranr_pu_path_shape_chk`). Duplicated deliberately: the generator can be
 * bypassed by a future caller, the constraint cannot.
 */
export const PROOF_PATH_RE =
  /^canonical-proof\/v1\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{32}\.[a-z]{3,4}$/;

export function isCanonicalProofPath(v: unknown): v is string {
  return typeof v === "string" && PROOF_PATH_RE.test(v);
}

/**
 * `canonical-proof/v1/<delivery-id>/<proof-id>/<32 hex>.<ext>`
 *
 * Both ids are UUIDs the server already holds, so the path is addressable from
 * a delivery without a lookup table, while the filename itself carries no
 * information at all.
 */
export function buildProofObjectPath(input: {
  deliveryId: string;
  proofId: string;
  mimeType: string;
}): string {
  const ext = PROOF_MIME_EXTENSIONS[input.mimeType];
  if (!ext) throw new Error("Unsupported proof media type.");
  if (!UUID_RE.test(input.deliveryId) || !UUID_RE.test(input.proofId)) {
    throw new Error("A proof path requires canonical identifiers.");
  }
  const name = randomBytes(16).toString("hex");
  const path = `${PROOF_PREFIX}/${input.deliveryId}/${input.proofId}/${name}.${ext}`;
  // Fail here rather than at the database, where the constraint name would be
  // the only clue.
  if (!isCanonicalProofPath(path)) throw new Error("Generated proof path is not canonical.");
  return path;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Signed-URL lifetimes, fixed by PHO-001. These are DECIDED VALUES, not tuning
 * knobs — a longer driver URL is a product decision that belongs in the
 * registry, not in a route.
 */
export const PROOF_URL_TTL_SECONDS = {
  operations: 900,
  driver: 600,
  customer: 600,
} as const;

export type ProofViewer = keyof typeof PROOF_URL_TTL_SECONDS;

/**
 * Who may retrieve proof MEDIA. PHO-001's list is exactly these three, and the
 * merchant is deliberately absent: they see that proof exists, its stage, its
 * type and when it finalized, but never the media and never a signed URL.
 */
export const PROOF_MEDIA_VIEWERS: readonly ProofViewer[] = ["operations", "driver", "customer"];

export function proofUrlTtlSeconds(viewer: ProofViewer): number {
  return PROOF_URL_TTL_SECONDS[viewer];
}

/**
 * A signed URL is never persisted. `assertPersistableRef` already refuses
 * anything containing `token=` or an `/object/(public|sign|authenticated)/`
 * segment; this is the same rule stated where proof paths are built, so a
 * caller reaching for "just store the URL" meets it here first.
 */
export function assertNotASignedUrl(value: string): string {
  if (/token=/.test(value) || /\/object\/(public|sign|authenticated)\//.test(value)) {
    throw new Error("A signed URL must never be persisted.");
  }
  return value;
}
