import { Suspense } from "react";
import CheckoutClient from "./CheckoutClient";

export default function CourierCheckoutPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading checkout…</div>}>
      <CheckoutClient />
    </Suspense>
  );
}