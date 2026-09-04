import { PageHeader } from "@/components/couranr/shell/parts";
import { DeliveryRequestDetail } from "@/components/couranr/requests/DeliveryRequestDetail";

export const metadata = { title: "Delivery workbench — Couranr" };

/**
 * OPS-003 — delivery lifecycle workbench.
 *
 * The Operations-side view of one request, and where the current lifecycle action
 * (REV-001) are decided. It reuses the canonical request/detail data but composes an Operations-first
 * lifecycle workbench. Review, commercial approval, planning, dispatch and
 * execution are stage-aware rather than stacked into one merchant-like page.
 *
 * This route exists because OPS-002 previously linked Operations at
 * `/app/business/deliveries/[id]` — a merchant surface an operations user is
 * redirected away from, so the review workspace was unreachable.
 *
 * The URL stays stable while the workbench advances Review → Commercial → Plan
 * → Dispatch → Execute → Complete.
 */
export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return (
    <>
      <PageHeader
        title="Delivery workbench"
        breadcrumbs={[
          { label: "Queue", href: "/operations/queue" },
          { label: "Delivery workbench" },
        ]}
      />
      <DeliveryRequestDetail id={params.id} surface="operations" />
    </>
  );
}
