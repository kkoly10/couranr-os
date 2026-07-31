import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Deliveries list — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Deliveries list" />
      <ScreenPlaceholder
        screenId="MER-004"
        name="Deliveries list"
        purpose="Find and manage merchant delivery requests across request, payment, readiness, review, and fulfillment states."
      />
    </>
  );
}
