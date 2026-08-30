import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Delivery estimate and hosted request — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Delivery estimate and hosted request" />
      <ScreenPlaceholder
        screenId="PUB-004"
        name="Delivery estimate and hosted request"
        purpose="Capture a delivery estimate or a merchant-branded customer request without requiring an account."
      />
    </>
  );
}
