import { PageHeader } from "@/components/couranr/shell/parts";
import { OperationsQueue } from "@/components/couranr/requests/OperationsQueue";

export const metadata = { title: "Queue and managed dispatch — Couranr" };

/**
 * OPS-002 — the Couranr Operations Queue.
 *
 * Managed dispatch (vehicle, driver and schedule selection) is the rest of this
 * screen and is not in this slice: no driver or vehicle assignment exists yet.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Couranr Operations Queue"
        description="Delivery requests waiting for Couranr review, oldest first."
      />
      <OperationsQueue />
    </>
  );
}
