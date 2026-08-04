import { DeliveryHelpPage } from "@/components/couranr/help/DeliveryHelpPage";

export const metadata = {
  title: "Delivery Help — Couranr",
  // A help link must never be indexed. The token in the path IS the
  // authorization, and a crawler that follows one into an index has published a
  // credential that can post into a support thread.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * PUB-007 — Delivery Help, `/help/[token]`.
 *
 * CUS-001 (address-change request) and CUS-003 (recipient unavailable
 * resolution) are fragments of this route in UI_SCREEN_REGISTRY.md —
 * `#address-change` and `#recipient-unavailable`. They are help TOPICS on this
 * page rather than separate screens, and neither changes anything: raising an
 * address concern creates an Operations review item, never an address update.
 *
 * Unauthenticated: the token is the credential. The recipient of a delivery has
 * no account, which is the whole reason this surface exists.
 */
export default function Page({ params }: { params: { token: string } }) {
  return (
    // A <div>, not a <main>: the public shell already renders the page's
    // `<main id="cr-main">` landmark, and nesting a second one leaves assistive
    // technology without a single "the content" target.
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem" }}>
      <DeliveryHelpPage token={params.token} />
    </div>
  );
}
