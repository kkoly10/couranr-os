import * as React from "react";
import { PublicShell } from "@/components/couranr/shell/shells";
import { SameDayMarketingMeasurement } from "@/components/analytics/SameDayMarketingMeasurement";

/**
 * Couranr Same Day: PUB-013 at /sameday and PUB-004's direct-consumer routes.
 *
 * A SERVER layout. The variant is a constant chosen by which route group the
 * page lives in, so no client code and no `usePathname()` is involved in
 * selecting public chrome.
 */
export default function ConsumerPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const production = process.env.VERCEL_ENV === "production";
  return (
    <PublicShell variant="consumer">
      {children}
      <SameDayMarketingMeasurement
        gaId={production ? process.env.COURANR_GA4_MEASUREMENT_ID ?? null : null}
        pixelId={production ? process.env.COURANR_META_PIXEL_ID ?? null : null}
      />
    </PublicShell>
  );
}
