import { Suspense } from "react";
import DashboardRouterClient from "./DashboardRouterClient";

export default function DashboardPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading dashboard…</p>}>
      <DashboardRouterClient />
    </Suspense>
  );
}