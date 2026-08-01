import { PageHeader } from "@/components/couranr/shell/parts";
import { AssignedDeliveryDetail } from "@/components/couranr/dispatch/AssignedDeliveryDetail";

export const metadata = { title: "Assigned delivery — Couranr" };

/**
 * DRV-002 — assigned delivery detail.
 *
 * Only the assigned driver can see this, and only the sanitized projection.
 * The page passes the id through; the server decides whether this caller holds
 * that delivery, and answers "no assignment" rather than a permission error if
 * they do not — a 403 would confirm the delivery exists.
 */
export default function Page({ params }: { params: { id: string } }) {
  return (
    <>
      <PageHeader
        title="Assigned delivery"
        breadcrumbs={[{ label: "Dashboard", href: "/driver" }, { label: "Assigned delivery" }]}
      />
      <AssignedDeliveryDetail deliveryId={params.id} />
    </>
  );
}
