"use client";

import { Suspense } from "react";
import ConfirmationClient from "./confirmation-client";

export default function ConfirmationPage() {
  return (
    <Suspense fallback={<p>Loading order confirmation…</p>}>
      <ConfirmationClient />
    </Suspense>
  );
}