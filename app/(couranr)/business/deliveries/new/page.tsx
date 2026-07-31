import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Create delivery with Smart Intake — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Create delivery with Smart Intake" />
      <ScreenPlaceholder
        screenId="MER-005"
        name="Create delivery with Smart Intake"
        purpose="Turn merchant text, pasted orders, presets, or manual entry into an editable structured delivery draft."
      />
    </>
  );
}
