"use client";

export const dynamic = "force-dynamic";

import { Suspense } from "react";
import PaymentClient from "./PaymentClient";

export default function CourierPaymentPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 24 }}>
          <h1>Preparing secure payment…</h1>
        </div>
      }
    >
      <PaymentClient />
    </Suspense>
  );
}
