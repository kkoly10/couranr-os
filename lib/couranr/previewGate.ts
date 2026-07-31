/**
 * Gate for internal-only UI preview routes.
 *
 * Mirrors the correct in-tree pattern at app/api/docs/test-mark-paid/route.ts,
 * which returns 403 unless the environment explicitly opts in. The preview
 * renders no customer data and no secrets, but it is still an internal surface:
 * UI_SCREEN_REGISTRY.md section 10 requires that no non-canonical screen is
 * exposed in navigation or active runtime.
 *
 * Enabled when NOT production, or when COURANR_UI_PREVIEW is explicitly "1".
 * In production without that flag the route 404s, which reveals nothing about
 * whether it exists.
 */
export function isPreviewEnabled(): boolean {
  if (process.env.COURANR_UI_PREVIEW === "1") return true;
  return process.env.NODE_ENV !== "production";
}
