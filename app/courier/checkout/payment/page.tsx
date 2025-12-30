export const dynamic = "force-dynamic";

import { Suspense } from "react";
import PaymentClient from "./PaymentClient";

export default function PaymentPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading payment…</div>}>
      <PaymentClient />
    </Suspense>
  );
}