import { PageHeader } from "@/components/couranr/shell/parts";
import { AssignedDeliveryDetail } from "@/components/couranr/dispatch/AssignedDeliveryDetail";

export const metadata = { title: "Assigned delivery — Couranr" };

/**
 * DRV-002 — assigned delivery detail.
 *
 * Only the assigned driver can see this, and only the sanitized projection.
 * The page passes the id through; the server decides whether this caller holds
 * that delivery, and answers "no assignment" rather than a permission error if
 * they do not — a 403 would confirm the delivery exists.
 *
 * DRV-005 Driving Mode is a `?mode=driving` variant of this same route, which
 * is how UI_SCREEN_REGISTRY defines it. The mode is a presentation choice and
 * carries no authority: the same sanitized projection backs both, and every
 * mutation still goes through the same command.
 */
export default async function Page(
  props: {
    params: Promise<{ id: string }>;
    searchParams?: Promise<{ mode?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const drivingMode = searchParams?.mode === "driving";
  return (
    <>
      {!drivingMode ? (
        <PageHeader
          title="Assigned delivery"
          breadcrumbs={[{ label: "Dashboard", href: "/driver" }, { label: "Assigned delivery" }]}
        />
      ) : null}
      <AssignedDeliveryDetail deliveryId={params.id} drivingMode={drivingMode} />
    </>
  );
}
