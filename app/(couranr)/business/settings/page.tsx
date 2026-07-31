import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Merchant settings — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Merchant settings" />
      <ScreenPlaceholder
        screenId="MER-014"
        name="Merchant settings"
        purpose="Manage business profile, pickup defaults, categories, payer defaults, notifications, security, and delivery policies."
      />
    </>
  );
}
