// app/docs/request/page.tsx
import { Suspense } from "react";
import DocsRequestClient from "./DocsRequestClient";

export default function DocsRequestPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading Docs request…</p>}>
      <DocsRequestClient />
    </Suspense>
  );
}
