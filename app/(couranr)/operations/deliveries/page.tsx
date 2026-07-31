import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Queue and managed dispatch — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Queue and managed dispatch" />
      <ScreenPlaceholder
        screenId="OPS-002"
        name="Queue and managed dispatch"
        purpose="Review requests and select compatible vehicle, driver, schedule, and action."
      />
    </>
  );
}
