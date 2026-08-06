import { PageHeader } from "@/components/couranr/shell/parts";
import { MerchantDashboard } from "@/components/couranr/dashboard/MerchantDashboard";

export const metadata = { title: "Merchant dashboard — Couranr" };

/**
 * MER-001 — merchant dashboard.
 *
 * Purpose, from the registry: "today's deliveries, readiness, attention
 * items, payment states, messages, and quick actions." Every tile composes an
 * endpoint that already exists; the component adds no new server behavior.
 *
 * Mandatory constraint (`UI_SCREEN_REGISTRY.md:274`): "No fabricated revenue,
 * customer, or on-time metrics. Use real posted data only." No such tile is
 * rendered — no posted source exists for any of them.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your deliveries, what needs attention, and your messages."
      />
      <MerchantDashboard />
    </>
  );
}
