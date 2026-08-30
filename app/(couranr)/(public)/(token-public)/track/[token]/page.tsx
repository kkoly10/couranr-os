import { TrackingPage } from "@/components/couranr/tracking/TrackingPage";

export const metadata = {
  title: "Track your delivery — Couranr",
  // A tracking link must never be indexed, summarised or previewed. The token
  // is the authorization, and a crawler that follows one into an index has
  // published it.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * PUB-006 — secure live tracking.
 * CUS-006 — proof-of-delivery viewer, the `#proof` section of this page.
 * CUS-008 — delivery preferences and access instructions, the `#access`
 *           section (read-only in this slice; see the component).
 *
 * Unauthenticated: the token in the path is the authorization. The page reads
 * nothing from the query string that changes what it shows.
 */
export default async function Page(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  return (
    // A <div>, NOT a <main>. The public shell already renders the page's
    // `<main id="cr-main">` landmark, and a nested one gives the document two
    // main landmarks — which is invalid and leaves assistive technology
    // without a single "the content" target. Caught by driving the page.
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem" }}>
      <TrackingPage token={params.token} />
    </div>
  );
}
