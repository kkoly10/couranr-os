import { PaymentLinkPage } from "@/components/couranr/payments/PaymentLinkPage";

export const metadata = {
  title: "Secure delivery payment — Couranr",
  // A payment link must never be indexed, summarised or previewed.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * PUB-005 — secure delivery payment.
 * CUS-005 — revised quote approval, the same screen at `?mode=requote`.
 *
 * Unauthenticated: the token in the path is the authorization. The page reads
 * nothing from the query string that changes what it shows — whether this is a
 * revised quote is the server's answer, not the URL's claim.
 */
export default async function Page(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  return (
    // A <div>, NOT a <main>: the public shell already renders the page's
    // `<main id="cr-main">` landmark. This page nested a second one, giving
    // the document two main landmarks. Found by driving /track/[token], which
    // had copied the same shape.
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem" }}>
      <PaymentLinkPage token={params.token} />
    </div>
  );
}
