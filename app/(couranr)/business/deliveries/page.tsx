import { PageHeader } from "@/components/couranr/shell/parts";
import { DeliveriesList } from "@/components/couranr/requests/DeliveriesList";

export const metadata = { title: "Deliveries — Couranr" };

/**
 * MER-004 — the deliveries list.
 *
 * Purpose, from the registry: "Find and manage merchant delivery requests
 * across request, payment, readiness, review, and fulfillment states."
 * Mandatory constraint: never collapse the independent state groups into one
 * merged status — each group renders as its own badge and filters on its own
 * facet.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Every delivery request for your business, across all of its state groups."
      />
      <DeliveriesList />
    </>
  );
}
