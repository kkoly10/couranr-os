import { Suspense } from "react";
import DocsAdminRequestDetailClient from "./DocsAdminRequestDetailClient";

export default function AdminDocsRequestDetailPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading docs request…</p>}>
      <DocsAdminRequestDetailClient />
    </Suspense>
  );
}
