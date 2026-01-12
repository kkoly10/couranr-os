import { Suspense } from "react";
import ConfirmationClient from "./ConfirmationClient";

export default function ConfirmationPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading confirmation…</p>}>
      <ConfirmationClient />
    </Suspense>
  );
}
