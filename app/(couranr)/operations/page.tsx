import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Operations dashboard — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Operations dashboard" />
      <ScreenPlaceholder
        screenId="OPS-001"
        name="Operations dashboard"
        purpose="Show live delivery health, pending reviews, support SLA, payment risk, Ghost flags, and quick actions."
      />
    </>
  );
}
