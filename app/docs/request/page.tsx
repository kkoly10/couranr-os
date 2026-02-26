// app/docs/request/page.tsx
import { Suspense } from "react";
import DocsRequestClient from "./DocsRequestClient";

export const dynamic = "force-dynamic";

export default function DocsRequestPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, fontFamily: "sans-serif" }}>Loading your request...</div>}>
      <DocsRequestClient />
    </Suspense>
  );
}
