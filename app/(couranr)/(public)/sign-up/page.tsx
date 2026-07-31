import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Business sign up — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Business sign up" />
      <ScreenPlaceholder
        screenId="PUB-003"
        name="Business sign up"
        purpose="Create a test workspace without forcing heavy live-activation requirements."
      />
    </>
  );
}
