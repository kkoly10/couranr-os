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
export default function Page({ params }: { params: { token: string } }) {
  return (
    <main className="cr-shell__main" style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem" }}>
      <PaymentLinkPage token={params.token} />
    </main>
  );
}
