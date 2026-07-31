import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Website tools — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Website tools" />
      <ScreenPlaceholder
        screenId="MER-013"
        name="Website tools"
        purpose="Create merchant delivery link, QR code, embed/button tools, branding, and customer request defaults."
      />
    </>
  );
}
