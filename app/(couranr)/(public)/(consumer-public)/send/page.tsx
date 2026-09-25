import { Suspense } from "react";
import { SendFlow } from "@/components/couranr/sameday/SendFlow";
import { resolveAdapterMode } from "@/lib/couranr/sameday/adapterMode";
import { isRecipientIdentityCapabilityAvailable } from "@/lib/couranr/identity/recipientIdentity";
import { createNoIndexPublicMetadata } from "@/lib/couranr/public/seo";

/**
 * PUB-004's direct-consumer mode, at `/send`.
 *
 * A ROUTE AND MODE of PUB-004, not a new screen: the estimate, this flow and
 * the merchant-hosted `/request/[merchantSlug]` variant are one capability
 * entered three ways, which is why LEG-004 added the route without adding a
 * screen id.
 *
 * The consumer backend is real: `/send` reaches the `/api/couranr/consumer/*`
 * routes for guest sessions, canonical Google address resolution, Mapbox
 * routing, shared Pricing V2, request persistence, the Stripe payment
 * obligation flow, tracking and pickup credentials. `live` is the DEFAULT for
 * every real environment; the adapter mode is resolved SERVER-side and passed
 * down, so the client never decides whether fixtures are on and no browser
 * input can turn them on.
 */

export const metadata = createNoIndexPublicMetadata({
  title: "Send something — Couranr Same Day",
  description: "Send something you have, or have Couranr pick something up for you.",
});

export default function Page() {
  /* Resolved here, on the server, from environment only. The page hands the
     client a MODE, never a switch: there is no prop a browser could set. */
  const { mode } = resolveAdapterMode();

  /* SendFlow reads `?intent=` with `useSearchParams()`, which opts a route out
     of static prerendering unless it sits inside a Suspense boundary — the
     build fails outright without one. The fallback is the phase rail's first
     step rather than a spinner, so the page's shape is stable while the intent
     resolves and nothing shifts under a reader. */
  return (
    <div className="cr-mkt cr-send-page">
      <Suspense fallback={<p className="cr-send-note">Loading your delivery form…</p>}>
        <SendFlow
          mode={mode}
          /* THE REAL CONFIGURATION, read on the server and handed down. SendFlow
             is a client component and cannot see it; without this it would fall
             back to the fail-closed default forever and keep promising $150
             after Protected Handoff was activated. Passing it here is what makes
             activation a configuration act rather than an edit to two pages. */
          capabilities={{
            recipientIdentityVerification: isRecipientIdentityCapabilityAvailable(),
          }}
        />
      </Suspense>
    </div>
  );
}
