// app/courier/checkout/page.tsx
import { Suspense } from "react";
import CheckoutClient from "./CheckoutClient";

export const dynamic = "force-dynamic";

export default function CheckoutPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading checkout…</p>}>
      <CheckoutClient />
    </Suspense>
  );
}