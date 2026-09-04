import { PageHeader } from "@/components/couranr/shell/parts";
import { DeliveryRequestDetail } from "@/components/couranr/requests/DeliveryRequestDetail";

export const metadata = { title: "Delivery detail — Couranr" };

/** MER-007 — delivery detail. */
export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return (
    <>
      <PageHeader
        title="Delivery"
        breadcrumbs={[
          { label: "Deliveries", href: "/app/business/deliveries" },
          { label: "Delivery detail" },
        ]}
      />
      <DeliveryRequestDetail id={params.id} surface="business" />
    </>
  );
}
