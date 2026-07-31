import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Merchant management — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Merchant management" />
      <ScreenPlaceholder
        screenId="OPS-007"
        name="Merchant management"
        purpose="Review merchant activation, contact, categories, presets, support, performance, and risk."
      />
    </>
  );
}
