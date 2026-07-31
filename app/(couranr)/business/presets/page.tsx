import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Presets list — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Presets list" />
      <ScreenPlaceholder
        screenId="MER-010"
        name="Presets list"
        purpose="Manage Couranr-recommended, merchant-customized, and merchant-created delivery presets."
      />
    </>
  );
}
