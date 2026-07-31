import * as React from "react";
import { PageHeader } from "@/components/couranr/shell/parts";
import { NewDeliveryFlow } from "@/components/couranr/requests/NewDeliveryFlow";

export const metadata = { title: "Create delivery — Couranr" };

/**
 * MER-005 Create delivery with Smart Intake, and MER-006 Delivery review and
 * quote at `?step=review`. One route, two steps, exactly as the registry
 * declares them.
 *
 * `Suspense` is required around the flow because it reads `useSearchParams`.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Create a delivery"
        description="Enter the shipment details and Couranr calculates the estimate."
        breadcrumbs={[
          { label: "Deliveries", href: "/business/deliveries" },
          { label: "New delivery" },
        ]}
      />
      <React.Suspense fallback={null}>
        <NewDeliveryFlow />
      </React.Suspense>
    </>
  );
}
