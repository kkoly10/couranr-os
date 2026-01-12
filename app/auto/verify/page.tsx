import { Suspense } from "react";
import VerificationClient from "./VerificationClient";

export default function VerifyPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading verification…</p>}>
      <VerificationClient />
    </Suspense>
  );
}