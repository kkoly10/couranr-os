import { PageHeader } from "@/components/couranr/shell/parts";
import { RefundsWorkspace } from "@/components/couranr/operations/refunds/RefundsWorkspace";

export const metadata = { title: "Refund management — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Refund management"
        description="Review delivery-charge refund requests with evidence, policy, payment-provider and ledger effects. Couranr controls the delivery-service refund; the merchant controls any product refund."
        breadcrumbs={[{ label: "Operations", href: "/operations" }, { label: "Refund management" }]}
      />
      <RefundsWorkspace />
    </>
  );
}
