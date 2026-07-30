import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Delivery proof photos are stored in the PRIVATE `delivery-photos` bucket and
 * are reachable only through a short-lived signed URL issued after an
 * authorization check (see `lib/delivery/deliveryAccess.ts`).
 *
 * `delivery_photos.photo_url` is NOT NULL and the production table has no
 * `storage_path` column, so that column carries a storage REFERENCE rather than
 * a fetchable URL:
 *
 *     storage://delivery-photos/pickup/<deliveryId>/<file>
 *
 * The custom scheme is deliberate. A bare path in a column named `photo_url`
 * invites someone to drop it into `<img src>`; `storage://` cannot be fetched by
 * a browser, so the mistake fails loudly instead of silently rendering nothing.
 *
 * A signed URL is NEVER persisted here. Signed URLs are credentials with an
 * expiry: writing one to a row would outlive its purpose, leak through any
 * consumer of the row, and give a reader access without an authorization check.
 */

export const DELIVERY_PHOTOS_BUCKET = "delivery-photos";

const STORAGE_REF_SCHEME = "storage://";

export function buildStorageRef(bucket: string, path: string): string {
  const b = (bucket || "").trim().replace(/^\/+|\/+$/g, "");
  const p = (path || "").trim().replace(/^\/+/, "");
  if (!b || !p) {
    throw new Error("buildStorageRef requires a bucket and a path.");
  }
  return `${STORAGE_REF_SCHEME}${b}/${p}`;
}

export function parseStorageRef(
  ref: string | null | undefined
): { bucket: string; path: string } | null {
  const value = (ref || "").trim();
  if (!value.startsWith(STORAGE_REF_SCHEME)) return null;

  const rest = value.slice(STORAGE_REF_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;

  const bucket = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  if (!bucket || !path) return null;

  return { bucket, path };
}

/**
 * Guard against ever writing a credential into a persisted column.
 *
 * Supabase signed URLs carry a `token=` query parameter; public URLs contain
 * `/object/public/`. Both are rejected so a future edit that reintroduces
 * `getPublicUrl()` or `createSignedUrl()` at the persistence site fails a test
 * rather than shipping.
 */
export function assertPersistableRef(value: string): string {
  const v = (value || "").trim();

  if (!v) {
    throw new Error("Refusing to persist an empty photo reference.");
  }
  if (!parseStorageRef(v)) {
    throw new Error(
      `Refusing to persist "${v}": delivery photo references must use the ${STORAGE_REF_SCHEME} scheme.`
    );
  }
  if (/[?&]token=/i.test(v)) {
    throw new Error("Refusing to persist a signed URL (contains a token).");
  }
  if (/\/object\/(public|sign|authenticated)\//i.test(v)) {
    throw new Error("Refusing to persist a storage object URL.");
  }

  return v;
}

/**
 * Issues a short-lived signed URL. Call ONLY after authorizing the caller.
 * The result is returned to the caller and never written to a row or a log.
 */
export async function createDeliveryPhotoSignedUrl(
  ref: string,
  expiresInSeconds: number
): Promise<string | null> {
  const parsed = parseStorageRef(ref);
  if (!parsed) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, expiresInSeconds);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
