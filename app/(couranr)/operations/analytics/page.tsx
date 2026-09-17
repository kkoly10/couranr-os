import * as React from "react";
import { PageHeader } from "@/components/couranr/shell/parts";
import { OperationsAnalyticsDashboard } from "@/components/couranr/operations/analytics/OperationsAnalyticsDashboard";

export const metadata = { title: "Operations analytics — Couranr" };

/**
 * OPS-013 Operations analytics, and OPS-014 Unmet demand at `?tab=unmet-demand`.
 *
 * One route, two tabs, as the screen registry declares them — OPS-014's
 * canonical route IS `/operations/analytics?tab=unmet-demand`, so the tab is
 * selected from the query string rather than from a second path.
 *
 * `Suspense` is required because the dashboard reads `useSearchParams`.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Operations analytics"
        description="Paid deliveries, markets, categories, payer mix, economics, support, proof and driver utilization — and the requests Couranr could not confirm. Aggregates only."
        breadcrumbs={[{ label: "Couranr Operations" }, { label: "Analytics" }]}
      />
      <React.Suspense fallback={null}>
        <OperationsAnalyticsDashboard />
      </React.Suspense>
    </>
  );
}
