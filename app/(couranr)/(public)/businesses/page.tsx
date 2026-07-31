import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Businesses page — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Businesses page" />
      <ScreenPlaceholder
        screenId="PUB-009"
        name="Businesses page"
        purpose="Show supported business categories and merchant-controlled ordering channels."
      />
    </>
  );
}
