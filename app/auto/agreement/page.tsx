import { Suspense } from "react";
import AgreementClient from "./AgreementClient";

export default function AgreementPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading agreement…</p>}>
      <AgreementClient />
    </Suspense>
  );
}
