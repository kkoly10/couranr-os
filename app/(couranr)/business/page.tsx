import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Merchant dashboard — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Merchant dashboard" />
      <ScreenPlaceholder
        screenId="MER-001"
        name="Merchant dashboard"
        purpose="Show today’s deliveries, readiness, attention items, payment states, messages, and quick actions."
      />
    </>
  );
}
