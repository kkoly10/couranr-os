import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Operations analytics — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Operations analytics" />
      <ScreenPlaceholder
        screenId="OPS-013"
        name="Operations analytics"
        purpose="Measure paid deliveries, markets, categories, payer mix, economics, support, proof, and driver utilization."
      />
    </>
  );
}
