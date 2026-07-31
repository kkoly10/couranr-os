import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Vehicle management — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Vehicle management" />
      <ScreenPlaceholder
        screenId="OPS-008"
        name="Vehicle management"
        purpose="Maintain all Couranr-operated and future driver vehicles, capabilities, compliance, and active assignments."
      />
    </>
  );
}
