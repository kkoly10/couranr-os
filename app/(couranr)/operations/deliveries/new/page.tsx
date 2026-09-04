import { NewDeliveryFlow } from "@/components/couranr/requests/NewDeliveryFlow";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "New business delivery — Couranr Operations" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="New business delivery"
        description="Enter a delivery from a phone call, email or other manual business request. Couranr remains the recorded creator; payer approval stays separate."
      />
      <NewDeliveryFlow mode="operations" />
    </>
  );
}
