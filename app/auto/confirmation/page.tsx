import { Suspense } from "react";
import ConfirmationClient from "./ConfirmationClient";

export default function AutoConfirmationPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
      <ConfirmationClient />
    </Suspense>
  );
}