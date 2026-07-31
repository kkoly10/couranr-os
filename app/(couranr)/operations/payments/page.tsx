import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Payments and reconciliation — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Payments and reconciliation" />
      <ScreenPlaceholder
        screenId="OPS-009"
        name="Payments and reconciliation"
        purpose="Monitor authorizations, captures, refunds, Stripe reconciliation, settlements, ledger balance, and alerts."
      />
    </>
  );
}
