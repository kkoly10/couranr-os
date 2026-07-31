import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Merchant messages and support — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Merchant messages and support" />
      <ScreenPlaceholder
        screenId="MER-012"
        name="Merchant messages and support"
        purpose="Centralize merchant–driver delivery chat and merchant–Couranr Support conversations."
      />
    </>
  );
}
