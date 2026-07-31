import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Pricing page — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Pricing page" />
      <ScreenPlaceholder
        screenId="PUB-008"
        name="Pricing page"
        purpose="Explain deterministic delivery pricing and approved surcharges."
      />
    </>
  );
}
