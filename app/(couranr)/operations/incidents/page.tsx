import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Incidents and claims — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Incidents and claims" />
      <ScreenPlaceholder
        screenId="OPS-012"
        name="Incidents and claims"
        purpose="Investigate damage, missing, wrong item, unsafe handling, delivery failure, and evidence."
      />
    </>
  );
}
