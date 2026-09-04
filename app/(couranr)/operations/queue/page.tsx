import { PageHeader } from "@/components/couranr/shell/parts";
import { OperationsQueue } from "@/components/couranr/requests/OperationsQueue";

export const metadata = { title: "Operations queue — Couranr" };

/**
 * OPS-002 — the live Operations work queue.
 *
 * Mobile renders stacked delivery cards; tablet/desktop keeps the dense table.
 * Both are fed by the same server-derived lifecycle stage and actions.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Operations queue"
        description="Work the oldest delivery that needs Couranr first. Waiting and recently scheduled work stay visible without crowding out action."
      />
      <OperationsQueue />
    </>
  );
}
