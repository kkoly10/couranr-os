import { Suspense } from "react";
import type { Metadata } from "next";
import { SendFlow } from "@/components/couranr/sameday/SendFlow";
import { getSameDayAdapters } from "@/lib/couranr/sameday/adapters";
import { SEND_COPY } from "@/lib/couranr/public/masterSameDayCopy";

/**
 * PUB-004's direct-consumer mode, at `/send`.
 *
 * A ROUTE AND MODE of PUB-004, not a new screen: the estimate, this flow and
 * the merchant-hosted `/request/[merchantSlug]` variant are one capability
 * entered three ways, which is why LEG-004 added the route without adding a
 * screen id.
 *
 * FRONTEND ONLY. Nothing here creates a request, searches an address, checks a
 * service area, runs Smart Intake, prices a delivery or touches Stripe. The
 * adapter mode is resolved SERVER-side and passed down, so the client never
 * decides whether fixtures are on — in production it is `disabled` and the flow
 * stops at the acknowledgement with MKT-005's production stop.
 */

export const metadata: Metadata = {
  title: "Send something — Couranr Same Day",
  description: "Send something you have, or have Couranr pick something up for you.",
};

export default function Page() {
  /* Resolved here, on the server, from environment only. The page hands the
     client a MODE, never a switch: there is no prop a browser could set. */
  const { mode } = getSameDayAdapters();

  /* SendFlow reads `?intent=` with `useSearchParams()`, which opts a route out
     of static prerendering unless it sits inside a Suspense boundary — the
     build fails outright without one. The fallback is the phase rail's first
     step rather than a spinner, so the page's shape is stable while the intent
     resolves and nothing shifts under a reader. */
  return (
    <div className="cr-mkt">
      <Suspense fallback={<p className="cr-send-note">Loading your delivery form…</p>}>
        <SendFlow mode={mode} productionStop={SEND_COPY.production_stop} />
      </Suspense>
    </div>
  );
}
