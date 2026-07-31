import * as React from "react";
import { MerchantShell } from "@/components/couranr/shell/shells";
import { SurfaceGuard } from "@/components/couranr/auth/SurfaceGuard";

/**
 * The shell renders immediately; the GUARD gates the page inside it.
 *
 * That ordering is deliberate. Wrapping the shell would blank the whole
 * chrome on every navigation, and the shell itself carries no protected data —
 * its navigation is derived from the canonical screen registry, not from the
 * viewer. What must not appear before the check resolves is the page content,
 * which is what SurfaceGuard wraps.
 *
 * The guard is for navigation and UX only. Authorization lives in the server
 * routes and the named commands.
 */
export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return (
    <MerchantShell>
      <SurfaceGuard surface="business">{children}</SurfaceGuard>
    </MerchantShell>
  );
}
