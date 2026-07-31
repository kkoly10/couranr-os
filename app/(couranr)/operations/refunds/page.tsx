import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Refund management — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Refund management" />
      <ScreenPlaceholder
        screenId="OPS-011"
        name="Refund management"
        purpose="Review delivery-charge refund requests with evidence, policy, Stripe, and ledger effects."
      />
    </>
  );
}
