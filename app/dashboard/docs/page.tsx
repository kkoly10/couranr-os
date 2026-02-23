// app/dashboard/docs/page.tsx
import { Suspense } from "react";
import DocsDashboardClient from "./DocsDashboardClient";

export default function DocsDashboardPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading Docs dashboard…</p>}>
      <DocsDashboardClient />
    </Suspense>
  );
}
