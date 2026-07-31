import { PageHeader } from "@/components/couranr/shell/parts";
import { DeliveryRequestDetail } from "@/components/couranr/requests/DeliveryRequestDetail";

export const metadata = { title: "Delivery detail — Couranr" };

/** MER-007 — delivery detail. */
export default function Page({ params }: { params: { id: string } }) {
  return (
    <>
      <PageHeader
        title="Delivery"
        breadcrumbs={[
          { label: "Deliveries", href: "/business/deliveries" },
          { label: "Delivery detail" },
        ]}
      />
      <DeliveryRequestDetail id={params.id} />
    </>
  );
}
