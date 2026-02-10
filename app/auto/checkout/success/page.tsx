import { Suspense } from "react";
import SuccessClient from "@/app/auto/success/SuccessClient";

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
      <SuccessClient />
    </Suspense>
  );
}