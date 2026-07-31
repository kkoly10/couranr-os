import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Driver messages — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Driver messages" />
      <ScreenPlaceholder
        screenId="DRV-008"
        name="Driver messages"
        purpose="Show delivery-specific merchant messages and Couranr Support conversations."
      />
    </>
  );
}
