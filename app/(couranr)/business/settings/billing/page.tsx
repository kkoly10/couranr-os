import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Billing settings — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Billing settings" />
      <ScreenPlaceholder
        screenId="MER-016"
        name="Billing settings"
        purpose="Manage merchant payment methods, delivery receipts, charges, credits, refunds, and invoices/records."
      />
    </>
  );
}
