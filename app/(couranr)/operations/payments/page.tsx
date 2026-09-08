import { OperationsPaymentsDashboard } from "@/components/couranr/finance/OperationsPaymentsDashboard";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Payments and reconciliation — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Payments and reconciliation"
        description="Authorizations, captures, refunds, governed receivables, and the immutable Couranr ledger."
      />
      <OperationsPaymentsDashboard />
    </>
  );
}
