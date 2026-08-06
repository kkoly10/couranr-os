import { PageHeader } from "@/components/couranr/shell/parts";
import { DeliveryRequestDetail } from "@/components/couranr/requests/DeliveryRequestDetail";

export const metadata = { title: "Delivery review workspace — Couranr" };

/**
 * OPS-003 — delivery review workspace.
 *
 * The Operations-side view of one request, and where the three review outcomes
 * (REV-001) are decided. It renders the same `DeliveryRequestDetail` the
 * merchant sees; the decision panel appears only for a viewer who read the
 * request without a business scope, which only Couranr Operations can do.
 *
 * This route exists because OPS-002 previously linked Operations at
 * `/business/deliveries/[id]` — a merchant surface an operations user is
 * redirected away from, so the review workspace was unreachable.
 *
 * Managed dispatch — vehicle, driver and schedule selection — is the rest of
 * this screen and is not in this slice.
 */
export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return (
    <>
      <PageHeader
        title="Delivery review"
        breadcrumbs={[
          { label: "Queue", href: "/operations/queue" },
          { label: "Delivery review" },
        ]}
      />
      <DeliveryRequestDetail id={params.id} />
    </>
  );
}
