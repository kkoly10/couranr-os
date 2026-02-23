// app/docs/checkout/page.tsx
import { Suspense } from "react";
import CheckoutClient from "./CheckoutClient";

export default function DocsCheckoutPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading checkout…</p>}>
      <CheckoutClient />
    </Suspense>
  );
}