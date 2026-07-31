import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Driver availability — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Driver availability" />
      <ScreenPlaceholder
        screenId="DRV-009"
        name="Driver availability"
        purpose="Manage active status and operating availability for Couranr-managed assignments."
      />
    </>
  );
}
