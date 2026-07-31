import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Customers list — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Customers list" />
      <ScreenPlaceholder
        screenId="MER-008"
        name="Customers list"
        purpose="Manage recipient records, saved destinations, delivery history, payer preference, and repeat delivery."
      />
    </>
  );
}
