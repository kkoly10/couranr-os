import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Merchant onboarding — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Merchant onboarding" />
      <ScreenPlaceholder
        screenId="MER-002"
        name="Merchant onboarding"
        purpose="Create the test workspace, choose category, set pickup location and payer default, and accept basic policies."
      />
    </>
  );
}
