import { PageHeader } from "@/components/couranr/shell/parts";
import { OperationsVehicleManager } from "@/components/couranr/dispatch/OperationsVehicleManager";

export const metadata = { title: "Vehicle management — Couranr" };

/**
 * OPS-008 — vehicle management.
 *
 * Minimal by design for this slice: the canonical fleet, its capabilities, and
 * whether each vehicle can take work. Compliance records and maintenance
 * scheduling are named in the registry but belong to later work, and drawing
 * empty sections for them would imply a fleet capability Couranr does not have
 * — which the registry's own constraint for this screen forbids.
 */
export default function Page() {
  return (
    <>
      <PageHeader title="Vehicle management" />
      <OperationsVehicleManager />
    </>
  );
}
