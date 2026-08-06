import { PageHeader } from "@/components/couranr/shell/parts";
import { BillingRecords } from "@/components/couranr/billing/BillingRecords";

export const metadata = { title: "Billing records — Couranr" };

/**
 * MER-016 — billing records.
 *
 * The registry titles this "Billing settings", but nothing here is a setting:
 * there is no stored payment method to change and no refund a merchant may
 * issue. Calling it settings would promise controls that do not exist, so the
 * page says what it is — a record of what Couranr charged.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Billing records"
        description="What Couranr charged you for delivery. Couranr never handles the price of what you sold."
        breadcrumbs={[
          { label: "Couranr" },
          { label: "Settings", href: "/business/settings" },
          { label: "Billing records" },
        ]}
      />
      <BillingRecords />
    </>
  );
}
