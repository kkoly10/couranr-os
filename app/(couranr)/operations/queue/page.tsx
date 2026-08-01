import { PageHeader } from "@/components/couranr/shell/parts";
import { OperationsQueue } from "@/components/couranr/requests/OperationsQueue";

export const metadata = { title: "Queue and managed dispatch — Couranr" };

/**
 * OPS-002 — the Couranr Operations Queue.
 *
 * The whole lifecycle, not just review: a request stays here from submission
 * until it is captured and scheduled, grouped by what it is waiting on.
 *
 * Driver assignment is the rest of this screen and is not in this slice — a
 * captured delivery is scheduled with no driver on it.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Couranr Operations Queue"
        description="Every delivery request Couranr still has work on, grouped by what it is waiting on."
      />
      <OperationsQueue />
    </>
  );
}
