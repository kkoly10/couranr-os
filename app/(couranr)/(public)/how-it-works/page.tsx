import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "How Couranr works — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="How Couranr works" />
      <ScreenPlaceholder
        screenId="PUB-011"
        name="How Couranr works"
        purpose="Explain request, payer, Couranr confirmation, pickup, tracking, proof, and support."
      />
    </>
  );
}
