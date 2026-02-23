// app/docs/success/page.tsx
import { Suspense } from "react";
import SuccessClient from "./SuccessClient";

export default function DocsSuccessPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Finalizing payment…</p>}>
      <SuccessClient />
    </Suspense>
  );
}