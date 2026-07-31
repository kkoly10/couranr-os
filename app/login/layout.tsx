import * as React from "react";
import PublicHeader from "@/components/PublicHeader";

/**
 * Legacy login chrome.
 *
 * `PublicHeader` used to be mounted in the ROOT layout, which put the legacy
 * "Auto | Courier | Docs" navigation on top of every canonical Couranr screen —
 * sign-in, the merchant shell and the Operations shell all inherited it. The
 * header now belongs to the legacy segments that actually want it, so canonical
 * routes under `app/(couranr)/` simply never compose it. Structural, not hidden
 * after render.
 */
export default function LoginLegacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicHeader />
      {children}
    </>
  );
}
