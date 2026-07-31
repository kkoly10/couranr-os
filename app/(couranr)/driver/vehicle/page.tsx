import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Vehicle profile — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Vehicle profile" />
      <ScreenPlaceholder
        screenId="DRV-010"
        name="Vehicle profile"
        purpose="Maintain cargo dimensions, payload, enclosed/open status, equipment, weather protection, and availability."
      />
    </>
  );
}
