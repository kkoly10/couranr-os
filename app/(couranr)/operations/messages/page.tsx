import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Operations messages and support inbox — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Operations messages and support inbox" />
      <ScreenPlaceholder
        screenId="OPS-005"
        name="Operations messages and support inbox"
        purpose="Unify merchant, driver, and customer-help conversations with delivery context and priority."
      />
    </>
  );
}
