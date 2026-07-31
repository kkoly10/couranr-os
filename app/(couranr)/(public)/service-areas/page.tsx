import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Service areas page — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Service areas page" />
      <ScreenPlaceholder
        screenId="PUB-010"
        name="Service areas page"
        purpose="Explain DC, Stafford, Woodbridge, Fredericksburg, surrounding areas, and review-based extended distance."
      />
    </>
  );
}
